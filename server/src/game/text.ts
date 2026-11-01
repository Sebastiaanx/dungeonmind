export const titleCase = (id: string) => id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
/** Loose name matching for what the AI writes ("esvahanna", "Esvahanna the Pale"). */
export const sameName = (a: string | undefined, b: string | undefined) => {
  if (!a || !b) return false;
  const norm = (s: string) => s.toLowerCase().trim().replace(/^(the|a|an)\s+/, '');
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  const fx = x.split(/\s+/)[0];
  return fx.length > 2 && fx === y.split(/\s+/)[0] && (!x.includes(' ') || !y.includes(' '));
};
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A model that breaks down writes number soup or the same words over and over instead of a story. */
export function garbled(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 12) return false;
  if (words.filter((w) => /\d/.test(w)).length / words.length > 0.15) return true;
  const tail = words.slice(-40);
  if (tail.length === 40 && new Set(tail).size <= 8) return true;
  let same = 1;
  for (let i = 1; i < words.length; i++) {
    same = words[i] === words[i - 1] ? same + 1 : 1;
    if (same >= 6) return true;
  }
  return false;
}
