// The rules and the game state keep feet (5e counts in steps of 5 ft); people always see metres.

const WORDS: Record<string, number> = { five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100 };

/** 5e's own conversion: 5 ft is 1.5 m. */
export const metres = (ft: number) => `${Math.round(ft * 3) / 10} m`;

const FEET = new RegExp(`\\b(\\d[\\d,]*|${Object.keys(WORDS).join('|')})[\\s-]*(?:feet\\b|foot\\b|ft\\b(?:\\.(?=\\s*[a-z,;)]))?)`, 'gi');

/** Rewrites distances in a text ("30 ft", "a 20-foot cone", "ten feet") to metres. */
export const toMetric = (text: string) => text.replace(FEET, (_, n: string) => metres(WORDS[n.toLowerCase()] ?? Number(n.replace(/,/g, ''))));
