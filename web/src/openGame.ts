import { useEffect, useState } from 'react';

export interface OpenGame {
  id: string;
  name: string;
  ended: boolean;
}

const KEY = 'dm.openGame';

function read(): OpenGame | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

let open = read();
const subs = new Set<(g: OpenGame | null) => void>();

/** The game on the top bar's tab: the table you're at, or the last one you left. */
export function setOpenGame(g: OpenGame | null) {
  open = g;
  try {
    if (g) localStorage.setItem(KEY, JSON.stringify(g));
    else localStorage.removeItem(KEY);
  } catch {}
  subs.forEach((f) => f(g));
}

export function useOpenGame() {
  const [g, setG] = useState(open);
  useEffect(() => {
    subs.add(setG);
    return () => void subs.delete(setG);
  }, []);
  return g;
}
