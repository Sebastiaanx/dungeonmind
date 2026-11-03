import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameCharacter, Npc, RulesData } from '@dungeonmind/shared';
import { beforeAll, describe, expect, it } from 'vitest';

let M: typeof import('../src/game/monsters.js');
let R: typeof import('../src/game/rolls.js');
let mergeNpcs: typeof import('../src/game/turn.js').mergeNpcs;
let srd51: RulesData;
let srd52: RulesData;
let turks: GameCharacter;
const mon = (rules: RulesData, id: string) => rules.monsters.find((m) => m.id === id)!;

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'dm-monsters-'));
  M = await import('../src/game/monsters.js');
  R = await import('../src/game/rolls.js');
  mergeNpcs = (await import('../src/game/turn.js')).mergeNpcs;
  const { rules } = await import('../src/rules/index.js');
  srd51 = rules('srd51');
  srd52 = rules('srd52');
  const { buildCharacter } = await import('../src/game/character.js');
  turks = {
    ...buildCharacter(
      srd51,
      { ruleset: 'srd51', background: 'acolyte', level: 1, abilityMethod: 'standard', name: 'Turks', species: 'human', class: 'fighter', baseAbilities: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, skills: ['athletics', 'perception'], equipment: ['Longsword', 'Chain Mail'] },
      { id: 't', ownerId: 'u1' },
    ),
    userId: 'u1',
    seated: true,
    absent: false,
  };
});

describe('reading stat blocks', () => {
  it('turns attack lines into to-hit and damage dice', () => {
    expect(M.monsterActions(mon(srd51, 'goblin'))).toEqual([
      { name: 'Scimitar', attack: 4, damage: '1d6+2', damageType: 'slashing' },
      { name: 'Shortbow', attack: 4, damage: '1d6+2', damageType: 'piercing' },
    ]);
    // 2024 wording; the extra die "if the attack roll had Advantage" is not part of every hit.
    expect(M.monsterActions(mon(srd52, 'goblin-warrior'))[0]).toEqual({ name: 'Scimitar', attack: 4, damage: '1d6+2', damageType: 'slashing' });
  });

  it('keeps flat damage, extra damage and save DCs', () => {
    expect(M.monsterActions(mon(srd51, 'flying-snake'))[0]).toMatchObject({ attack: 6, damage: '1+3d4', damageType: 'piercing' });
    expect(M.monsterActions(mon(srd51, 'wolf'))[0]).toMatchObject({ name: 'Bite', attack: 4, damage: '2d4+2', dc: 11 });
    const breath = M.actionNamed(mon(srd51, 'adult-red-dragon'), 'fire breath');
    expect(breath).toMatchObject({ damage: '18d6', damageType: 'fire', dc: 21 });
    expect(breath?.attack).toBeUndefined();
  });

  it('uses the listed save and skill bonuses, else the ability modifier', () => {
    const lich = mon(srd51, 'lich');
    expect(M.monsterSave(lich, 'con')).toBe(10);
    expect(M.monsterSave(lich, 'str')).toBe(0);
    expect(M.monsterCheck(mon(srd51, 'goblin'), 'dex', 'stealth')).toBe(6);
    expect(M.monsterCheck(mon(srd51, 'goblin'), 'dex', 'acrobatics')).toBe(2);
  });
});

describe('recognising monsters by name', () => {
  it.each([
    ['Goblin', 'goblin'],
    ['goblin 2', 'goblin'],
    ['Goblin #3', 'goblin'],
    ['Ogre B', 'ogre'],
    ['the Ogre', 'ogre'],
    ['Starving Wolf', 'wolf'],
    ['Grishnak the Goblin', 'goblin'],
    ['Giant Cave Spider', 'giant-spider'],
  ])('%s is the SRD %s', (name, id) => {
    expect(M.findMonster(srd51, name)?.id).toBe(id);
  });

  it('knows nothing about people and made-up creatures', () => {
    for (const name of ['Old Miller (missing)', 'The Bell-Hag', 'Bandit Leader', 'Rook']) expect(M.findMonster(srd51, name)).toBeUndefined();
  });

  it('finds the 2024 Warrior for the plain humanoids', () => {
    expect(M.findMonster(srd52, 'Goblin 1')?.id).toBe('goblin-warrior');
    expect(M.findMonster(srd52, 'Kobold')?.id).toBe('kobold-warrior');
    expect(M.findMonster(srd52, 'Goblin Boss')?.id).toBe('goblin-boss');
  });
});

