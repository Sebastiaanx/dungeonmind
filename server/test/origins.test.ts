import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CharacterBuild, RulesData } from '@dungeonmind/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let rules: (r: 'srd51' | 'srd52') => RulesData;
let lib: typeof import('../src/game/character.js');
let dataDir: string;
const originalDataDir = process.env.DATA_DIR;
const baseJson = readFileSync(new URL('../data/srd51/rules.json', import.meta.url), 'utf8');
const base51 = JSON.parse(baseJson) as RulesData;
type Origins = Pick<RulesData, 'backgrounds' | 'feats' | 'traits'> & {
  subspecies: Record<string, RulesData['species'][number]['subspecies']>;
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'dm-origins-'));
  process.env.DATA_DIR = dataDir;
  rules = (await import('../src/rules/index.js')).rules;
  lib = await import('../src/game/character.js');
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

// Same legal level-1 fighter setup as builder.test.ts.
const fighter51 = (over: Partial<CharacterBuild> = {}): CharacterBuild => ({
  ruleset: 'srd51',
  name: 'Turks',
  species: 'dwarf',
  subspecies: 'hill-dwarf',
  class: 'fighter',
  background: 'acolyte',
  level: 1,
  abilityMethod: 'standard',
  baseAbilities: { str: 15, dex: 12, con: 14, int: 8, wis: 13, cha: 10 },
  skills: ['athletics', 'perception'],
  equipment: ['Chain Mail', 'Shield', 'Longsword', '10 gp'],
  ...over,
});

const backgrounds = [
  { id: 'charlatan', skills: ['deception', 'sleight-of-hand'], tools: ['Disguise kit', 'Forgery kit'], languages: 0, gold: 15 },
  { id: 'criminal', skills: ['deception', 'stealth'], tools: ['One type of gaming set', "Thieves' tools"], languages: 0, gold: 15 },
  { id: 'entertainer', skills: ['acrobatics', 'performance'], tools: ['Disguise kit', 'One type of musical instrument'], languages: 0, gold: 15 },
  { id: 'folk-hero', skills: ['animal-handling', 'survival'], tools: ["One type of artisan's tools", 'Vehicles (land)'], languages: 0, gold: 10 },
  { id: 'guild-artisan', skills: ['insight', 'persuasion'], tools: ["One type of artisan's tools"], languages: 1, gold: 15 },
  { id: 'hermit', skills: ['medicine', 'religion'], tools: ['Herbalism kit'], languages: 1, gold: 5 },
  { id: 'noble', skills: ['history', 'persuasion'], tools: ['One type of gaming set'], languages: 1, gold: 25 },
  { id: 'outlander', skills: ['athletics', 'survival'], tools: ['One type of musical instrument'], languages: 1, gold: 10 },
  { id: 'sage', skills: ['arcana', 'history'], tools: [], languages: 2, gold: 10 },
  { id: 'sailor', skills: ['athletics', 'perception'], tools: ["Navigator's tools", 'Vehicles (water)'], languages: 0, gold: 10 },
  { id: 'soldier', skills: ['athletics', 'intimidation'], tools: ['One type of gaming set', 'Vehicles (land)'], languages: 0, gold: 10 },
  { id: 'urchin', skills: ['sleight-of-hand', 'stealth'], tools: ['Disguise kit', "Thieves' tools"], languages: 0, gold: 10 },
];

const subspecies = [
  { species: 'dwarf', id: 'mountain-dwarf' },
  { species: 'elf', id: 'wood-elf' },
  { species: 'elf', id: 'dark-elf' },
  { species: 'halfling', id: 'stout-halfling' },
  { species: 'gnome', id: 'forest-gnome' },
  ...['black', 'blue', 'brass', 'bronze', 'copper', 'gold', 'green', 'red', 'silver', 'white'].map((color) => ({
    species: 'dragonborn', id: `draconic-ancestry-${color}`,
  })),
];

