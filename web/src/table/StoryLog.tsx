import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '@dungeonmind/shared';
import { useMe } from '../me';
import { animated, INK_MS, streamInk } from './ink';

const ICON: Partial<Record<LogEntry['kind'], string>> = { roll: '🎲', change: '⚖', refused: '⛔', system: '✦', note: '✎', ask: '?', answer: '☾', levelup: '★', image: '🖼' };

export function Entry({ e, children }: { e: LogEntry; children?: React.ReactNode }) {
  if (e.kind === 'narration')
    return (
      <div className="dm-entry" data-turn={e.turn} id={`log-${e.id}`}>
        <div className="story whitespace-pre-wrap">{children ?? e.text}</div>
      </div>
    );
  if (e.kind === 'action')
    return (
      <p className="border-l-2 border-indigo-500 pl-2 text-sm">
        <b className="text-indigo-200">{e.actor}</b> <span className="text-slate-300">{e.text}</span>
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
  if (e.kind === 'image' && typeof e.data?.url === 'string') return <img src={e.data.url} alt={e.text} className="dm-pop w-full rounded-md border border-[#30363d]" />;
  return (
    <p className={`text-xs ${e.kind === 'refused' ? 'text-red-300' : e.kind === 'levelup' ? 'text-amber-300' : e.kind === 'roll' ? 'font-mono text-slate-300' : 'text-slate-400'}`}>
      <span className="mr-1">{ICON[e.kind] ?? '·'}</span>
      {e.actor && e.kind !== 'roll' && <b>{e.actor}: </b>}
      {e.text}
    </p>
  );
}

/** The narration while it comes in, written out at the ink's pace: the finished narration carries on from here. */
function StreamingText({ text }: { text: string }) {
  const paced = animated(useMe().prefs);
  const [shown, setShown] = useState(0);
  // The last word may still be growing.
  const total = Math.max(0, text.split(/\s+/).filter(Boolean).length - 1);
  useEffect(() => {
    streamInk.words = shown;
    if (shown >= total) return;
    const t = setTimeout(() => setShown((n) => n + 1), INK_MS);
    return () => clearTimeout(t);
  }, [shown, total]);
  return <div className="story dm-breathe whitespace-pre-wrap">{paced ? (text.match(new RegExp(`^\\s*(?:\\S+\\s+){${shown}}`))?.[0] ?? '') : text}</div>;
}

/** The full, always-readable history, with jump-to-scene. */
export function StoryLog({ log, streaming, renderNarration, onOlder }: { log: LogEntry[]; streaming: string; renderNarration?: (e: LogEntry, last: boolean) => React.ReactNode; onOlder?: () => Promise<number | undefined> }) {
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
          {streaming && <StreamingText text={streaming} />}
          <div ref={end} />
        </div>
      </div>
    </div>
  );
}
