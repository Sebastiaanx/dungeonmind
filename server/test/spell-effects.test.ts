import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameCharacter, Npc, RulesData, SpellEffect } from '@dungeonmind/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDice } from '../src/game/dice.js';

/** Spell levels whose effects are all written; raise this as more levels land. */
const COVERED = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
// SRD conditions plus the ones the table tracks for Bless and Guidance.
const CONDITIONS = ['blessed', 'guided', 'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'];
const FIELDS = ['attack', 'save', 'half', 'autoHit', 'rider', 'damage', 'heal', 'tempHp', 'upcast', 'upcastEvery', 'scales', 'count', 'countUpcast', 'area', 'conditions', 'note'];

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');
/** The "NdM" parts of a dice expression ("1d8+mod" → ["1d8"]). */
const diceTerms = (expr: string) => squash(expr).match(/\d+d\d+/g) ?? [];

describe.each(['srd51', 'srd52'])('%s spell effects', (ruleset) => {
  const rules = JSON.parse(readFileSync(new URL(`../data/${ruleset}/rules.json`, import.meta.url), 'utf8')) as RulesData;
  const effects = JSON.parse(readFileSync(new URL(`../data/${ruleset}/spell-effects.json`, import.meta.url), 'utf8')) as Record<string, SpellEffect>;
  const spell = (id: string) => rules.spells.find((s) => s.id === id)!;
  const entries = Object.entries(effects);

  it('only names spells of this ruleset', () => {
    expect(entries.map(([id]) => id).filter((id) => !spell(id))).toEqual([]);
  });

  it.each(entries)('%s is well-formed', (id, e) => {
    const s = spell(id);
    if (!s) return;
    const text = squash(`${s.desc}\n${s.higher ?? ''}`);
    expect(Object.keys(e).filter((k) => !FIELDS.includes(k)), 'unknown fields').toEqual([]);
    if (e.attack) expect(['melee', 'ranged']).toContain(e.attack);
    if (e.save) expect(ABILITIES).toContain(e.save);
    if (e.half) expect(e.save, 'half needs a save').toBeTruthy();
    if (e.autoHit || e.rider) expect(!e.attack && !e.save && !(e.autoHit && e.rider), 'autoHit and rider have no attack or save').toBe(true);
    if (e.damage) expect(e.attack || e.save || e.autoHit || e.rider, 'damage needs attack, save, autoHit or rider').toBeTruthy();
    for (const expr of [...(e.damage ?? []).flatMap((d) => [d.dice, d.upcast]), e.heal, e.tempHp, e.upcast].filter((x): x is string => !!x)) {
      expect(() => parseDice(expr.replace(/mod/g, '0')), expr).not.toThrow();
      // The dice have to be the ones the SRD text names.
      for (const t of diceTerms(expr)) expect(text, `${t} is not in the spell text`).toContain(t);
    }
    for (const d of e.damage ?? []) for (const t of d.type.split('|')) expect([...DAMAGE_TYPES, 'weapon']).toContain(t);
    for (const d of e.damage ?? []) expect(Object.keys(d).filter((k) => !['dice', 'type', 'upcast'].includes(k)), 'unknown damage fields').toEqual([]);
    if (e.damage?.some((d) => d.upcast)) expect(e.upcast, 'part upcasts replace the spell upcast').toBeUndefined();
    if (e.upcast) expect(s.level > 0 && !!(e.damage?.length || e.heal || e.tempHp), 'upcast needs a leveled spell with damage, healing or temp HP').toBe(true);
    if (e.upcastEvery) expect(e.upcast && e.upcastEvery > 1, 'upcastEvery goes with upcast').toBeTruthy();
    if (e.scales) expect(s.level, 'only cantrips scale').toBe(0);
    if (s.level === 0 && e.damage?.length) expect(e.scales, 'a damage cantrip scales').toBeTruthy();
    if (e.scales === 'count' || e.countUpcast) expect(e.count, 'needs a count').toBeGreaterThan(0);
    for (const c of e.conditions ?? []) expect(CONDITIONS).toContain(c.name);
    // Agree with the imported data where it has the field.
    if (s.attack) expect(e.attack).toBe(s.attack);
    if (s.save && e.save) expect(e.save).toBe(s.save);
    if (s.damage && e.damage) expect(squash(s.damage)).toContain(squash(e.damage[0].dice).replace(/\+mod$/, ''));
  });

  it(`covers every level ${COVERED.join(', ')} spell that rolls dice`, () => {
    const missing = rules.spells.filter((s) => COVERED.includes(s.level) && /\d+d\d+/.test(s.desc) && !effects[s.id]).map((s) => s.id);
    expect(missing).toEqual([]);
  });
});

