/** Milliseconds per word: slow enough that the narrator's audio is made by the time the text has run out. */
export const INK_MS = 150;

/** How many words of the narration coming in are on screen; the finished narration carries on from there. */
export const streamInk = { words: 0 };

/** Plain text, without the ink, for those who turned animations off or prefer less motion. */
export const animated = (prefs: Record<string, unknown>) => prefs.animations !== false && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
