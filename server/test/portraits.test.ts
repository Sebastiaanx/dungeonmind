import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeHiveMind, PNG } from './fake-hivemind.js';
import { CANVASES, freshApp, setupGame } from './helpers.js';

let app: FastifyInstance;
const hm = new FakeHiveMind();
let t: Awaited<ReturnType<typeof setupGame>>;
let libId: string;

beforeAll(async () => {
  await hm.start();
  app = await freshApp({ HIVEMIND_URL: hm.url, HIVEMIND_TOKEN: hm.token });
  for (const id of CANVASES) hm.canvases.set(id, { id, nodes: [] });
  hm.onRun = (c) => {
    if (c.canvasId.startsWith('dnd-portrait') || c.canvasId === 'dnd-scene') {
      const n = c.canvasId === 'dnd-portrait' ? 4 : 1;
      const files = Array.from({ length: n }, (_, i) => `images/${c.canvasId}-${hm.calls.length}-${i}.png`);
      for (const f of files) hm.files.set(f, PNG);
      return { outputs: { [c.canvasId === 'dnd-scene' ? 'scene' : 'portraits']: files.map((f) => `![image](hm-file:${f})`).join('\n') } };
    }
    if (c.canvasId === 'dnd-narrate') return { outputs: { narration: 'A storm.', state: JSON.stringify({ image: 'A storm over the marsh', choices: {} }) } };
    if (c.canvasId === 'dnd-chronicle') return { outputs: { patches: '{"patches":[]}' } };
    return { outputs: {} };
  };
  t = await setupGame(app);
  libId = (await t.as(t.host, 'GET', '/api/characters')).json()[0].id;
});
afterAll(async () => {
  await app?.close();
  await hm.stop();
});

describe('portraits', () => {
  let options: string[];

  const painted = async () => {
    for (let i = 0; i < 200; i++) {
      const c = (await t.as(t.host, 'GET', `/api/characters/${libId}`)).json().character;
      if (!c.portraitJob) return c;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('the portraits never finished');
  };

  it('makes 4 options in one HiveMind run and keeps them on the character', async () => {
    const r = await t.as(t.host, 'POST', `/api/characters/${libId}/portraits`, { style: 'charcoal sketch' });
    expect(r.statusCode).toBe(200);
    expect(r.json().portraitJob).toMatchObject({ count: 4 });
    options = (await painted()).portraitOptions;
    expect(options).toHaveLength(4);
    expect(hm.callsOf('dnd-portrait')[0]).toMatchObject({ vars: { style: 'charcoal sketch' } });
    expect(hm.callsOf('dnd-portrait')[0].question).toContain('Turks');
    const img = await t.as(t.host, 'GET', options[0]);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
  });

  it('makes one more, keeps the earlier ones, and deletes one', async () => {
    await t.as(t.host, 'POST', `/api/characters/${libId}/portraits`, { count: 1, extra: 'a scar over the left eye' });
    const c = await painted();
    expect(c.portraitOptions).toHaveLength(5);
    expect(hm.callsOf('dnd-portrait-one')[0].question).toContain('a scar over the left eye');
    expect(hm.callsOf('dnd-portrait-one')[0].question).toContain('adults only');
    const left = (await t.as(t.host, 'DELETE', `/api/characters/${libId}/portraits?url=${encodeURIComponent(c.portraitOptions[0])}`)).json();
    expect(left.portraitOptions).toHaveLength(4);
  });

  it('refuses words that would make a picture unsafe', async () => {
    const r = await t.as(t.host, 'POST', `/api/characters/${libId}/portraits`, { extra: 'naked' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/safe for work/);
    expect((await t.as(t.host, 'POST', `/api/characters/${libId}/portraits`, { extra: 'as a little girl' })).statusCode).toBe(400);
    const { withoutUnsafe, unsafeReason } = await import('../src/safety.js');
    expect(unsafeReason('a grim knight in black armour')).toBeUndefined();
    expect(withoutUnsafe('a naked child in the snow')).toBe('a in the snow');
  });

  it('picks one; the game copy of the character gets it too', async () => {
    expect((await t.as(t.host, 'POST', `/api/characters/${libId}/portrait`, { url: '/etc/passwd' })).statusCode).toBe(400);
    const c = (await t.as(t.host, 'POST', `/api/characters/${libId}/portrait`, { url: options[2] })).json();
    expect(c.portrait).toBe(options[2]);
    const g = (await t.as(t.host, 'GET', `/api/games/${t.id}`)).json();
    expect(g.characters.find((x: any) => x.name === 'Turks').portrait).toBe(options[2]);
  });

  it('uploads your own image, checking what it really is', async () => {
    const bad = await app.inject({ method: 'POST', url: `/api/characters/${libId}/portrait/upload`, headers: { cookie: t.host, 'content-type': 'image/png' }, payload: Buffer.from('<svg onload=alert(1)>') });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: `/api/characters/${libId}/portrait/upload`, headers: { cookie: t.host, 'content-type': 'image/png' }, payload: PNG });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().portrait).toMatch(/^\/api\/images\/portrait-.+\.png$/);
    const other = await app.inject({ method: 'POST', url: `/api/characters/${libId}/portrait/upload`, headers: { cookie: t.pl, 'content-type': 'image/png' }, payload: PNG });
    expect(other.statusCode).toBe(404);
  });

  it('reports a missing image model clearly', async () => {
    const before = hm.onRun;
    hm.onRun = () => ({ outputs: { portraits: 'No image model selected' } });
    await t.as(t.host, 'POST', `/api/characters/${libId}/portraits`, {});
    expect((await painted()).portraitError).toMatch(/no images/);
    hm.onRun = before;
  });
});

describe('scene images', () => {
  it('paints the scene only when someone at the table asks for it', async () => {
    await t.as(t.host, 'POST', `/api/games/${t.id}/start`);
    const turn = await import('../src/game/turn.js');
    await turn.settled(t.id);
    expect(hm.callsOf('dnd-scene')).toHaveLength(0);
    expect((await t.as(t.pl, 'POST', `/api/games/${t.id}/scene-image`)).statusCode).toBe(200);
    let g: any;
    for (let i = 0; i < 40; i++) {
      g = (await t.as(t.pl, 'GET', `/api/games/${t.id}`)).json();
      if (g.state.sceneImage && !g.state.paintingSince) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(g.state.sceneImage).toMatch(/^\/api\/images\/scene-/);
    expect(g.state.paintingSince).toBeUndefined();
    // The picture lives in HiveMind's dungeon folder; DungeonMind asks for it over the API.
    const name = g.state.sceneImage.split('/').pop();
    expect(hm.files.has(`outputs/dungeon/${name}`)).toBe(true);
    expect((await t.as(t.pl, 'GET', g.state.sceneImage)).statusCode).toBe(200);
    expect(hm.callsOf('dnd-scene')[0].question).toBe('A storm over the marsh');
    const log = (await t.as(t.pl, 'GET', `/api/games/${t.id}/log`)).json();
    expect(log.some((e: any) => e.kind === 'image' && e.data.url === g.state.sceneImage)).toBe(true);
  });
});
