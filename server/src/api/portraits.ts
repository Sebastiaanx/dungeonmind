import type { FastifyInstance } from 'fastify';
import { classLine, type Character } from '@dungeonmind/shared';
import { requireUser } from '../auth/index.js';
import { db } from '../db.js';
import { addLog, readLog } from '../game/log.js';
import { broadcast, gameCharacters, loadGame, saveGame, saveGameCharacter } from '../game/store.js';
import { titleCase } from '../game/text.js';
import { deleteFile, fetchFile, HiveMindError, imagePaths, runCanvas, withRetry } from '../hivemind.js';
import { deleteImage, saveImage } from '../images.js';
import { think } from '../game/queue.js';
import { logProblem } from '../problems.js';
import { SAFE_WORDS, unsafeReason, withoutUnsafe } from '../safety.js';
import { loadCharacter, saveCharacter } from './characters.js';
import { gameFor } from './games.js';

const STYLES = ['painterly dark fantasy', 'ink and watercolor', 'grim oil painting', 'charcoal sketch', 'heroic illustration'];

/** One picture at a time on the GPU; the ones waiting know their place in the queue. */
const waiting: { start: () => void; onPosition?: (n: number) => void }[] = [];
let painting = false;
function nextPicture() {
  if (painting) return;
  const next = waiting.shift();
  waiting.forEach((w, i) => w.onPosition?.(i + 1));
  if (!next) return;
  painting = true;
  next.start();
}
async function inPictureQueue<T>(fn: () => Promise<T>, onPosition?: (n: number) => void): Promise<T> {
  await new Promise<void>((start) => {
    waiting.push({ start, onPosition });
    onPosition?.(painting ? waiting.length : 0);
    nextPicture();
  });
  onPosition?.(0);
  try {
    return await fn();
  } finally {
    painting = false;
    nextPicture();
  }
}

/** Runs an image canvas and moves every picture into the dungeon folder in HiveMind. */
export async function generateImages(canvasId: string, label: string, question: string, vars: Record<string, string>, prefix: string, onPosition?: (n: number) => void): Promise<string[]> {
  const out = await inPictureQueue(() => withRetry(() => runCanvas(canvasId, question, { vars }), { attempts: 2 }), onPosition);
  const paths = imagePaths(out.outputs[label]?.text ?? '');
  if (!paths.length) throw new HiveMindError('HiveMind made no images (is an image model set on the canvas?)', 0, false);
  const urls: string[] = [];
  for (const p of paths.slice(0, 8)) {
    const f = await fetchFile(p);
    urls.push(await saveImage(f.data, prefix));
    await deleteFile(p).catch(() => {});
  }
  return urls;
}

/** Library character portraits also update the copies of that character in games. */
function setPortrait(characterId: string, url: string) {
  const c = loadCharacter(characterId)!;
  c.portrait = url;
  saveCharacter(c);
  for (const r of db.prepare('SELECT game_id, id FROM game_characters WHERE source_id = ?').all(characterId) as { game_id: string; id: string }[]) {
    const gc = gameCharacters(r.game_id).find((x) => x.id === r.id);
    if (!gc) continue;
    gc.portrait = url;
    saveGameCharacter(r.game_id, gc);
    const g = loadGame(r.game_id);
    if (g) broadcast(g);
  }
  return c;
}

/** A picture that takes longer than this was lost (a restart): someone may ask again. */
const PAINTING_MS = 10 * 60_000;

