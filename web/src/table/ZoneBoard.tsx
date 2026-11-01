import { Fragment, useState } from 'react';
import { metres, type GameDetail, type Zone } from '@dungeonmind/shared';
import { useMe } from '../me';
import { SIDE_CHIP, SIDE_DOT, SIDE_TEXT, useSides, type Side } from './sides';

function rangeBetween(g: GameDetail, a: string, b: string): number | undefined {
  const zoneOf = (n: string) => Object.entries(g.state.positions).find(([, l]) => l.includes(n))?.[0];
  const za = zoneOf(a);
  const zb = zoneOf(b);
  if (!za || !zb) return;
  if (za === zb) return 5;
  return g.state.zones.find((z) => z.name === za)?.distances[zb] ?? g.state.zones.find((z) => z.name === zb)?.distances[za];
}

const LEGEND: [Side, string][] = [
  ['you', 'You'],
  ['ally', 'Ally'],
  ['enemy', 'Enemy'],
  ['neutral', 'Neutral'],
];

/** Named zones in a row with the metres between them; who stands where, by side; ranges from your character. */
export function ZoneBoard({ g }: { g: GameDetail }) {
  const me = useMe();
  const { side } = useSides();
  const mine = g.characters.find((c) => c.userId === me.id);
  const [from, setFrom] = useState(mine?.name);
  const pcs = new Set(g.characters.map((c) => c.name));
  const npc = (n: string) => g.state.npcs.find((x) => x.name === n);
  if (!g.state.zones.length) return <p className="text-sm text-slate-500">No zone board for this scene yet.</p>;
  const others = Object.values(g.state.positions)
    .flat()
    .filter((n) => n !== from)
    .map((name) => ({ name, range: from ? rangeBetween(g, from, name) : undefined }))
    .sort((a, b) => (a.range ?? Infinity) - (b.range ?? Infinity));
  const between = (a: Zone, b: Zone) => a.distances[b.name] ?? b.distances[a.name];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
        {LEGEND.map(([s, label]) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${SIDE_DOT[s]}`} />
            {label}
          </span>
        ))}
      </div>
      <div className="scroll-thin flex items-stretch gap-1 overflow-x-auto sm:flex-wrap sm:overflow-visible">
        {g.state.zones.map((z, i) => {
          const here = !!from && (g.state.positions[z.name] ?? []).includes(from);
          const next = g.state.zones[i + 1];
          const prev = g.state.zones[i - 1];
          const far = Object.entries(z.distances).filter(([k]) => k !== next?.name && k !== prev?.name);
          const gap = prev && between(prev, z);
          return (
            <Fragment key={z.name}>
              {prev && (
                <div className="flex flex-col items-center justify-center px-1 font-mono text-[11px] text-sky-200">
                  <span>{gap === undefined ? '?' : metres(gap)}</span>
                  <span className="text-slate-500">↔</span>
                </div>
              )}
              <div className={`dm-zone min-w-[10rem] flex-1 shrink-0 rounded-lg sm:shrink border-2 p-2 ${here ? 'border-emerald-500 bg-emerald-950/30' : 'border-[#30363d] bg-[#0d1117]'}`}>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-serif text-sm text-indigo-200">{z.name}</span>
                  {here && <span className="text-[10px] font-semibold uppercase text-emerald-300">{from === mine?.name ? 'You are here' : `${from} is here`}</span>}
                </div>
                <div className="mt-1 space-y-1">
                  {(g.state.positions[z.name] ?? []).map((n) => {
                    const x = npc(n);
                    return (
                      <button key={n} onClick={() => pcs.has(n) && setFrom(n)} className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-left text-sm ${SIDE_CHIP[side(n)]} ${n === from ? 'font-semibold' : ''}`}>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${SIDE_DOT[side(n)]}`} />
                        <span className="min-w-0 flex-1 truncate">{n}</span>
                        {x?.hp !== undefined && <span className="shrink-0 text-[10px] text-slate-400">{x.hp}/{x.maxHp}</span>}
                      </button>
                    );
                  })}
                  {!(g.state.positions[z.name] ?? []).length && <p className="text-xs text-slate-600">Nobody here</p>}
                </div>
                {far.length > 0 && <div className="mt-1 text-[10px] text-slate-500">{far.map(([k, v]) => `${k} ${metres(v)}`).join(' · ')}</div>}
              </div>
            </Fragment>
          );
        })}
      </div>
      {from && others.length > 0 && (
        <p className="text-xs text-slate-400">
          Range from <b className={SIDE_TEXT[side(from)]}>{from}</b>:{' '}
          {others.map((o, i) => (
            <span key={o.name}>
              {i > 0 && ' · '}
              <span className={SIDE_TEXT[side(o.name)]}>{o.name}</span> {o.range === undefined ? '?' : o.range === 5 ? 'melee' : metres(o.range)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function Initiative({ g }: { g: GameDetail }) {
  const { side } = useSides();
  if (!g.state.combat) return null;
  return (
    <div>
      <h3 className="label">Initiative · round {g.state.combat.round}</h3>
      <ol className="flex flex-wrap gap-1">
        {g.state.combat.order.map((o) => {
          const n = g.state.npcs.find((x) => x.name === o.name);
          const c = g.characters.find((x) => x.id === o.characterId);
          return (
            <li key={o.name} className={`chip ${SIDE_CHIP[side(o.name)]}`}>
              <b>{o.total}</b> {o.name}
              {c && <span className="text-[10px] text-slate-400">{c.hp}/{c.maxHp}</span>}
              {n?.hp !== undefined && <span className="text-[10px] text-slate-400">{n.hp}/{n.maxHp}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
