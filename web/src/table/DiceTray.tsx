import { useEffect, useState } from 'react';
import { SKILLS, type GameDetail, type PendingRoll } from '@dungeonmind/shared';
import { api } from '../api';
import { useMe } from '../me';

const faces = (expr: string, times = 1) => [...expr.matchAll(/(\d*)d(\d+)/g)].flatMap((m) => Array<number>((Number(m[1]) || 1) * times).fill(Number(m[2])));

/**
 * How many physical dice a roll needs: "2d6+1d4" → [6,6,4]; d20 tests with advantage need two d20s,
 * then the bonus dice (Bless 1d4…).
 */
export function diceNeeded(r: PendingRoll): number[] {
  if (r.kind !== 'damage' && r.kind !== 'heal' && r.kind !== 'hitdie') return [...(r.adv && r.adv !== 'none' ? [20, 20] : [20]), ...(r.bonusDice ?? []).flatMap((b) => faces(b.dice))];
  return faces(r.dice, r.crit ? 2 : 1);
}

const parentOf = (r: PendingRoll, all: PendingRoll[]) => all.find((x) => x.id === (r.onHit ?? r.onFail));
const canRoll = (r: PendingRoll, all: PendingRoll[]) => !r.result && (!parentOf(r, all) || !!parentOf(r, all)!.result);

/** Seconds until the server rolls for an idle player (the host's roll timer). */
function Countdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  return (
    <span className={`text-xs tabular-nums ${left <= 10 ? 'text-amber-300' : 'text-slate-400'}`} title="When the time runs out, the server rolls for this player">
      ⏱ {left}s
    </span>
  );
}