describe('the DM bringing in monsters', () => {
  it('gives a known monster its real HP, AC and initiative, not the DM’s numbers', () => {
    const [g] = mergeNpcs([], [{ name: 'Goblin 1', hp: 20, maxHp: 20, ac: 18, dex: 5, status: 'hostile' }], new Set(), srd51);
    expect(g).toEqual({ name: 'Goblin 1', monster: 'goblin', hp: 7, maxHp: 7, ac: 15, dex: 2, status: 'hostile' });
  });

  it('uses the stat block the DM names for a named creature', () => {
    const [g] = mergeNpcs([], [{ name: 'Grishnak', monster: 'Goblin Boss', status: 'hostile' }], new Set(), srd52);
    expect(g).toMatchObject({ name: 'Grishnak', monster: 'goblin-boss', hp: 21, maxHp: 21, ac: 17 });
  });

  it('later turns keep the stat block: HP can drop, never rise past the maximum', () => {
    let npcs = mergeNpcs([], [{ name: 'Ogre', status: 'hostile' }], new Set(), srd51);
    npcs = mergeNpcs(npcs, [{ name: 'Ogre', hp: 200, maxHp: 200, ac: 20 }], new Set(), srd51);
    expect(npcs[0]).toMatchObject({ hp: 59, maxHp: 59, ac: 11 });
    npcs = mergeNpcs(npcs, [{ name: 'Ogre', hp: 30 }], new Set(), srd51);
    expect(npcs[0].hp).toBe(30);
  });

  it('dice damage this turn still wins over the DM’s HP', () => {
    const before: Npc[] = [{ name: 'Wolf', monster: 'wolf', hp: 4, maxHp: 11, ac: 13, dex: 2, status: 'hostile' }];
    const [w] = mergeNpcs(before, [{ name: 'Wolf', hp: 11 }], new Set(['Wolf']), srd51);
    expect(w.hp).toBe(4);
  });

  it('creatures without a stat block keep the DM’s numbers', () => {
    const [h] = mergeNpcs([], [{ name: 'The Bell-Hag', hp: 30, maxHp: 30, ac: 15, status: 'hostile' }], new Set(), srd51);
    expect(h).toEqual({ name: 'The Bell-Hag', hp: 30, maxHp: 30, ac: 15, status: 'hostile' });
  });

  it('shows the adjudicator the attacks with the server’s numbers', () => {
    const view = M.npcView(srd51, { name: 'Goblin 1', monster: 'goblin', hp: 7, maxHp: 7, ac: 15 });
    expect(view).toMatchObject({ monster: 'Goblin', attacks: ['Scimitar +4 (1d6+2 slashing)', 'Shortbow +4 (1d6+2 piercing)'] });
  });
});

describe('monster rolls', () => {
  const goblin = (): Npc => ({ name: 'Goblin 1', monster: 'goblin', hp: 7, maxHp: 7, ac: 15, dex: 2, status: 'hostile' });

  it('attacks and damage come from the stat block, whatever the AI says', () => {
    const rolls = R.buildRolls(srd51, [turks], [goblin()], {
      rolls: [
        { id: 'a', actor: 'Goblin 1', kind: 'attack', target: 'Turks', bonus: 9, weapon: 'Greataxe' },
        { id: 'b', actor: 'Goblin 1', kind: 'damage', target: 'Turks', dice: '1d12+5', onHit: 'a' },
        { id: 'c', actor: 'Goblin 1', kind: 'attack', target: 'Turks', bonus: 9, weapon: 'shortbow' },
        { id: 'd', actor: 'Goblin 1', kind: 'damage', target: 'Turks', dice: '3d8', onHit: 'c' },
      ],
    });
    expect(rolls[0]).toMatchObject({ bonus: 4, targetAc: 16, auto: true, label: 'Goblin 1 attacks Turks (Scimitar)' });
    expect(rolls[1]).toMatchObject({ dice: '1d6+2', damageType: 'slashing' });
    expect(rolls[2]).toMatchObject({ bonus: 4, label: 'Goblin 1 attacks Turks (Shortbow)' });
    expect(rolls[3]).toMatchObject({ dice: '1d6+2', damageType: 'piercing' });
  });

  it('saves and checks use the stat block bonuses', () => {
    const lich: Npc = { name: 'Lich', monster: 'lich', hp: 135, maxHp: 135, ac: 17, status: 'hostile' };
    const rolls = R.buildRolls(srd51, [turks], [goblin(), lich], {
      rolls: [
        { actor: 'Lich', kind: 'save', ability: 'con', dc: 15, bonus: 0 },
        { actor: 'Goblin 1', kind: 'check', skill: 'stealth', dc: 12, bonus: 0 },
      ],
    });
    expect(rolls[0].bonus).toBe(10);
    expect(rolls[1].bonus).toBe(6);
  });

  it('a save against a monster’s action uses the stat block DC', () => {
    const wolf: Npc = { name: 'Starving Wolf', monster: 'wolf', hp: 11, maxHp: 11, ac: 13, dex: 2, status: 'hostile' };
    const [r] = R.buildRolls(srd51, [turks], [wolf], { rolls: [{ actor: 'Turks', kind: 'save', ability: 'str', dc: 16, weapon: 'Bite' }] });
    expect(r.dc).toBe(11);
  });

  it('NPCs without a stat block still use the AI’s numbers', () => {
    const [r] = R.buildRolls(srd51, [turks], [{ name: 'The Bell-Hag', hp: 30, maxHp: 30, ac: 15, status: 'hostile' }], { rolls: [{ actor: 'The Bell-Hag', kind: 'attack', target: 'Turks', bonus: 6, weapon: 'Claws' }] });
    expect(r.bonus).toBe(6);
  });
});