export function portraitRoutes(app: FastifyInstance) {
  /** Scene pictures slow the game down, so they're only made when someone at the table asks for one. */
  app.post('/api/games/:id/scene-image', { preHandler: requireUser }, async (req, reply) => {
    const r = await gameFor(req, reply, 'member');
    if (!r) return;
    const { g } = r;
    if (g.settings.sceneImages === false) return reply.code(409).send({ error: 'The host turned scene pictures off for this game' });
    if (g.state.paintingSince && Date.now() - g.state.paintingSince < PAINTING_MS) return reply.code(409).send({ error: 'A picture is already being painted' });
    const told = g.state.scenePrompt || readLog(g.id, { limit: 20, kinds: ['narration'] }).at(-1)?.text.slice(0, 600);
    const prompt = told && withoutUnsafe(told);
    if (!prompt) return reply.code(409).send({ error: 'Nothing has happened yet to paint' });
    g.state.paintingSince = Date.now();
    saveGame(g);
    broadcast(g);
    const finish = (url?: string) => {
      const fresh = loadGame(g.id);
      if (!fresh) return;
      fresh.state.paintingSince = undefined;
      if (url) {
        fresh.state.sceneImage = url;
        addLog(g.id, fresh.state.turn - 1, 'image', prompt, undefined, { url });
      }
      saveGame(fresh);
      broadcast(fresh);
    };
    void think(g.id, () => generateImages('dnd-scene', 'scene', prompt, { tableId: g.id }, 'scene'))
      .then(([url]) => finish(url))
      .catch((err) => {
        logProblem('image', err, `Game "${g.name}" (${g.id})`);
        addLog(g.id, g.state.turn, 'note', `No picture this time (${(err as Error).message}).`);
        finish();
      });
    return { ok: true };
  });

  /**
   * Portrait options (4, or 1 more). They're painted on the server and kept on the character,
   * so leaving the page loses nothing; the player picks one or deletes the ones they don't want.
   */
  app.post('/api/characters/:id/portraits', { preHandler: requireUser }, async (req, reply) => {
    const c = loadCharacter((req.params as { id: string }).id);
    if (!c || c.ownerId !== req.user!.id) return reply.code(404).send({ error: 'Not found' });
    if (c.portraitJob && Date.now() - c.portraitJob.since < PAINTING_MS) return reply.code(409).send({ error: 'These portraits are still being painted' });
    const body = (req.body ?? {}) as { style?: string; count?: number; extra?: string };
    const style = STYLES.includes(String(body.style)) ? body.style! : STYLES[0];
    const extra = String(body.extra ?? '').trim().slice(0, 300);
    const why = unsafeReason(`${extra} ${c.appearance ?? ''}`);
    if (why) return reply.code(400).send({ error: why });
    const count = body.count === 1 ? 1 : 4;
    const who = `${c.name}, a ${titleCase(c.subspecies ?? c.species)} ${classLine(c, titleCase, false)}${c.appearance ? `. ${c.appearance}` : ''}${extra ? `. ${extra}` : ''}. ${SAFE_WORDS}.`;
    c.portraitJob = { since: Date.now(), count, position: 0 };
    c.portraitError = undefined;
    saveCharacter(c);
    const update = (fn: (x: Character) => void) => {
      const fresh = loadCharacter(c.id);
      if (!fresh) return;
      fn(fresh);
      saveCharacter(fresh);
    };
    void generateImages(count === 1 ? 'dnd-portrait-one' : 'dnd-portrait', 'portraits', who, { style }, 'option', (n) => update((x) => x.portraitJob && (x.portraitJob.position = n)))
      .then((urls) =>
        update((x) => {
          x.portraitOptions = [...urls, ...(x.portraitOptions ?? [])].slice(0, 24);
          x.portraitJob = undefined;
        }),
      )
      .catch((err) => {
        logProblem('image', err, `Portraits for ${c.name} (${c.id})`);
        update((x) => {
          x.portraitJob = undefined;
          x.portraitError = (err as Error).message;
        });
      });
    return loadCharacter(c.id);
  });

  /** Throws away one portrait option; the one in use stays where it is. */
  app.delete('/api/characters/:id/portraits', { preHandler: requireUser }, async (req, reply) => {
    const c = loadCharacter((req.params as { id: string }).id);
    if (!c || c.ownerId !== req.user!.id) return reply.code(404).send({ error: 'Not found' });
    const url = String((req.query as { url?: string }).url ?? '');
    if (!c.portraitOptions?.includes(url)) return reply.code(404).send({ error: 'No such portrait option' });
    c.portraitOptions = c.portraitOptions.filter((x) => x !== url);
    saveCharacter(c);
    if (c.portrait !== url) await deleteImage(url).catch(() => {});
    return c;
  });

  app.post('/api/characters/:id/portrait', { preHandler: requireUser }, async (req, reply) => {
    const c = loadCharacter((req.params as { id: string }).id);
    if (!c || c.ownerId !== req.user!.id) return reply.code(404).send({ error: 'Not found' });
    const url = String((req.body as { url?: string })?.url ?? '');
    if (!/^\/api\/images\/option-[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$/.test(url)) return reply.code(400).send({ error: 'Pick one of the generated options' });
    return setPortrait(c.id, url);
  });

  /** Upload your own portrait (raw image body). */
  app.post('/api/characters/:id/portrait/upload', { preHandler: requireUser }, async (req, reply) => {
    const c = loadCharacter((req.params as { id: string }).id);
    if (!c || c.ownerId !== req.user!.id) return reply.code(404).send({ error: 'Not found' });
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: 'Send the image file' });
    try {
      return setPortrait(c.id, await saveImage(req.body, 'portrait'));
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
