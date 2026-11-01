import { useEffect, useState } from 'react';

/** Slow AI work in progress: a spinner and the seconds so far, so it never looks stuck. */
export function Busy({ text, since }: { text: string; since?: number }) {
  const [start] = useState(() => since ?? Date.now());
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.round((now - start) / 1000));
  return (
    <div role="status" className="flex items-center gap-2 rounded-md border border-indigo-700 bg-indigo-950/50 px-3 py-2 text-sm text-indigo-100">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-transparent" />
      <span className="min-w-0 flex-1">{text}</span>
      <span className="shrink-0 font-mono text-xs text-indigo-300">{seconds}s</span>
    </div>
  );
}
