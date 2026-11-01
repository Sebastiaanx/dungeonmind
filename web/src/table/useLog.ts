import { useEffect, useState } from 'react';
import type { LogEntry } from '@dungeonmind/shared';
import { api } from '../api';
import { getSocket } from '../socket';

/** The story log, live: new entries, the narration while it streams, and hidden (rerolled) entries. */
export function useLog(gameId: string) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [streaming, setStreaming] = useState('');
  /** The story is written; the DM is still updating the game. */
  const [written, setWritten] = useState(false);
  useEffect(() => {
    api<LogEntry[]>(`/api/games/${gameId}/log`, { quiet: true }).then(setLog).catch(() => {});
    const s = getSocket();
    const onLog = (m: { gameId: string; entry: LogEntry }) => {
      if (m.gameId !== gameId) return;
      setLog((l) => (l.some((e) => e.id === m.entry.id) ? l : [...l, m.entry]));
      if (m.entry.kind === 'narration') {
        setStreaming('');
        setWritten(false);
      }
    };
    const onStream = (m: { gameId: string; text: string }) => m.gameId === gameId && setStreaming((x) => x + m.text);
    const onReset = (m: { gameId: string }) => {
      if (m.gameId !== gameId) return;
      setStreaming('');
      setWritten(false);
    };
    const onWritten = (m: { gameId: string }) => m.gameId === gameId && setWritten(true);
    const onHidden = (m: { gameId: string; fromId: number; kinds: string[] }) => m.gameId === gameId && setLog((l) => l.filter((e) => !(e.id > m.fromId && m.kinds.includes(e.kind))));
    s.on('game:log', onLog);
    s.on('game:stream', onStream);
    s.on('game:stream-reset', onReset);
    s.on('game:stream-end', onReset);
    s.on('game:stream-written', onWritten);
    s.on('game:log-hidden', onHidden);
    return () => {
      s.off('game:log', onLog);
      s.off('game:stream', onStream);
      s.off('game:stream-reset', onReset);
      s.off('game:stream-end', onReset);
      s.off('game:stream-written', onWritten);
      s.off('game:log-hidden', onHidden);
    };
  }, [gameId]);
  const loadOlder = async () => {
    if (!log.length) return;
    const older = await api<LogEntry[]>(`/api/games/${gameId}/log?before=${log[0].id}`);
    setLog((l) => [...older, ...l]);
    return older.length;
  };
  return { log, streaming, written, loadOlder };
}
