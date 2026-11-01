import { createContext, useContext, useMemo } from 'react';
import type { GameDetail } from '@dungeonmind/shared';
import { useMe } from '../me';

/** Who someone is to you: you green, allies yellow, enemies red. */
export type Side = 'you' | 'ally' | 'enemy' | 'neutral';

export const SIDE_TEXT: Record<Side, string> = { you: 'text-emerald-300', ally: 'text-amber-300', enemy: 'text-red-400', neutral: 'text-slate-200' };
export const SIDE_CHIP: Record<Side, string> = { you: 'border-emerald-500 text-emerald-200', ally: 'border-amber-500 text-amber-200', enemy: 'border-red-600 text-red-300', neutral: 'border-[#30363d] text-slate-300' };
export const SIDE_DOT: Record<Side, string> = { you: 'bg-emerald-400', ally: 'bg-amber-400', enemy: 'bg-red-500', neutral: 'bg-slate-500' };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function sideOf(g: GameDetail, myId: string, name: string): Side {
  const pc = g.characters.find((c) => same(c.name, name));
  if (pc) return pc.userId === myId ? 'you' : 'ally';
  const npc = g.state.npcs.find((n) => same(n.name, name));
  if (npc?.status === 'hostile') return 'enemy';
  if (npc?.status === 'friendly' || g.characters.some((c) => name.toLowerCase().startsWith(`${c.name.toLowerCase()}'s `))) return 'ally';
  return g.state.combat?.order.some((o) => !o.characterId && same(o.name, name)) ? 'enemy' : 'neutral';
}

interface Sides {
  side: (name: string) => Side;
  /** Finds every known name in a text; undefined until the table has names. */
  names?: RegExp;
}
const SidesContext = createContext<Sides>({ side: () => 'neutral' });
export const useSides = () => useContext(SidesContext);

export function SidesProvider({ g, children }: { g: GameDetail; children: React.ReactNode }) {
  const me = useMe();
  const value = useMemo<Sides>(() => {
    const all = [...g.characters.map((c) => c.name), ...g.state.npcs.map((n) => n.name), ...(g.state.combat?.order.map((o) => o.name) ?? []), ...Object.values(g.state.positions).flat()];
    const list = [...new Set(all.filter((n) => n.trim().length > 1))].sort((a, b) => b.length - a.length);
    return {
      side: (name) => sideOf(g, me.id, name),
      names: list.length ? new RegExp(`\\b(${list.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi') : undefined,
    };
  }, [g, me.id]);
  return <SidesContext.Provider value={value}>{children}</SidesContext.Provider>;
}

/** A text with every known name in its side's colour. */
export function Names({ text }: { text: string }) {
  const { side, names } = useSides();
  if (!names) return <>{text}</>;
  return (
    <>
      {text.split(names).map((part, i) =>
        i % 2 ? (
          <span key={i} className={`font-semibold ${SIDE_TEXT[side(part)]}`}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** For word-by-word text: which words belong to a name, by word number. */
export function wordSides({ side, names }: Sides, text: string) {
  const out = new Map<number, Side>();
  if (!names) return out;
  const joined = text.split(/\s+/).filter(Boolean).join(' ');
  for (const m of joined.matchAll(names)) {
    const first = joined.slice(0, m.index).split(' ').length - 1;
    m[0].split(' ').forEach((_, i) => out.set(first + i, side(m[0])));
  }
  return out;
}
