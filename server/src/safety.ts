/**
 * Pictures stay safe for work and never show children. Two layers, all inside DungeonMind:
 * words a person adds are checked before anything is sent, and every prompt carries the safe wording.
 * The image canvases add the matching negative prompt (scripts/build-canvases.mjs).
 */

const SEXUAL = 'nsfw|nude|nudes|naked|nudity|topless|bottomless|nipples?|genitals?|penis|vagina|breasts?|boobs?|tits|butt|ass|sex|sexy|sexual|erotic|porn\\w*|hentai|lewd|fetish|bdsm|lingerie|underwear|panties|bra|bikini|seductive|aroused|orgasm|striptease|stripping|undress\\w*|cum|horny';
const MINORS = 'child|children|kid|kids|minor|minors|underage|baby|babies|toddler|infant|teen|teens|teenager|teenage|preteen|young girl|young boy|little girl|little boy|schoolgirl|schoolboy|loli|lolita|shota|\\d{1,2} ?(?:years? old|yo)';
const BLOCKED = new RegExp(`\\b(?:${SEXUAL}|${MINORS})\\b`, 'i');

/** Said to everyone before a picture is made. */
export const SAFE_WORDS = 'safe for work, fully clothed, adults only';

/** Why a text can't go into a picture, or undefined when it's fine. */
export function unsafeReason(text: string): string | undefined {
  const hit = BLOCKED.exec(text);
  return hit ? `"${hit[0]}" can't be used in a picture. Pictures stay safe for work and only show adults.` : undefined;
}

/** For text the AI wrote (a scene): the blocked words come out instead of refusing the picture. */
export const withoutUnsafe = (text: string) => text.replace(new RegExp(BLOCKED.source, 'gi'), '').replace(/\s{2,}/g, ' ').trim();
