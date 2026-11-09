import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GameCharacter, type Npc, type PendingRoll, type RulesData } from '@dungeonmind/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RawRoll } from '../src/game/rolls.js';

let R: typeof import('../src/game/rolls.js');
let C: typeof import('../src/game/character.js');
let rules: RulesData;
let rules2024: RulesData;
let hero: GameCharacter;
let caster: GameCharacter;
const goblin: Npc = { name: 'Goblin', monster: 'goblin', ac: 15, dex: 2, status: 'hostile' };
const stranger: Npc = { name: 'Rook', ac: 14, status: 'neutral' };

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'dm-roll-parts-'));
  R = await import('../src/game/rolls.js');
  C = await import('../src/game/character.js');
  const data = await import('../src/rules/index.js');
  rules = data.rules('srd51');
  rules2024 = data.rules('srd52');
  const base = { ruleset: 'srd51' as const, background: 'acolyte', level: 1, abilityMethod: 'standard' as const, species: 'human' };
  hero = {
    ...C.buildCharacter(rules, {
      ...base, name: 'Hero', class: 'fighter',
      baseAbilities: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
      skills: ['athletics', 'perception'], equipment: ['Longsword', 'Rapier', 'Longbow'],
    }, { id: 'hero', ownerId: 'player' }),
    abilities: { str: 14, dex: 18, con: 12, int: 8, wis: 16, cha: 10 },
    saves: ['str', 'con'], skills: ['athletics', 'perception'],
    userId: 'player', seated: true, absent: false,
  };
  caster = { ...hero, id: 'caster', name: 'Mira', class: 'cleric', spells: ['guiding-bolt'] };
});

function build(raw: RawRoll[], pc = hero, data = rules): PendingRoll[] {
  return R.buildRolls(data, [pc], [goblin, stranger], { rolls: raw.map((r) => ({ actor: pc.name, ...r })) });
}

describe('ranged weapon rules', () => {
  it.each(['Shortbow', 'Longbow', 'Crossbow, light', 'Crossbow, heavy', 'Crossbow, hand', 'Sling'])('%s uses DEX for attacks and damage in 2014 games', (weapon) => {
    const item = rules.items.find((w) => w.name === weapon)!;
    expect(item).toBeDefined();
    const pc = { ...hero, inventory: [{ name: weapon, qty: 1, equipped: true }] };
    const [attack, damage] = build([{ id: 'a', kind: 'attack', weapon }, { kind: 'damage', weapon, onHit: 'a' }], pc);
    expect(attack.bonus).toBe(6);
    expect(damage.dice).toBe(`${item.damage}+4`);
  });

  it('uses DEX when a weapon category explicitly says ranged', () => {
    const ranged = { ...rules, items: rules.items.map((item) => item.id === 'longbow' ? { ...item, category: 'Martial Ranged Weapons' } : item) };
    expect(build([{ kind: 'attack', weapon: 'Longbow' }], hero, ranged)[0].bonus).toBe(6);
  });

  it('uses DEX for SRD 5.1 nets and preserves dart finesse in both rulesets', async () => {
    const { isRanged } = await import('../src/game/features.js');
    const pc = { ...hero, inventory: ['Net', 'Dart'].map((name) => ({ name, qty: 1, equipped: true })) };
    expect(build([{ kind: 'attack', weapon: 'Net' }], pc)[0].bonus).toBe(6);
    expect(isRanged(rules, rules.items.find((w) => w.id === 'net'))).toBe(true);
    expect(isRanged(rules2024, rules2024.items.find((w) => w.id === 'net'))).toBe(false);
    for (const data of [rules, rules2024]) {
      expect(isRanged(data, data.items.find((w) => w.id === 'dart'))).toBe(true);
      for (const [str, bonus, damage] of [[14, 6, '1d4+4'], [20, 7, '1d4+5']] as const) {
        const dartPc = { ...pc, abilities: { ...pc.abilities, str } };
        const rolls = build([{ id: 'a', kind: 'attack', weapon: 'Dart' }, { kind: 'damage', weapon: 'Dart', onHit: 'a' }], dartPc, data);
        expect(rolls[0].bonus).toBe(bonus);
        expect(rolls[1].dice).toBe(damage);
      }
      for (const id of ['dagger', 'handaxe', 'javelin', 'spear', 'light-hammer', 'trident']) {
        const item = data.items.find((w) => w.id === id);
        expect(item, id).toBeDefined();
        expect(isRanged(data, item), id).toBe(false);
      }
    }
  });
});
