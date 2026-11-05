import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CharacterBuild, GameCharacter, RulesData, Ruleset } from '@dungeonmind/shared';
import { beforeAll, describe, expect, it } from 'vitest';

let lib: typeof import('../src/game/character.js');
let F: typeof import('../src/game/features.js');
let S: typeof import('../src/game/spells.js');
let B: typeof import('../src/game/bookkeeper.js');
let R: typeof import('../src/game/rolls.js');
let rules: (r: Ruleset) => RulesData;

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'dm-multiclass-'));
  lib = await import('../src/game/character.js');
  F = await import('../src/game/features.js');
  S = await import('../src/game/spells.js');
  B = await import('../src/game/bookkeeper.js');
  R = await import('../src/game/rolls.js');
  rules = (await import('../src/rules/index.js')).rules;
});

/** A 2014 human (+1 to everything): STR 16, DEX 15, CON 14, INT 14, WIS 13, CHA 9 with these base scores. */
const build = (over: Partial<CharacterBuild> = {}): CharacterBuild => ({
  ruleset: 'srd51',
  name: 'Maren',
  species: 'human',
  class: 'fighter',
  subclass: 'champion',
  background: 'acolyte',
  level: 5,
  abilityMethod: 'manual',
  baseAbilities: { str: 15, dex: 14, con: 13, int: 13, wis: 12, cha: 8 },
  skills: ['athletics', 'perception'],
  equipment: ['Longsword'],
  ...over,
});
const make = (b: CharacterBuild): GameCharacter => ({ ...lib.buildCharacter(rules(b.ruleset), b, { id: 'm', ownerId: 'u' }), userId: 'u', seated: true, absent: false });

describe('multiclass builds', () => {
  it('is legal with the prerequisites, and says which one is missing', () => {
    const fw = build({ level: 5, multiclass: [{ class: 'wizard', level: 2, subclass: 'evocation' }], cantrips: ['fire-bolt'], spells: ['magic-missile'] });
    expect(lib.validateBuild(rules('srd51'), fw)).toEqual([]);
    const cleric = build({ multiclass: [{ class: 'cleric', level: 1, subclass: 'life' }], baseAbilities: { str: 15, dex: 14, con: 13, int: 13, wis: 10, cha: 8 } });
    expect(lib.validateBuild(rules('srd51'), cleric).join()).toMatch(/Multiclassing with Cleric needs WIS 13/);
  });

  it('checks the levels, duplicates and subclasses of every class', () => {
    const v = (multiclass: CharacterBuild['multiclass'], over: Partial<CharacterBuild> = {}) => lib.validateBuild(rules('srd51'), build({ multiclass, ...over })).join(' ');
    expect(v([{ class: 'rogue', level: 5 }])).toMatch(/Fighter needs at least one level/);
    expect(v([{ class: 'fighter', level: 1 }])).toMatch(/Fighter is listed twice/);
    expect(v([{ class: 'rogue', level: 3 }], { level: 6 })).toMatch(/A level 3 Rogue needs a subclass/);
    expect(v([{ class: 'rogue', level: 1, hpRolls: [9] }])).toMatch(/rolled on a d8/);
    // Ability Score Improvements come per class: Fighter 3 / Rogue 1 has none yet.
    expect(v([{ class: 'rogue', level: 1 }], { level: 4, asi: { str: 2 } })).toMatch(/0 ability points/);
  });

  it('gives a rogue skill on top, and spells from every list up to each class level', () => {
    const r = rules('srd51');
    expect(lib.validateBuild(r, build({ multiclass: [{ class: 'rogue', level: 1 }], skills: ['athletics', 'perception', 'stealth'] }))).toEqual([]);
    const cw = build({ class: 'cleric', subclass: 'life', level: 4, multiclass: [{ class: 'wizard', level: 1 }], baseAbilities: { str: 13, dex: 12, con: 14, int: 13, wis: 15, cha: 8 }, skills: ['medicine', 'persuasion'] });
    expect(lib.validateBuild(r, { ...cw, cantrips: ['sacred-flame', 'fire-bolt'], spells: ['cure-wounds', 'magic-missile', 'spiritual-weapon'] })).toEqual([]);
    // Wizard 1 knows only 1st-level spells, whatever the slots are.
    expect(lib.validateBuild(r, { ...cw, spells: ['cure-wounds', 'web'] }).join()).toMatch(/Web \(level 2\) is above your highest slot \(1\)/);
  });
});