function RollRow({ g, r }: { g: GameDetail; r: PendingRoll }) {
  const me = useMe();
  const [manual, setManual] = useState(false);
  const [vals, setVals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const owner = g.characters.find((c) => c.id === r.characterId);
  const mine = owner && (owner.userId === me.id || (g.myRole === 'host' && owner.absent));
  const need = diceNeeded(r);
  const send = async (body: object) => {
    setBusy(true);
    try {
      await api(`/api/games/${g.id}/rolls/${r.id}`, { body });
    } finally {
      setBusy(false);
    }
  };
  const ready = canRoll(r, g.state.rolls);
  // Host setting: players see "vs AC ?" until the roll is in; the host sees the numbers.
  const hidden = !!g.settings.hideTargets && g.myRole !== 'host';
  const target = (what: string, n: number) => (hidden ? ` vs ${what} ?` : ` vs ${what} ${n}`);
  const damage = r.kind === 'attack' && g.state.rolls.some((x) => x.onHit === r.id && x.characterId === r.characterId && !x.result);
  return (
    <li className={`rounded-md border px-2 py-1.5 text-sm ${r.result ? 'border-[#30363d] opacity-80' : ready && mine ? 'border-indigo-500 bg-indigo-950/30' : 'border-[#30363d]'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          {r.label}
          {r.kind !== 'damage' && r.kind !== 'heal' && (
            <span className="ml-1 text-xs text-slate-400">
              d20 {r.bonus >= 0 ? '+' : '−'}
              {Math.abs(r.bonus)}
              {r.adv && r.adv !== 'none' && ` · ${r.adv === 'adv' ? 'advantage' : 'disadvantage'}`}
              {r.bonusDice?.map((b) => (
                <span key={b.condition} className="text-emerald-300" title={b.once ? `${b.from}: used up by this roll` : b.from}>
                  {` + ${b.dice} ${b.from}`}
                </span>
              ))}
              {r.luck && <span title="Halfling Luck: a natural 1 on the d20 is rolled again"> 🍀</span>}
              {r.targetAc !== undefined && target('AC', r.targetAc)}
              {r.dc !== undefined && target('DC', r.dc)}
              {g.settings.hideTargets && !hidden && (r.targetAc !== undefined || r.dc !== undefined) && <span title="Hidden from the players"> 🔒</span>}
            </span>
          )}
          {(r.kind === 'damage' || r.kind === 'heal') && <span className="ml-1 font-mono text-xs text-slate-400">{r.dice}{r.crit && ' ×2 dice (crit)'}</span>}
        </span>
        {r.result ? (
          <span className={`dm-roll-result font-mono font-semibold ${r.result.skipped ? 'text-slate-500' : r.result.success === false ? 'text-red-300' : 'text-emerald-300'}`} data-total={r.result.total}>
            {r.result.skipped ? '—' : r.result.total}
            {r.result.manual && <span title="Rolled by the player" className="ml-1 text-xs">✋</span>}
            {r.result.timedOut && <span title="Time ran out: the server rolled" className="ml-1 text-xs">⏱</span>}
          </span>
        ) : !ready ? (
          <span className="text-xs text-slate-500">waits</span>
        ) : mine ? (
          <span className="flex flex-wrap items-center gap-1">
            {r.deadline && <Countdown deadline={r.deadline} />}
            <button className="btn py-1" disabled={busy} onClick={() => send({ mode: 'server' })}>
              🎲 Roll
            </button>
            {damage && (
              <button className="btn py-1" disabled={busy} onClick={() => send({ mode: 'server', withDamage: true })} title="Roll the attack, and on a hit the damage right after">
                🎲 Attack + damage
              </button>
            )}
            <button className="btn-ghost py-1" disabled={busy} onClick={() => setManual(!manual)} title="Roll your own physical dice and enter the values">
              I roll myself
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            {r.deadline && <Countdown deadline={r.deadline} />}
            {owner ? `${owner.name} rolls` : 'the DM rolls'}
          </span>
        )}
      </div>
      {manual && !r.result && (
        <form
          className="mt-1.5 flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            send({ mode: 'manual', values: vals.map(Number) });
          }}
        >
          {need.map((s, i) => (
            <input
              key={i}
              className="input w-16 py-1 text-center"
              inputMode="numeric"
              placeholder={`d${s}`}
              value={vals[i] ?? ''}
              onChange={(e) => {
                const v = [...vals];
                v[i] = e.target.value.replace(/\D/g, '');
                setVals(v);
              }}
            />
          ))}
          <button className="btn py-1" disabled={busy || vals.filter(Boolean).length !== need.length}>
            Use these
          </button>
          <span className="text-xs text-slate-500">
            The server checks each value and marks the roll as yours.
            {r.luck && ' Halfling Luck: if a d20 shows 1, roll it again and enter the new number.'}
          </span>
        </form>
      )}
    </li>
  );
}

/** The host's table options for dice; they can change during play. */
function DiceOptions({ g }: { g: GameDetail }) {
  const put = (body: object) => api(`/api/games/${g.id}`, { method: 'PUT', body });
  return (
    <span className="ml-auto flex flex-wrap items-center gap-2 normal-case">
      <label className="flex items-center gap-1" title="If a player hasn't rolled in time, the server rolls for them">
        ⏱
        <select className="input w-auto py-0 text-xs" value={g.settings.rollTimer ?? 0} onChange={(e) => put({ rollTimer: Number(e.target.value) })}>
          {ROLL_TIMERS.map(([s, name]) => (
            <option key={s} value={s}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1" title="Players don't see DCs and ACs; you still do">
        <input type="checkbox" className="accent-indigo-500" checked={!!g.settings.hideTargets} onChange={(e) => put({ hideTargets: e.target.checked })} />
        Hide DC/AC
      </label>
    </span>
  );
}

export const ROLL_TIMERS: [number, string][] = [
  [0, 'No time limit'],
  [30, '30 s to roll'],
  [60, '1 min to roll'],
  [120, '2 min to roll'],
  [300, '5 min to roll'],
];

export function DiceTray({ g }: { g: GameDetail }) {
  if (!g.state.rolls.length) return null;
  return (
    <div>
      <h3 className="label flex flex-wrap items-center gap-2">
        <span>Dice {g.state.phase === 'rolling' && <span className="dm-breathe normal-case text-indigo-300">· waiting for rolls</span>}</span>
        {g.myRole === 'host' && g.status === 'playing' && <DiceOptions g={g} />}
      </h3>
      <ul className="space-y-1.5">
        {g.state.rolls.map((r) => (
          <RollRow key={r.id} g={g} r={r} />
        ))}
      </ul>
    </div>
  );
}

const ABILITY_NAMES: [string, string][] = [
  ['str', 'Strength'],
  ['dex', 'Dexterity'],
  ['con', 'Constitution'],
  ['int', 'Intelligence'],
  ['wis', 'Wisdom'],
  ['cha', 'Charisma'],
];
const title = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());

/** Rolls outside the turn: any dice just for fun, or a check the player asks for. Never changes the game. */
export function FreeRoll({ g }: { g: GameDetail }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState('1d20');
  const [check, setCheck] = useState('perception');
  const [error, setError] = useState('');
  if ((g.myRole !== 'host' && g.myRole !== 'player') || (g.status !== 'playing' && g.status !== 'paused')) return null;
  const mine = g.characters.find((c) => c.userId === me.id && c.seated);
  const roll = async (body: object) => {
    setError('');
    try {
      await api(`/api/games/${g.id}/free-roll`, { body, quiet: true });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  if (!open)
    return (
      <button className="block text-xs text-indigo-300 hover:underline" onClick={() => setOpen(true)}>
        🎲 Free roll or ask for a check (never changes the game)
      </button>
    );
  return (
    <div className="space-y-1.5 text-sm">
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          roll({ expr });
        }}
      >
        <input className="input w-28 py-1 font-mono" aria-label="Dice to roll" placeholder="2d6+3" value={expr} maxLength={60} onChange={(e) => setExpr(e.target.value)} />
        <button className="btn-ghost py-1" disabled={!expr.trim()}>
          Roll for fun
        </button>
        {mine && (
          <>
            <select className="input w-auto py-1" aria-label="Check to ask for" value={check} onChange={(e) => setCheck(e.target.value)}>
              <optgroup label="Skills">
                {Object.keys(SKILLS)
                  .sort()
                  .map((s) => (
                    <option key={s} value={s}>
                      {title(s)}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Abilities">
                {ABILITY_NAMES.map(([a, name]) => (
                  <option key={a} value={a}>
                    {name}
                  </option>
                ))}
              </optgroup>
            </select>
            <button type="button" className="btn-ghost py-1" onClick={() => roll({ characterId: mine.id, ...(check in SKILLS ? { skill: check } : { ability: check }) })}>
              Ask for this check
            </button>
          </>
        )}
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
          close
        </button>
      </form>
      {error && <p className="text-xs text-amber-300">{error}</p>}
      <p className="text-xs text-slate-500">Everyone sees the roll. The DM ignores rolls for fun, but sees a check you ask for and can use it in the story.</p>
    </div>
  );
}