describe('standard origins, SRD 5.1', () => {
  it('loads Acolyte plus the twelve standard backgrounds and all fifteen new subspecies', () => {
    const r = rules('srd51');
    expect(r.backgrounds).toHaveLength(13);
    expect(r.backgrounds.map((b) => b.id).sort()).toEqual(['acolyte', ...backgrounds.map((b) => b.id)].sort());
    const added = r.species.flatMap((s) => s.subspecies
      .filter((sub) => !base51.species.find((original) => original.id === s.id)?.subspecies.some((original) => original.id === sub.id))
      .map((sub) => ({ species: s.id, id: sub.id })));
    expect(added.map((s) => `${s.species}:${s.id}`).sort()).toEqual(subspecies.map((s) => `${s.species}:${s.id}`).sort());
  });

  it.each(backgrounds)('$id has the standard proficiencies and builds a legal level-1 character', (expected) => {
    const r = rules('srd51');
    const background = r.backgrounds.find((b) => b.id === expected.id)!;
    expect(background).toMatchObject({ skills: expected.skills, tools: expected.tools, source: 'standard option, own words' });
    expect(background.languages).toBe(expected.languages || undefined);
    expect(background.skills.every((id) => r.skills.some((s) => s.id === id))).toBe(true);
    expect(background.feature).toMatch(/^[^:]+: .+/);
    expect(background.equipment).toContain(`${expected.gold} gp`);
    const fighter = r.classes.find((c) => c.id === 'fighter')!;
    const build = fighter51({
      background: expected.id,
      skills: fighter.skillChoices.from.filter((s) => !background.skills.includes(s)).slice(0, fighter.skillChoices.choose),
      equipment: background.equipment,
    });
    expect(lib.validateBuild(r, build)).toEqual([]);
    const character = lib.buildCharacter(r, build, { id: expected.id, ownerId: 'u' });
    expect(character).toMatchObject({ background: expected.id, level: 1, gold: expected.gold });
    expect(character.skills).toEqual(expect.arrayContaining(expected.skills));
  });

  it.each(subspecies)('$id builds a legal level-1 character', ({ species, id }) => {
    const r = rules('srd51');
    expect(r.species.find((s) => s.id === species)?.subspecies.some((s) => s.id === id)).toBe(true);
    // Elves already have Perception; Acolyte already grants Insight and Religion.
    const build = fighter51({ species, subspecies: id, skills: ['athletics', 'survival'] });
    expect(lib.validateBuild(r, build)).toEqual([]);
    const character = lib.buildCharacter(r, build, { id, ownerId: 'u' });
    expect(character).toMatchObject({ species, subspecies: id, level: 1 });
    expect(lib.derive(r, character).speed).toBeGreaterThan(0);
  });

  it('adds both the dwarf CON bonus and Mountain Dwarf STR bonus', () => {
    const r = rules('srd51');
    const build = fighter51({ subspecies: 'mountain-dwarf' });
    expect(lib.validateBuild(r, build)).toEqual([]);
    const character = lib.buildCharacter(r, build, { id: 'mountain', ownerId: 'u' });
    expect(character.abilities.str).toBe(build.baseAbilities.str + 2);
    expect(character.abilities.con).toBe(build.baseAbilities.con + 2);
  });

  it.each([{ id: 'wood-elf', speed: 35 }, { id: 'high-elf', speed: 30 }])('$id derives speed $speed', ({ id, speed }) => {
    const r = rules('srd51');
    const build = fighter51({ species: 'elf', subspecies: id, skills: ['athletics', 'survival'] });
    expect(lib.validateBuild(r, build)).toEqual([]);
    expect(lib.derive(r, lib.buildCharacter(r, build, { id, ownerId: 'u' })).speed).toBe(speed);
  });

  it('resolves every subspecies trait except the dragonborn breath and resistance labels', () => {
    const r = rules('srd51');
    const traitNames = new Set(r.traits.map((t) => t.name));
    for (const species of r.species) {
      for (const sub of species.subspecies) {
        for (const name of sub.traits) {
          // SRD 5.2 also represents these choices as labels, not separate trait entries.
          if (/^(Breath Weapon:|Damage Resistance:)/.test(name)) continue;
          expect(traitNames.has(name), `${sub.id}: ${name}`).toBe(true);
        }
      }
    }
  });

  it('keeps origins data in plain ASCII', () => {
    expect(readFileSync(new URL('../data/srd51/origins.json', import.meta.url), 'utf8')).not.toMatch(/[^\x09\x0a\x0d\x20-\x7e]/);
  });
});

describe('SRD 5.2 stays unchanged', () => {
  it('still has four backgrounds and nine species', () => {
    expect(rules('srd52').backgrounds).toHaveLength(4);
    expect(rules('srd52').species).toHaveLength(9);
  });
});

describe('origins loader rejects invalid data', () => {
  let rulesDir: string;
  let origins: Origins;

  beforeEach(() => {
    rulesDir = mkdtempSync(join(tmpdir(), 'dm-origins-rules-'));
    mkdirSync(join(rulesDir, 'srd51'));
    writeFileSync(join(rulesDir, 'srd51', 'rules.json'), baseJson);
    origins = { backgrounds: [], feats: [], traits: [], subspecies: {} };
    vi.resetModules();
    vi.doMock('../src/config.js', () => ({ config: { rulesDir } }));
  });

  afterEach(() => {
    vi.doUnmock('../src/config.js');
    vi.resetModules();
    rmSync(rulesDir, { recursive: true, force: true });
  });

  async function expectRejected(message: string) {
    writeFileSync(join(rulesDir, 'srd51', 'origins.json'), JSON.stringify(origins));
    const loader = await import('../src/rules/index.js');
    expect(() => loader.rules('srd51')).toThrow(message);
  }

  it.each(['backgrounds', 'feats', 'traits'] as const)('rejects %s ids already in the base rules', async (kind) => {
    const [entry] = base51[kind];
    origins = { ...origins, [kind]: [entry] };
    const singular = { backgrounds: 'background', feats: 'feat', traits: 'trait' }[kind];
    await expectRejected(`Duplicate ${singular} id "${entry.id}" in srd51 origins`);
  });

  it.each(['backgrounds', 'feats', 'traits'] as const)('rejects duplicate %s ids within origins', async (kind) => {
    const entry = { ...base51[kind][0], id: 'duplicate-origin' };
    origins = { ...origins, [kind]: [entry, entry] };
    const singular = { backgrounds: 'background', feats: 'feat', traits: 'trait' }[kind];
    await expectRejected(`Duplicate ${singular} id "duplicate-origin" in srd51 origins`);
  });

  it('rejects a subspecies id already in the base species', async () => {
    origins.subspecies.dwarf = [base51.species.find((s) => s.id === 'dwarf')!.subspecies[0]];
    await expectRejected('Duplicate subspecies id "hill-dwarf" in srd51 origins');
  });

  it('rejects duplicate subspecies ids within origins', async () => {
    const entry = { id: 'new-dwarf', name: 'New Dwarf', abilityBonuses: {}, traits: [] };
    origins.subspecies.dwarf = [entry, entry];
    await expectRejected('Duplicate subspecies id "new-dwarf" in srd51 origins');
  });

  it('rejects an unknown parent species id', async () => {
    origins.subspecies['unknown-species'] = [];
    await expectRejected('Unknown species id "unknown-species" in srd51 origins');
  });
});
