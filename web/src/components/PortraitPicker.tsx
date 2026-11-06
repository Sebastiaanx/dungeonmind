import { useEffect, useState } from 'react';
import type { Character } from '@dungeonmind/shared';
import { api, upload } from '../api';
import { Busy } from './Busy';

const STYLES = ['painterly dark fantasy', 'ink and watercolor', 'grim oil painting', 'charcoal sketch', 'heroic illustration'];

/** Measured on a Tesla T4 at 320 × 400: four portraits take about 80 seconds. */
const SECONDS = { 1: 25, 4: 80 } as const;

/**
 * Portraits painted on the server and kept on the character: leave the page and they're still here.
 * Make 4 or 1 more, pick one, delete the ones you don't want, or upload your own.
 */
export function PortraitPicker({ c, onChanged }: { c: Character; onChanged: (c: Character) => void }) {
  const [style, setStyle] = useState(STYLES[0]);
  const [extra, setExtra] = useState('');
  const [error, setError] = useState('');
  const job = c.portraitJob && Date.now() - c.portraitJob.since < 10 * 60_000 ? c.portraitJob : undefined;
  const options = c.portraitOptions ?? [];

  // While painting, look again every few seconds; the result lands on the character.
  useEffect(() => {
    if (!job) return;
    const t = setInterval(async () => onChanged((await api<{ character: Character }>(`/api/characters/${c.id}`, { quiet: true })).character), 3000);
    return () => clearInterval(t);
  }, [!!job, c.id]);

  const paint = async (count: 1 | 4) => {
    setError('');
    try {
      onChanged(await api<Character>(`/api/characters/${c.id}/portraits`, { body: { style, count, extra }, quiet: true }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="card space-y-3">
      <h2 className="rune-title">Portrait</h2>
      {job &&
        (job.position > 0 ? (
          <Busy since={job.since} text={`Waiting in the picture queue (#${job.position}). Another picture is being painted first.`} />
        ) : (
          <Busy since={job.since} text={`Painting ${job.count === 1 ? 'one portrait' : 'four portraits'}. This takes about ${SECONDS[job.count === 1 ? 1 : 4]} seconds; you can leave this page.`} />
        ))}
      {(error || c.portraitError) && <p className="text-sm text-red-300">{error || `The last portraits failed: ${c.portraitError}`}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={style} onChange={(e) => setStyle(e.target.value)}>
          {STYLES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="btn" disabled={!!job} onClick={() => paint(4)} title="About 80 seconds">
          Make 4 portraits
        </button>
        <button className="btn-ghost" disabled={!!job} onClick={() => paint(1)} title="About 25 seconds">
          Make 1 more
        </button>
        <label className="btn-ghost cursor-pointer">
          Upload my own
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) onChanged(await upload<Character>(`/api/characters/${c.id}/portrait/upload`, f));
            }}
          />
        </label>
      </div>
      <input className="input" maxLength={300} placeholder="Add to the picture (optional), e.g. a scar over the left eye, silver hair, a hooded cloak" value={extra} onChange={(e) => setExtra(e.target.value)} />
      <p className="text-xs text-slate-500">Uses the appearance from the Story section plus what you add here. Pictures are always safe for work and only show adults. Four take about 80 seconds, one about 25.</p>
      {options.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {options.map((o) => (
            <div key={o} className={`dm-pop relative overflow-hidden rounded-lg border-2 ${c.portrait === o ? 'border-indigo-400' : 'border-transparent hover:border-indigo-700'}`}>
              <button className="block w-full" title="Use this portrait" onClick={async () => onChanged(await api<Character>(`/api/characters/${c.id}/portrait`, { body: { url: o } }))}>
                <img src={o} alt="Portrait option" className="aspect-[4/5] w-full object-cover" />
              </button>
              {c.portrait === o ? (
                <span className="absolute left-1 top-1 rounded bg-indigo-600 px-1.5 text-[10px] text-white">In use</span>
              ) : (
                <button
                  className="absolute right-1 top-1 rounded-full bg-black/70 px-2 text-xs text-red-200 opacity-80 hover:opacity-100"
                  title="Delete this portrait"
                  onClick={async () => onChanged(await api<Character>(`/api/characters/${c.id}/portraits?url=${encodeURIComponent(o)}`, { method: 'DELETE' }))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
