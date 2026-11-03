import { useEffect, useState } from 'react';
import { getSocket } from '../socket';

/** Someone typing their own action shows as typing for this long after the last key. */
const TYPING_MS = 6000;

const typingAt = new Map<string, number>();
let lastSent = 0;

/** Tells the table this character's player is typing an action (at most every 2 seconds), or stopped. */
export function sendTyping(gameId: string, characterId: string, typing: boolean) {
  const now = Date.now();
  if (typing && now - lastSent < 2000) return;
  lastSent = typing ? now : 0;
  getSocket().emit('game:typing', { gameId, characterId, typing });
}

/** Which characters' players are typing right now. */
export function useTyping(gameId: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const s = getSocket();
    const on = (m: { gameId: string; characterId: string; typing: boolean }) => {
      if (m.gameId !== gameId) return;
      if (m.typing) typingAt.set(m.characterId, Date.now());
      else typingAt.delete(m.characterId);
      tick((n) => n + 1);
    };
    s.on('game:typing', on);
    // Typing fades by itself when the signals stop.
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      s.off('game:typing', on);
      clearInterval(t);
    };
  }, [gameId]);
  return (characterId: string) => Date.now() - (typingAt.get(characterId) ?? 0) < TYPING_MS;
}
