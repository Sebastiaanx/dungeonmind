import { classLevels, type Abilities, type Ability, type CharacterBuild, type RulesClass, type RulesData } from '@dungeonmind/shared';
import { findIn, slug } from '../rules/index.js';

/** Subclass/subspecies by id or name; "life" finds "life-domain", "Hill" finds "hill-dwarf". */
export function findSub<T extends { id: string; name: string }>(list: T[], x: string | undefined): T | undefined {
  if (!x) return;
  const k = slug(x);
  return list.find((s) => s.id === x || s.id === k || slug(s.name) === k) ?? list.find((s) => s.id.startsWith(`${k}-`) || s.id.endsWith(`-${k}`) || slug(s.name).split('-').includes(k));
}

/** 2014 subclass levels; 2024: every class picks at 3. */
const SUBCLASS_LEVEL_2014: Record<string, number> = { cleric: 1, sorcerer: 1, warlock: 1, druid: 2, wizard: 2 };
export const subclassLevel = (ruleset: string, cls: string) => (ruleset === 'srd51' ? (SUBCLASS_LEVEL_2014[cls] ?? 3) : 3);

export interface ClassEntry {
  cls: RulesClass;
  level: number;
  subclass?: string;
  hpRolls?: number[];
}

/** A character's classes from the rules with their own levels, the first class first. Unknown classes are left out. */
export function classesOf(rules: RulesData, b: Pick<CharacterBuild, 'class' | 'subclass' | 'level' | 'hpRolls' | 'multiclass'>): ClassEntry[] {
  return classLevels(b).flatMap((x) => {
    const cls = findIn(rules.classes, x.class);
    return cls ? [{ cls, level: x.level, subclass: findSub(cls.subclasses, x.subclass)?.id, hpRolls: x.hpRolls }] : [];
  });
}

/** The scores of 13 multiclassing into or out of a class needs: every group, one ability of each (fighter: STR or DEX). */
const MULTICLASS_NEEDS: Record<string, Ability[][]> = {
  barbarian: [['str']],
  bard: [['cha']],
  cleric: [['wis']],
  druid: [['wis']],
  fighter: [['str', 'dex']],
  monk: [['dex'], ['wis']],
  paladin: [['str'], ['cha']],
  ranger: [['dex'], ['wis']],
  rogue: [['dex']],
  sorcerer: [['cha']],
  warlock: [['cha']],
  wizard: [['int']],
};

/** Why these scores can't multiclass with a class, or undefined when they can. */
export function multiclassBlock(cls: RulesClass, abilities: Abilities): string | undefined {
  const missing = (MULTICLASS_NEEDS[cls.id] ?? []).filter((any) => !any.some((a) => abilities[a] >= 13));
  if (missing.length) return `Multiclassing with ${cls.name} needs ${missing.map((any) => `${any.map((a) => a.toUpperCase()).join(' or ')} 13`).join(' and ')}.`;
}

/** Skills multiclassing into a class gives (2014 and 2024 alike): bard any one, ranger and rogue one of theirs. */
export const MULTICLASS_SKILLS: Record<string, number> = { bard: 1, ranger: 1, rogue: 1 };

/** How a class counts toward the multiclass spellcaster level; Warlock's Pact Magic stays apart. */
const CASTER: Record<string, 'full' | 'half'> = { bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full', paladin: 'half', ranger: 'half' };

const ownSlots = (e: ClassEntry) => e.cls.levels.find((l) => l.level === e.level)?.spellcasting?.slots ?? [];

/**
 * Spell slots per level 1-9, and the Pact Magic slots apart. One class with slots uses its own table; two or more add up
 * their levels (half casters count half, rounded down in 2014 and up in 2024) and read the full casters' table.
 */
export function spellSlots(rules: RulesData, classes: ClassEntry[]): { slots: number[]; pact: number[] } {
  const pact = classes.filter((e) => e.cls.id === 'warlock').flatMap(ownSlots);
  const casters = classes.filter((e) => e.cls.id !== 'warlock' && e.cls.levels.some((l) => l.spellcasting?.slots.some((n) => n > 0)));
  if (casters.length <= 1) return { slots: casters[0] ? ownSlots(casters[0]) : [], pact };
  const half = (n: number) => (rules.ruleset === 'srd52' ? Math.ceil(n / 2) : Math.floor(n / 2));
  const level = casters.reduce((s, e) => s + ((CASTER[e.cls.id] ?? 'full') === 'full' ? e.level : half(e.level)), 0);
  const full = findIn(rules.classes, 'wizard');
  return { slots: full?.levels.find((l) => l.level === Math.min(20, level))?.spellcasting?.slots ?? [], pact };
}

/** The highest spell level in a slot list (0: none). */
export const topSlot = (slots: number[]) => slots.reduce((m, n, i) => (n > 0 ? i + 1 : m), 0);
