import { useEffect, useRef, useState } from 'react';
import type { GameDetail, LogEntry } from '@dungeonmind/shared';
import { api } from '../api';
import { useMe } from '../me';
import { animated, INK_MS, streamInk } from './ink';
import { SIDE_TEXT, useSides, wordSides } from './sides';
import { playNarration, readAloud, setVolume, skip, stop, useNowPlaying, type NarratorPrefs } from './narrator';
import { useVotes } from './votes';

const prefsOf = (p: Record<string, unknown>): NarratorPrefs => (p.narrator as NarratorPrefs) ?? {};
const autoplayed = new Set<number>();
/** Narrations already written out (the ink effect plays once). */
const inked = new Set<number>();

/** A narration in the story log: words that light up as the narrator speaks, and a play button. */
export function Narration({ g, e, last }: { g: GameDetail; e: LogEntry; last: boolean }) {
  const me = useMe();
  const now = useNowPlaying();
  const prefs = prefsOf(me.prefs);
  const playing = now?.key === `log-${e.id}`;
  const sides = useSides();
  const named = wordSides(sides, e.text);
  // A new narration plays by itself for listeners who turned autoplay on.
  useEffect(() => {
    if (!last || !prefs.autoplay || autoplayed.has(e.id) || Date.now() - new Date(e.at.replace(' ', 'T') + 'Z').getTime() > 120_000) return;
    autoplayed.add(e.id);
    playNarration(g.id, e.id, e.text, prefs);
  }, [last, e.id]);
  // Ink: a fresh narration writes itself out word by word, slowly enough for the audio to get made, and follows the narrator when it speaks.
  const total = e.text.split(/\s+/).filter(Boolean).length;
  const fresh = last && !inked.has(e.id) && Date.now() - new Date(e.at.replace(' ', 'T') + 'Z').getTime() < 60_000 && animated(me.prefs);
  const [shown, setShown] = useState(fresh ? Math.min(streamInk.words, total) : total);
  useEffect(() => void (streamInk.words = 0), []);
  useEffect(() => {
    if (shown >= total) {
      inked.add(e.id);
      return;
    }
    const spoken = playing && now && now.word >= 0 ? now.word + 4 : -1;
    if (spoken >= 0 && spoken <= shown) return; // ahead of the voice: wait for it
    const t = setTimeout(() => setShown((n) => Math.min(total, Math.max(n + 1, spoken))), INK_MS);
    return () => clearTimeout(t);
  }, [shown, total, playing, now?.word]);
  let i = -1;
  return (
    <div className="group relative">
      <button
        className={`float-right ml-2 rounded-full border px-2 text-xs ${playing ? 'border-indigo-400 text-indigo-200' : 'border-[#30363d] text-slate-500 opacity-60 group-hover:opacity-100'}`}
        title={playing ? 'Stop' : 'Listen'}
        onClick={() => (playing ? stop() : playNarration(g.id, e.id, e.text, prefs))}
      >
        {playing ? (now?.loading ? '…' : '■') : '▶'}
      </button>
      {e.text.split(/\n{2,}/).map((para, p) => (
        <p key={p} className={`mb-3 last:mb-0 ${i + 1 >= shown ? 'dm-ink-hidden' : ''}`}>
          {para.split(/(\s+)/).map((tok, k) => {
            if (!tok.trim()) return i < shown ? tok : null;
            i++;
            const lit = playing && now?.word === i;
            const side = named.get(i);
            const ink = i >= shown ? 'dm-ink-hidden' : shown < total && i >= shown - 3 ? 'dm-ink' : '';
            return (
              <span key={k} className={`${ink} ${lit ? 'dm-word-lit rounded bg-indigo-500/30 text-white' : side ? `font-semibold ${SIDE_TEXT[side]}` : ''}`}>
                {tok}
              </span>
            );
          })}
        </p>
      ))}
      {(g.myRole === 'host' || g.myRole === 'player') && <Thumbs gameId={g.id} logId={e.id} />}
    </div>
  );
}

