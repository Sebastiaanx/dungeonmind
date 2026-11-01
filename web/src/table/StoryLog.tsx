import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '@dungeonmind/shared';
import { useMe } from '../me';
import { animated, INK_MS, streamInk } from './ink';
import { Names, SIDE_TEXT, useSides } from './sides';

const ICON: Partial<Record<LogEntry['kind'], string>> = { roll: '🎲', change: '⚖', refused: '⛔', system: '✦', note: '✎', ask: '?', answer: '☾', levelup: '★', image: '🖼' };

/** A dice line: the sum stands out, and how it ended is green or red. */
function RollLine({ e }: { e: LogEntry }) {
  const split = e.text.lastIndexOf(' — ');
  const sum = split > 0 ? e.text.slice(0, split) : e.text;
  const outcome = split > 0 ? e.text.slice(split + 3) : '';
  const color = e.data?.crit ? 'border-amber-400' : e.data?.success === true ? 'border-emerald-500' : e.data?.success === false ? 'border-red-500' : 'border-indigo-500';
  return (
    <p className={`rounded border-l-4 bg-[#0d1117] px-2 py-1 font-mono text-sm text-sky-200 ${color}`}>
      <span className="mr-1">{ICON.roll}</span>
      <Names text={sum} />
      {outcome && <b className={`ml-2 ${e.data?.crit ? 'text-amber-300' : e.data?.success === false ? 'text-red-400' : e.data?.success === true ? 'text-emerald-300' : 'text-slate-200'}`}>{outcome}</b>}
    </p>
  );
}

export function Entry({ e, children }: { e: LogEntry; children?: React.ReactNode }) {
  const { side } = useSides();
  if (e.kind === 'narration')
    return (
      <div className="dm-entry" data-turn={e.turn} id={`log-${e.id}`}>
        <div className="story whitespace-pre-wrap">{children ?? e.text}</div>
      </div>
    );
  if (e.kind === 'action')
    return (
      <p className="border-l-2 border-indigo-500 pl-2 text-sm">
        <b className={SIDE_TEXT[side(e.actor ?? '')]}>{e.actor}</b> <span className="text-slate-300">{e.text}</span>
      </p>
    );
  if (e.kind === 'ask' || e.kind === 'answer')
    return (
      <p className={`rounded-md px-2 py-1 text-sm ${e.kind === 'ask' ? 'bg-[#0d1117] text-slate-400' : 'bg-indigo-950/40 text-indigo-100'}`}>
        <span className="mr-1">{ICON[e.kind]}</span>
        {e.kind === 'ask' ? <i>{e.actor} asks the DM: </i> : <i>DM{e.data?.to ? ` → ${e.data.to}` : ''}: </i>}
        {e.text}
      </p>
    );
  if (e.kind === 'roll') return <RollLine e={e} />;
  if (e.kind === 'image' && typeof e.data?.url === 'string') return <img src={e.data.url} alt={e.text} className="dm-pop w-full rounded-md border border-[#30363d]" />;
  return (
    <p className={`text-xs ${e.kind === 'refused' ? 'text-red-300' : e.kind === 'levelup' ? 'text-amber-300' : e.kind === 'change' ? 'font-mono text-sky-200' : 'text-slate-400'}`}>
      <span className="mr-1">{ICON[e.kind] ?? '·'}</span>
      {e.actor && <b>{e.actor}: </b>}
      <Names text={e.text} />
    </p>
  );
}

/** The narration while it comes in, written out at the ink's pace: the finished narration carries on from here. */
function StreamingText({ text, written }: { text: string; written: boolean }) {
  const paced = animated(useMe().prefs);
  const [shown, setShown] = useState(0);
  // The last word may still be growing, until the story is written.
  const words = text.split(/\s+/).filter(Boolean).length;
  const total = written ? words : Math.max(0, words - 1);
  useEffect(() => {
    streamInk.words = shown;
    if (shown >= total) return;
    const t = setTimeout(() => setShown((n) => n + 1), INK_MS);
    return () => clearTimeout(t);
  }, [shown, total]);
  return (
    <div>
      <div className="story whitespace-pre-wrap">{paced ? (`${text} `.match(new RegExp(`^\\s*(?:\\S+\\s+){${shown}}`))?.[0] ?? '') : text}</div>
      {written && <p className="dm-breathe mt-2 text-xs text-indigo-300">The story is written. The DM is updating the game, and your choices follow…</p>}
    </div>
  );
}

/** The full, always-readable history, with jump-to-scene. */
export function StoryLog({ log, streaming, written, renderNarration, onOlder }: { log: LogEntry[]; streaming: string; written: boolean; renderNarration?: (e: LogEntry, last: boolean) => React.ReactNode; onOlder?: () => Promise<number | undefined> }) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const sticking = useRef(stick);
  sticking.current = stick;
  useEffect(() => {
    if (stick) end.current?.scrollIntoView({ block: 'end' });
  }, [log.length, streaming, stick]);
  // Choices and dice take room from the log, and the ink adds lines: keep its last lines in view.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (sticking.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    ro.observe(content.current!);
    return () => ro.disconnect();
  }, []);
  const scenes = log.filter((e) => e.kind === 'narration');
  const lastNarration = scenes.at(-1)?.id;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {scenes.length > 3 && (
        <select className="input mb-2 py-1 text-xs" value="" onChange={(e) => document.getElementById(`log-${e.target.value}`)?.scrollIntoView({ behavior: 'smooth' })}>
          <option value="">Jump to a scene…</option>
          {scenes.map((s) => (
            <option key={s.id} value={s.id}>
              Turn {s.turn}: {s.text.slice(0, 60)}…
            </option>
          ))}
        </select>
      )}
      <div
        ref={box}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        <div ref={content} className="space-y-3">
          {onOlder && log.length >= 300 && (
            <button className="btn-ghost w-full text-xs" onClick={() => onOlder()}>
              Load earlier story
            </button>
          )}
          {log.map((e) => (
            <Entry key={e.id} e={e}>
              {e.kind === 'narration' && renderNarration ? renderNarration(e, e.id === lastNarration) : undefined}
            </Entry>
          ))}
          {streaming && <StreamingText text={streaming} written={written} />}
          <div ref={end} />
        </div>
      </div>
    </div>
  );
}
