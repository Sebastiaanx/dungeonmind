import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeHiveMind, type FakeRun } from './fake-hivemind.js';
import { CANVASES, freshApp, settle, setupGame } from './helpers.js';

let app: FastifyInstance;
const hm = new FakeHiveMind();
let turn: typeof import('../src/game/turn.js');
let ideas = (names: string[]) => Object.fromEntries(names.map((n) => [n, [`${n} hides`, `${n} charges`, `${n} talks`, `${n} runs`]]));

beforeAll(async () => {
  await hm.start();
  app = await freshApp({ HIVEMIND_URL: hm.url, HIVEMIND_TOKEN: hm.token });
  turn = await import('../src/game/turn.js');
  for (const id of CANVASES) hm.canvases.set(id, { id, nodes: [] });
  hm.onRun = (c): FakeRun => {
    // The state JSON no longer brings choices.
    if (c.canvasId === 'dnd-narrate') return { stream: { label: 'narration', text: 'Fog.' }, outputs: { narration: 'Fog.', state: JSON.stringify({ speakers: [], summary: 'x', sceneEnd: false }) } };
    if (c.canvasId === 'dnd-suggest') return { outputs: { choices: JSON.stringify({ choices: ideas(c.question.split('\n')) }) } };
    if (c.canvasId === 'dnd-adjudicate') return { outputs: { rolls: JSON.stringify({ rolls: [], resources: [], refused: [] }) } };
    if (c.canvasId === 'dnd-chronicle') return { outputs: { patches: JSON.stringify({ patches: [] }) } };
    return { outputs: {} };
  };
});
afterAll(async () => {
  await app?.close();
  await hm.stop();
});

describe('suggested actions', () => {
  let t: Awaited<ReturnType<typeof setupGame>>;
  const game = async () => (await t.as(t.host, 'GET', `/api/games/${t.id}`)).json();
  const until = async (ok: () => Promise<boolean>) => {
    for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 20));
  };

  it('come once for everyone with the opening scene, in one call', async () => {
    t = await setupGame(app);
    await t.as(t.host, 'POST', `/api/games/${t.id}/start`);
    await turn.settled(t.id);
    await until(async () => !!(await game()).state.choices[t.plChar]?.length);
    const g = await game();
    expect(g.state.choices[t.hostChar]).toEqual(['Turks hides', 'Turks charges', 'Turks talks', 'Turks runs']);
    expect(g.state.choices[t.plChar]).toEqual(['Esva hides', 'Esva charges', 'Esva talks', 'Esva runs']);
    expect(hm.callsOf('dnd-suggest')).toHaveLength(1);
    expect(hm.callsOf('dnd-suggest')[0].vars.party).toContain('Turks');
  });

  it('are not part of a normal turn', async () => {
    await t.as(t.host, 'POST', `/api/games/${t.id}/actions`, { characterId: t.hostChar, choice: 0 });
    await t.as(t.pl, 'POST', `/api/games/${t.id}/actions`, { characterId: t.plChar, text: 'I pray' });
    await turn.settled(t.id);
    const g = await game();
    expect(g.state.turn).toBe(2);
    expect(g.state.choices).toEqual({});
    expect(hm.callsOf('dnd-suggest')).toHaveLength(1);
  });

  it('come on request, for your own character only', async () => {
    expect((await t.as(t.pl, 'POST', `/api/games/${t.id}/suggest`, { characterId: t.hostChar })).statusCode).toBe(403);
    ideas = (names) => ({ [names[0].toUpperCase()]: ['Sneak', 'Strike', 'Shout', 'Search', 'Sing'] });
    const r = await settle(app, t.pl, await t.as(t.pl, 'POST', `/api/games/${t.id}/suggest`, { characterId: t.plChar }));
    expect(r.statusCode).toBe(200);
    const g = await game();
    expect(g.state.choices[t.plChar]).toEqual(['Sneak', 'Strike', 'Shout', 'Search']);
    expect(g.state.choices[t.hostChar]).toBeUndefined();
    expect(hm.callsOf('dnd-suggest').at(-1)!.question).toBe('Esva');
    // A suggested choice is a normal action.
    expect((await t.as(t.pl, 'POST', `/api/games/${t.id}/actions`, { characterId: t.plChar, choice: 1 })).statusCode).toBe(200);
    expect((await game()).state.actions[t.plChar].text).toBe('Strike');
  });

  it('a DM failure is an error for the asker, not for the game', async () => {
    const before = hm.onRun;
    hm.onRun = (c) => (c.canvasId === 'dnd-suggest' ? { outputs: { choices: 'not json' } } : before!(c));
    const r = await settle(app, t.host, await t.as(t.host, 'POST', `/api/games/${t.id}/suggest`, { characterId: t.hostChar }));
    hm.onRun = before;
    expect(r.statusCode).toBe(502);
    expect((await game()).state.phase).toBe('collect');
  });
});