/** 👍/👎: one vote per player; a 👎 marks the turn as bad for AI training. Click again to take it back. */
function Thumbs({ gameId, logId }: { gameId: string; logId: number }) {
  const [votes, vote] = useVotes(gameId);
  const v = votes[logId];
  const cls = (on: boolean) => `rounded-full border px-2 text-xs ${on ? 'border-indigo-400 text-indigo-200' : 'border-[#30363d] text-slate-500 opacity-60 group-hover:opacity-100'}`;
  return (
    <div className="mt-1 flex justify-end gap-1">
      <button className={cls(v?.mine === true)} title="Good narration" onClick={() => vote(logId, v?.mine === true ? null : true)}>
        👍{v?.up ? ` ${v.up}` : ''}
      </button>
      <button className={cls(v?.mine === false)} title="Bad narration (used to train the AI DM)" onClick={() => vote(logId, v?.mine === false ? null : false)}>
        👎{v?.down ? ` ${v.down}` : ''}
      </button>
    </div>
  );
}

/** The narrator's volume, right at the table. It changes what's playing now and is remembered for next time. */
export function VolumeSlider() {
  const me = useMe();
  const [v, setV] = useState(prefsOf(me.prefs).volume ?? 1);
  const save = async () => {
    const narrator = { ...prefsOf(me.prefs), volume: v };
    Object.assign(me.prefs, await api('/api/me/prefs', { method: 'PUT', body: { narrator } }));
  };
  return (
    <label className="flex items-center gap-1 text-xs text-slate-400" title={`Narrator volume: ${Math.round(v * 100)}%`}>
      🔊
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={v}
        aria-label="Narrator volume"
        className="w-16 accent-indigo-500 sm:w-24"
        onChange={(e) => {
          setV(Number(e.target.value));
          setVolume(Number(e.target.value));
        }}
        onPointerUp={save}
        onKeyUp={save}
      />
    </label>
  );
}

/** Stop / skip, always visible while something is spoken. */
export function NowPlayingBar() {
  const now = useNowPlaying();
  if (!now) return null;
  return (
    <div className="dm-pop fixed bottom-3 left-3 z-30 flex items-center gap-2 rounded-full border border-indigo-600 bg-[#161b22] px-3 py-1.5 text-sm shadow-lg">
      <span className={now.loading ? 'dm-breathe' : ''}>🔊 {now.loading ? 'The narrator clears their throat…' : now.label}</span>
      <button className="btn-ghost px-2 py-0.5 text-xs" onClick={skip} disabled={now.loading}>
        Skip ⏭
      </button>
      <button className="btn-ghost px-2 py-0.5 text-xs" onClick={stop}>
        Stop ■
      </button>
    </div>
  );
}

/** Select any text in the story and have it read aloud. */
export function ReadSelection() {
  const me = useMe();
  const [sel, setSel] = useState<{ text: string; x: number; y: number }>();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const on = () => {
      const s = getSelection();
      const text = s?.toString().trim() ?? '';
      if (!s || !text || text.length > 3000 || s.rangeCount === 0) return setSel(undefined);
      const rect = s.getRangeAt(0).getBoundingClientRect();
      setSel({ text, x: rect.left + rect.width / 2, y: rect.top });
    };
    document.addEventListener('selectionchange', on);
    return () => document.removeEventListener('selectionchange', on);
  }, []);
  if (!sel) return null;
  return (
    <button
      ref={ref}
      className="btn fixed z-40 -translate-x-1/2 -translate-y-full px-2 py-1 text-xs shadow-lg"
      style={{ left: sel.x, top: Math.max(40, sel.y - 6) }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        readAloud(sel.text, prefsOf(me.prefs));
        setSel(undefined);
      }}
    >
      🔊 Read this aloud
    </button>
  );
}
