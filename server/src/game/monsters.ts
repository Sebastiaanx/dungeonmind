import { mod, SKILLS, type Ability, type Npc, type RulesData, type RulesMonster } from '@dungeonmind/shared';
import { findIn } from '../rules/index.js';
import { isDice } from './dice.js';

/** One line of a stat block the server can roll: an attack (to-hit and damage) or an effect with a save DC. */
export interface MonsterAction {
  name: string;
  /** To-hit bonus; missing for actions that aren't attack rolls. */
  attack?: number;
  /** "1d6+2", "1+3d4" (a flat point plus poison), "6d6". */
  damage?: string;
  damageType?: string;
  dc?: number;
}

const cache = new WeakMap<RulesMonster, MonsterAction[]>();
const ATTACK = /^(?:Melee or Ranged|Melee|Ranged)(?: Weapon| Spell)? Attack(?: Roll)?:\s*([+-]\s*\d+)/i;
// "5 (1d6 + 2) slashing damage" or "1 piercing damage".
const HIT = /^\s*(\d+)(?:\s*\(([^)]+)\))?\s*([a-z]+) damage/i;
const PLUS = /^\s*plus\s+(\d+)(?:\s*\(([^)]+)\))?\s*([a-z]+) damage(?!\s+if\b)/i;
const ANY_DAMAGE = /\b\d+\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s*([a-z]+) damage/i;

/** The stat block's actions as numbers ("Scimitar: Melee Weapon Attack: +4 to hit … Hit: 5 (1d6 + 2) slashing damage."). */
export function monsterActions(m: RulesMonster): MonsterAction[] {
  let out = cache.get(m);
  if (out) return out;
  out = [];
  for (const line of m.actions) {
    const text = line.replace(/−/g, '-');
    // The name is everything before the first colon, minus "Legendary: " and notes like "(Recharge 5–6)".
    const legendary = text.startsWith('Legendary: ');
    const rest = legendary ? text.slice(11) : text;
    const colon = rest.indexOf(':');
    if (colon < 0) continue;
    const name = rest.slice(0, colon).replace(/\s*\(.*?\)/g, '').trim();
    const body = rest.slice(colon + 1).trim();
    if (/^multiattack$/i.test(name)) continue;
    const a: MonsterAction = { name: legendary ? `Legendary: ${name}` : name };
    const atk = ATTACK.exec(body);
    if (atk) {
      a.attack = Number(atk[1].replace(/\s+/g, ''));
      const hit = /Hit:\s*/i.exec(body);
      let tail = hit ? body.slice(hit.index + hit[0].length) : '';
      const terms: string[] = [];
      for (let m = HIT.exec(tail); m; m = PLUS.exec(tail)) {
        terms.push((m[2] ?? m[1]).replace(/\s+/g, ''));
        a.damageType ??= m[3].toLowerCase();
        tail = tail.slice(m[0].length);
      }
      if (terms.length && isDice(terms.join('+'))) a.damage = terms.join('+');
    } else {
      const dmg = ANY_DAMAGE.exec(body);
      if (dmg && isDice(dmg[1].replace(/\s+/g, ''))) {
        a.damage = dmg[1].replace(/\s+/g, '');
        a.damageType = dmg[2].toLowerCase();
      }
    }
    const dc = /\bDC (\d+)/.exec(body);
    if (dc) a.dc = Number(dc[1]);
    if (a.attack !== undefined || a.damage || a.dc) out.push(a);
  }
  cache.set(m, out);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/^legendary:\s*/, '').replace(/\s*\(.*?\)/g, '').trim();

/** The action the AI means by "scimitar" / "Fire Breath"; undefined when the creature has nothing by that name. */
export function actionNamed(m: RulesMonster, name: string | undefined): MonsterAction | undefined {
  if (!name) return;
  const n = norm(name);
  if (!n) return;
  const list = monsterActions(m);
  return list.find((a) => norm(a.name) === n) ?? list.find((a) => norm(a.name).includes(n) || n.includes(norm(a.name)));
}

/** The attack a monster makes with this weapon, or its first attack when it has no such weapon (a goblin has no longsword). */
export function monsterAttack(m: RulesMonster, weapon: string | undefined): MonsterAction | undefined {
  const named = actionNamed(m, weapon);
  if (named?.attack !== undefined) return named;
  const attacks = monsterActions(m).filter((a) => a.attack !== undefined);
  return attacks.find((a) => !a.name.startsWith('Legendary:')) ?? attacks[0];
}

export function monsterSave(m: RulesMonster, ab: Ability): number {
  return m.saves?.[ab] ?? mod(m.abilities[ab]);
}

export function monsterCheck(m: RulesMonster, ab: Ability, skill?: string): number {
  if (skill && m.skills?.[skill] !== undefined) return m.skills[skill];
  return mod(m.abilities[skill ? SKILLS[skill] : ab]);
}

/**
 * The SRD monster an NPC is: the DM's "monster" field, else its name. Names are loose: "Goblin 2",
 * "the Ogre", "Starving Wolf" (a known creature at the end), "Giant Cave Spider" (first + last word).
 * SRD 5.2 renamed the plain humanoids, so "Goblin" there is the Goblin Warrior.
 */
export function findMonster(rules: RulesData, name: string | undefined): RulesMonster | undefined {
  if (!name) return;
  const base = name
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+(#?\d+|[A-Z])$/, '')
    .trim()
    .replace(/^(the|a|an)\s+/i, '');
  const words = base.split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const tries = words.map((_, i) => words.slice(i).join(' '));
  if (words.length > 2) tries.splice(-1, 0, `${words[0]} ${words[words.length - 1]}`);
  for (const t of tries) {
    const m = findIn(rules.monsters, t) ?? (rules.ruleset === 'srd52' ? findIn(rules.monsters, `${t} Warrior`) : undefined);
    if (m) return m;
  }
}

export const monsterOf = (rules: RulesData, n: Npc | undefined) => (n?.monster ? findIn(rules.monsters, n.monster) : undefined);

/** A stat-block NPC as the adjudicator sees it: which attacks it has, with the server's numbers. */
export function npcView(rules: RulesData, n: Npc) {
  const m = monsterOf(rules, n);
  if (!m) return n;
  const attacks = monsterActions(m)
    .filter((a) => a.attack !== undefined)
    .map((a) => `${a.name} ${a.attack! >= 0 ? '+' : ''}${a.attack}${a.damage ? ` (${a.damage} ${a.damageType ?? ''})`.replace(' )', ')') : ''}`);
  return { ...n, monster: m.name, ...(attacks.length ? { attacks } : {}) };
}

/**
 * Gives a new NPC its stat block (HP, AC, initiative) when it is a known monster. Later turns keep the
 * stat block's AC and max HP whatever the DM writes; current HP can go down but never above the maximum.
 */
export function applyStatBlock(rules: RulesData, clean: Npc, prev: Npc | undefined, requested?: string): Npc {
  const known = prev?.monster ? findIn(rules.monsters, prev.monster) : undefined;
  const m = known ?? (prev ? findMonster(rules, requested) : (findMonster(rules, requested) ?? findMonster(rules, clean.name)));
  if (!m) return clean;
  clean.monster = m.id;
  clean.maxHp = m.hp;
  clean.ac = m.ac;
  clean.dex = mod(m.abilities.dex);
  if (known) {
    if (clean.hp !== undefined) clean.hp = Math.min(clean.hp, m.hp);
  } else clean.hp = Math.min(prev?.hp ?? m.hp, m.hp);
  return clean;
}
