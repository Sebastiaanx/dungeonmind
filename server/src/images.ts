import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth/index.js';
import { config } from './config.js';
import { newId } from './crypto.js';
import { deleteFile, fetchFile, putFile } from './hivemind.js';
import { logProblem } from './problems.js';

/** Every image lives in HiveMind, in this folder of its files. DungeonMind only keeps the name and asks over the API. */
const FOLDER = 'outputs/dungeon';

/** Only for images from before they moved to HiveMind. */
const imageDir = () => {
  const d = join(config.dataDir, 'images');
  mkdirSync(d, { recursive: true });
  return d;
};

const TYPES: [string, string, (b: Buffer) => boolean][] = [
  ['png', 'image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['jpg', 'image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['webp', 'image/webp', (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
  ['gif', 'image/gif', (b) => b.toString('ascii', 0, 4) === 'GIF8'],
];

/** What kind of image the bytes really are (never trust the content-type). */
export const sniff = (b: Buffer) => TYPES.find(([, , test]) => b.length > 12 && test(b));

export const MAX_IMAGE = 8 * 1024 * 1024;

/** Stores an image in HiveMind and returns its URL here. */
export async function saveImage(data: Buffer, prefix = 'img'): Promise<string> {
  const t = sniff(data);
  if (!t) throw new Error('That is not a PNG, JPEG, WebP or GIF image');
  if (data.length > MAX_IMAGE) throw new Error('Images can be at most 8 MB');
  const path = await putFile(`${FOLDER}/${prefix}-${newId()}.${t[0]}`, data);
  return `/api/images/${path.split('/').pop()}`;
}

/** Removes a picture from HiveMind, by its URL here. */
export const deleteImage = (url: string) => deleteFile(`${FOLDER}/${url.split('/').pop()}`);

/** An image's bytes, by the file name in its URL. */
export async function readImage(file: string): Promise<Buffer | undefined> {
  const old = join(imageDir(), file);
  if (existsSync(old)) return readFileSync(old);
  return (await fetchFile(`${FOLDER}/${file}`).catch(() => undefined))?.data;
}

/** Moves images saved by earlier versions to HiveMind; what can't move now stays and is tried at the next start. */
export async function moveImagesToHiveMind() {
  for (const file of readdirSync(imageDir())) {
    try {
      await putFile(`${FOLDER}/${file}`, readFileSync(join(imageDir(), file)));
      rmSync(join(imageDir(), file));
    } catch (err) {
      logProblem('image', err, `Moving ${file} to HiveMind`);
      return;
    }
  }
}

export function imageRoutes(app: FastifyInstance) {
  // Raw image uploads (portraits).
  app.addContentTypeParser(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_IMAGE }, (_req, body, done) => done(null, body));

  app.get('/api/images/:file', { preHandler: requireUser }, async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[a-z]+-[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$/.test(file)) return reply.code(404).send({ error: 'Not found' });
    const data = await readImage(file);
    if (!data) return reply.code(404).send({ error: 'Not found' });
    reply.header('content-type', TYPES.find(([ext]) => file.endsWith(`.${ext}`))![1]);
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(data);
  });
}