describe('a multiclass sheet', () => {
  it('rolls hit points on each class die: only the first level is the full die', () => {
    const c = make(build({ level: 2, multiclass: [{ class: 'wizard', level: 1, hpRolls: [4] }] }));
    // Fighter 1 (10 + CON 2) + Wizard 1 (4 + 2).
    expect(c.maxHp).toBe(12 + 6);
    expect(c.counters.filter((k) => k.name.startsWith('Hit Dice')).map((k) => [k.name, k.max])).toEqual([
      ['Hit Dice (d10)', 1],
      ['Hit Dice (d6)', 1],
    ]);
  });

  it('adds caster levels for slots: half casters round down in 2014 and up in 2024', () => {
    const slots = (c: GameCharacter) => c.counters.filter((k) => /slot/.test(k.name)).map((k) => `${k.name}:${k.max}:${k.recharge}`);
    // Cleric 3 + Wizard 2 = caster level 5.
    const cw = make(build({ class: 'cleric', subclass: 'life', level: 5, multiclass: [{ class: 'wizard', level: 2, subclass: 'evocation' }] }));
    expect(slots(cw)).toEqual(['Spell slot L1:4:long', 'Spell slot L2:3:long', 'Spell slot L3:2:long']);
    // Paladin 3 + Wizard 1: 2014 1 + 1 = 2; 2024 2 + 1 = 3.
    const pw = (ruleset: Ruleset) => make(build({ ruleset, class: 'paladin', subclass: ruleset === 'srd51' ? 'devotion' : 'oath-of-devotion', level: 4, background: ruleset === 'srd51' ? 'acolyte' : 'sage', multiclass: [{ class: 'wizard', level: 1 }] }));
    expect(slots(pw('srd51'))).toEqual(['Spell slot L1:3:long']);
    expect(slots(pw('srd52'))).toEqual(['Spell slot L1:4:long', 'Spell slot L2:2:long']);
    // Pact Magic stays apart, and comes back on a short rest.
    const ww = make(build({ class: 'wizard', subclass: 'evocation', level: 8, multiclass: [{ class: 'warlock', level: 3, subclass: 'fiend' }] }));
    expect(slots(ww)).toEqual(['Spell slot L1:4:long', 'Spell slot L2:3:long', 'Spell slot L3:2:long', 'Pact slot L2:2:short']);
    expect(lib.derive(rules('srd51'), ww).maxSpellLevel).toBe(3);
  });

  it('counts features at their class level and the proficiency bonus at the total level', () => {
    const r = rules('srd51');
    const fr = make(build({ level: 8, multiclass: [{ class: 'rogue', level: 3, subclass: 'thief' }] }));
    const lines = F.featureLines(r, fr).join('\n');
    expect(lines).toMatch(/Sneak Attack: \+2d6/);
    expect(fr.counters.find((k) => k.name === 'Action Surge')).toMatchObject({ max: 1 });
    expect(F.critOn(r, fr)).toBe(19);
    expect(lib.derive(r, fr).profBonus).toBe(3);
  });

  it('casts each spell with the ability of its own class', () => {
    const r = rules('srd51');
    // INT 14 (+2), WIS 16 (+3).
    const cw = make(build({ class: 'cleric', subclass: 'life', level: 5, multiclass: [{ class: 'wizard', level: 2, subclass: 'evocation' }], baseAbilities: { str: 13, dex: 12, con: 14, int: 13, wis: 15, cha: 8 }, cantrips: ['sacred-flame', 'fire-bolt'], spells: ['cure-wounds', 'magic-missile'] }));
    const spell = (id: string) => r.spells.find((s) => s.id === id)!;
    expect([S.spellMod(r, cw, spell('cure-wounds')), S.spellMod(r, cw, spell('magic-missile'))]).toEqual([3, 2]);
    expect(S.spellSaveDc(r, cw, spell('sacred-flame'))).toBe(8 + 3 + 3);
    const [atk] = R.buildRolls(r, [cw], [{ name: 'Ogre', ac: 11 }], { rolls: [{ id: 'a', actor: 'Maren', kind: 'attack', target: 'Ogre', spell: 'Fire Bolt' }] });
    expect(atk.bonus).toBe(3 + 2);
  });

  it('spends the biggest hit dice first and gets half of them back on a 2014 long rest', () => {
    const c = make(build({ level: 4, multiclass: [{ class: 'wizard', level: 2 }] }));
    c.hp = 1;
    B.rest([c], 'short', 'srd51', { m: 3 });
    const hd = () => c.counters.filter((k) => k.name.startsWith('Hit Dice')).map((k) => k.current);
    expect(hd()).toEqual([0, 1]);
    B.rest([c], 'long', 'srd51');
    // Half of 4: two back, the d10 first.
    expect(hd()).toEqual([2, 1]);
  });
});