describe('rolling PC spells', () => {
  let R: typeof import('../src/game/rolls.js');
  let S: typeof import('../src/game/spells.js');
  const party: Record<string, { rules: RulesData; wiz: GameCharacter; cleric: GameCharacter }> = {};
  const hag = (): Npc => ({ name: 'The Bell-Hag', hp: 30, maxHp: 30, ac: 15, dex: 2, status: 'hostile' });

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'dm-spells-'));
    R = await import('../src/game/rolls.js');
    S = await import('../src/game/spells.js');
    const { rules } = await import('../src/rules/index.js');
    const { buildCharacter } = await import('../src/game/character.js');
    for (const ruleset of ['srd51', 'srd52'] as const) {
      const r = rules(ruleset);
      const base = { ruleset, background: ruleset === 'srd51' ? 'acolyte' : 'sage', abilityMethod: 'standard' as const, species: 'human', equipment: [] };
      const seat = { seated: true, absent: false };
      const wiz = { ...buildCharacter(r, { ...base, name: 'Ilse', class: 'wizard', level: 5, baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, skills: ['arcana', 'history'], cantrips: ['fire-bolt'], spells: ['magic-missile', 'burning-hands'] }, { id: 'w', ownerId: 'u1' }), userId: 'u1', ...seat };
      const cleric = { ...buildCharacter(r, { ...base, name: 'Esva', class: 'cleric', level: 3, baseAbilities: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 }, skills: ['medicine', 'persuasion'], cantrips: ['sacred-flame'], spells: ['guiding-bolt', 'cure-wounds'] }, { id: 'c', ownerId: 'u2' }), userId: 'u2', ...seat };
      party[ruleset] = { rules: r, wiz, cleric };
    }
  });

  it('works out spell dice', () => {
    expect(S.spellDice('1d8+mod', { mod: 3 })).toBe('1d8+3');
    expect(S.spellDice('1d8+mod', { mod: -1, upcast: '1d8', above: 2 })).toBe('3d8-1');
    expect(S.spellDice('1d10', { mod: 0, tier: 3 })).toBe('3d10');
    expect(S.spellDice('1d4+1', { mod: 0, times: 3 })).toBe('3d4+3');
  });

  it('grows every damage part that has its own upcast', () => {
    const { rules, cleric } = party.srd52;
    const effect = { save: 'dex' as const, half: true, damage: [{ dice: '5d6', type: 'fire', upcast: '1d6' }, { dice: '5d6', type: 'radiant', upcast: '1d6' }] };
    const r = { ...rules, spells: rules.spells.map((x) => (x.id === 'guiding-bolt' ? { ...x, level: 5, effect } : x)) };
    const [, dmg] = R.buildRolls(r, [cleric], [hag()], {
      rolls: [
        { id: 's', actor: 'The Bell-Hag', kind: 'save', spell: 'Guiding Bolt' },
        { actor: 'Esva', kind: 'damage', target: 'The Bell-Hag', onFail: 's' },
      ],
      resources: [{ pc: 'Esva', name: 'Spell slot L7', amount: 1 }],
    });
    expect(dmg).toMatchObject({ dice: '7d6+7d6', damageType: 'fire, radiant', half: true });
  });

  it('upcasts every two slot levels when the spell says so', () => {
    const { rules, cleric } = party.srd51;
    const spell = { ...rules.spells.find((x) => x.id === 'guiding-bolt')!, effect: { attack: 'ranged' as const, damage: [{ dice: '1d8+mod', type: 'force' }], upcast: '1d8', upcastEvery: 2 } };
    const r = { ...rules, spells: rules.spells.map((x) => (x.id === spell.id ? spell : x)) };
    const roll = (slot: number) =>
      R.buildRolls(r, [cleric], [hag()], {
        rolls: [{ actor: 'Esva', kind: 'damage', target: 'The Bell-Hag', spell: 'Guiding Bolt' }],
        resources: [{ pc: 'Esva', name: `Spell slot L${slot}`, amount: 1 }],
      })[0].dice;
    expect([roll(2), roll(3)]).toEqual([`1d8+${S.spellMod(rules, cleric)}`, `2d8+${S.spellMod(rules, cleric)}`]);
  });

  it.each(['srd51', 'srd52'])('%s: cantrips grow with the level, slots add dice, never the AI dice', (ruleset) => {
    const { rules, wiz, cleric } = party[ruleset];
    const mod = (c: GameCharacter) => S.spellMod(rules, c);
    const rolls = R.buildRolls(rules, [wiz, cleric], [hag()], {
      rolls: [
        { id: 'a', actor: 'Ilse', kind: 'attack', target: 'The Bell-Hag', spell: 'Fire Bolt' },
        { id: 'b', actor: 'Ilse', kind: 'damage', target: 'The Bell-Hag', dice: '1d6', onHit: 'a' },
        { id: 'c', actor: 'Esva', kind: 'attack', target: 'The Bell-Hag', spell: 'Guiding Bolt' },
        { id: 'd', actor: 'Esva', kind: 'damage', target: 'The Bell-Hag', dice: '4d6', spell: 'Guiding Bolt', onHit: 'c' },
        { id: 'e', actor: 'Esva', kind: 'heal', target: 'Ilse', dice: '1d4', spell: 'Cure Wounds' },
      ],
      resources: [
        { pc: 'Esva', name: 'Spell slot L2', amount: 1 },
        { pc: 'Esva', name: '1st-level spell slot', amount: 1 },
      ],
    });
    expect(rolls[1]).toMatchObject({ dice: '2d10', damageType: 'fire', onHit: 'r1' });
    // Guiding Bolt is the first of Esva's spells: it gets the lowest slot that fits (L1), Cure Wounds the L2.
    expect(rolls[3]).toMatchObject({ dice: '4d6', damageType: 'radiant' });
    expect(rolls[4].dice).toBe(ruleset === 'srd51' ? `2d8+${mod(cleric)}` : `4d8+${mod(cleric)}`);
  });

  it.each(['srd51', 'srd52'])('%s: a save spell sets the ability, DC and half damage', (ruleset) => {
    const { rules, wiz } = party[ruleset];
    const rolls = R.buildRolls(rules, [wiz], [hag()], {
      rolls: [
        { id: 's', actor: 'The Bell-Hag', kind: 'save', ability: 'con', dc: 30, spell: 'Burning Hands' },
        { id: 'd', actor: 'Ilse', kind: 'damage', target: 'The Bell-Hag', dice: '8d6', onFail: 's' },
      ],
      resources: [{ pc: 'Ilse', name: 'Spell slot L3', amount: 1 }],
    });
    expect(rolls[0]).toMatchObject({ label: 'The Bell-Hag DEX save', dc: wiz && 8 + 3 + S.spellMod(rules, wiz) });
    expect(rolls[1]).toMatchObject({ dice: '5d6', damageType: 'fire', half: true });
  });

  it('Magic Missile: one roll takes every dart, several split them', () => {
    const { rules, wiz } = party.srd51;
    const one = R.buildRolls(rules, [wiz], [hag()], {
      rolls: [{ actor: 'Ilse', kind: 'damage', target: 'The Bell-Hag', dice: '1d4+1', spell: 'Magic Missile' }],
      resources: [{ pc: 'Ilse', name: 'Spell slot L2', amount: 1 }],
    });
    expect(one[0].dice).toBe('4d4+4');
    const split = R.buildRolls(rules, [wiz], [hag(), { ...hag(), name: 'Crow' }], {
      rolls: [
        { actor: 'Ilse', kind: 'damage', target: 'The Bell-Hag', dice: '2d4+2', spell: 'Magic Missile' },
        { actor: 'Ilse', kind: 'damage', target: 'Crow', dice: '9d4+9', spell: 'Magic Missile' },
      ],
    });
    expect(split.map((r) => r.dice)).toEqual(['2d4+2', '1d4+1']);
  });

  it("a monster's spell keeps the AI dice", () => {
    const { rules, wiz } = party.srd51;
    const rolls = R.buildRolls(rules, [wiz], [hag()], { rolls: [{ actor: 'The Bell-Hag', kind: 'damage', target: 'Ilse', dice: '2d10', spell: 'Fire Bolt' }] });
    expect(rolls[0].dice).toBe('2d10');
  });

  it('tells the AI what the server rolls', () => {
    const { rules } = party.srd52;
    const s = (id: string) => rules.spells.find((x) => x.id === id)!;
    expect(S.spellSummary(s('fire-bolt'), 11)).toBe('Fire Bolt (cantrip: ranged spell attack, 3d10 fire)');
    expect(S.spellSummary(s('cure-wounds'), 3)).toBe('Cure Wounds (L1: heals 2d8+mod, +2d8 per slot above 1)');
    expect(S.spellSummary(s('magic-missile'), 3)).toContain('always hits, 3×, 1d4+1 force');
  });
});
