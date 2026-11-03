import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeHiveMind, type FakeCall, type FakeRun } from './fake-hivemind.js';
import { CANVASES, freshApp, setupGame } from './helpers.js';

let app: FastifyInstance;
const hm = new FakeHiveMind();
let turn: typeof import('../src/game/turn.js');
let engine: typeof import('../src/game/engine.js');
let t: Awaited<ReturnType<typeof setupGame>>;

function narrate(c: FakeCall): FakeRun {
  const party = JSON.parse(c.vars.party).characters.map((x: any) => x.name);
  return {
    outputs: {
      narration: 'The hag circles.',
      state: JSON.stringify({
        deltas: [],
        xp: [],
        npcs: [{ name: 'The Bell-Hag', hp: 300, maxHp: 300, ac: 15, dex: 2, status: 'hostile' }],
        combat: null,
        choices: Object.fromEntries(party.map((n: string) => [n, ['Attack', 'Defend', 'Pray', 'Flee']])),
        speakers: [{ name: 'narrator', kind: 'narrator' }],
        summary: 'Fight.',
        sceneEnd: false,
      }),
    },
  };
}

beforeAll(async () => {
  await hm.start();
  app = await freshApp({ HIVEMIND_URL: hm.url, HIVEMIND_TOKEN: hm.token });
  turn = await import('../src/game/turn.js');
  engine = await import('../src/game/engine.js');
  for (const id of CANVASES) hm.canvases.set(id, { id, nodes: [] });
  hm.onRun = (c) => {
    if (c.canvasId === 'dnd-narrate') return narrate(c);
    if (c.canvasId === 'dnd-chronicle') return { outputs: { patches: '{"patches":[]}' } };
    if (c.canvasId === 'dnd-adjudicate')
      return {
        outputs: {
          rolls: JSON.stringify({
            rolls: [
              { id: 'a1', actor: 'Turks', kind: 'attack', target: 'The Bell-Hag', weapon: 'Longsword' },
              { id: 'a2', actor: 'Turks', kind: 'damage', target: 'The Bell-Hag', onHit: 'a1', weapon: 'Longsword' },
              { id: 's1', actor: 'Esva', kind: 'save', ability: 'wis', dc: 14 },
              { id: 'h1', actor: 'The Bell-Hag', kind: 'attack', target: 'Esva', bonus: 5 },
            ],
          }),
        },
      };
    return { outputs: {} };
  };
  t = await setupGame(app);
  await t.as(t.host, 'POST', `/api/games/${t.id}/start`);
  await turn.settled(t.id);
});
afterAll(async () => {
  await app?.close();
  await hm.stop();
});

const game = async () => (await t.as(t.host, 'GET', `/api/games/${t.id}`)).json();
const log = async () => (await t.as(t.pl, 'GET', `/api/games/${t.id}/log`)).json().filter((e: any) => e.kind === 'roll');
async function nextTurn() {
  await t.as(t.host, 'POST', `/api/games/${t.id}/actions`, { characterId: t.hostChar, choice: 0 });
  await t.as(t.pl, 'POST', `/api/games/${t.id}/actions`, { characterId: t.plChar, choice: 1 });
  await turn.settled(t.id);
  return game();
}

describe('table flow', () => {
  it('the host turns on the roll timer and hidden DCs during play', async () => {
    expect((await game()).state.phase).toBe('collect');
    expect((await t.as(t.pl, 'PUT', `/api/games/${t.id}`, { rollTimer: 30 })).statusCode).toBe(403);
    const g = (await t.as(t.host, 'PUT', `/api/games/${t.id}`, { rollTimer: 30, hideTargets: true })).json();
    expect(g.settings).toMatchObject({ rollTimer: 30, hideTargets: true });
  });

  it('rolls a player can make get a deadline; the log hides the AC', async () => {
    const before = Date.now();
    const g = await nextTurn();
    expect(g.state.phase).toBe('rolling');
    const atk = g.state.rolls.find((r: any) => r.id === 'r1');
    const dmg = g.state.rolls.find((r: any) => r.id === 'r2');
    expect(Date.parse(atk.deadline) - before).toBeGreaterThanOrEqual(29_000);
    expect(Date.parse(atk.deadline) - before).toBeLessThanOrEqual(31_000);
    expect(dmg.deadline).toBeUndefined(); // waits for the attack
    expect(g.state.rolls.find((r: any) => r.id === 'r4').deadline).toBeUndefined(); // the hag's, already rolled
    const hag = (await log()).find((e: any) => e.actor === 'The Bell-Hag');
    expect(hag.text).toMatch(/= \d+ — (hit|miss|critical hit!|natural 1, miss)/);
    expect(hag.text).not.toMatch(/vs AC/);
  });

  it('"Roll attack + damage" rolls the damage right after a hit', async () => {
    const r = (await t.as(t.host, 'POST', `/api/games/${t.id}/rolls/r1`, { mode: 'server', withDamage: true })).json();
    expect(r.error).toBeUndefined();
    const g = await game();
    const atk = g.state.rolls.find((x: any) => x.id === 'r1');
    const dmg = g.state.rolls.find((x: any) => x.id === 'r2');
    // A hit rolls the damage at once; a miss skips it. Either way nothing is left for Turks.
    expect(dmg.result).toBeDefined();
    expect(!!dmg.result.skipped).toBe(!atk.result.success);
  });

  it('when time runs out the server rolls for the idle player and the turn goes on', async () => {
    const waiting = (await game()).state.rolls.find((x: any) => x.id === 'r3');
    expect(waiting.result).toBeUndefined();
    engine.rollOverdue(Date.parse(waiting.deadline) - 1000);
    expect((await game()).state.rolls.find((x: any) => x.id === 'r3').result).toBeUndefined();
    engine.rollOverdue(Date.parse(waiting.deadline) + 1);
    const save = (await log()).find((e: any) => e.actor === 'Esva');
    expect(save.text).toMatch(/WIS save: d20 \d+ [+−] \d+ = \d+ — (success|failure) \(time ran out, the server rolled\)/);
    await turn.settled(t.id);
    // The last roll was in, so the DM narrated and the table waits for the next actions.
    expect((await game()).state.phase).toBe('collect');
  });

  it('turning the timer off clears the deadlines', async () => {
    await t.as(t.host, 'PUT', `/api/games/${t.id}`, { rollTimer: 0 });
    const g = await nextTurn();
    expect(g.state.phase).toBe('rolling');
    expect(g.state.rolls.every((r: any) => r.deadline === undefined)).toBe(true);
  });

  it('a one-shot bonus die is used up by the roll; Bless stays', async () => {
    for (const r of (await game()).state.rolls.filter((x: any) => !x.result && x.id !== 'r2')) await t.as(t.host, 'POST', `/api/games/${t.id}/rolls/${r.id}`, { mode: 'server', withDamage: true });
    await turn.settled(t.id);
    await t.as(t.host, 'PATCH', `/api/games/${t.id}/characters/${t.plChar}/override`, { conditions: [{ name: 'blessed' }, { name: 'inspired', source: 'Bardic Inspiration d6' }] });
    const g = await nextTurn();
    const save = g.state.rolls.find((r: any) => r.id === 'r3');
    expect(save.bonusDice.map((b: any) => b.from)).toEqual(['Bless', 'Bardic Inspiration']);
    await t.as(t.pl, 'POST', `/api/games/${t.id}/rolls/r3`, { mode: 'manual', values: [11, 2, 5] });
    const esva = (await game()).characters.find((c: any) => c.id === t.plChar);
    expect(esva.conditions.map((c: any) => c.name)).toEqual(['blessed']);
    expect((await log()).at(-1).text).toContain('d20 11 + Bless 1d4 (2) + Bardic Inspiration 1d6 (5)');
  });

  it('free rolls are logged for everyone and never change the game; the DM only sees asked checks', async () => {
    const before = await game();
    const free = await t.as(t.pl, 'POST', `/api/games/${t.id}/free-roll`, { expr: '2d6 + 3' });
    expect(free.statusCode).toBe(200);
    expect((await t.as(t.pl, 'POST', `/api/games/${t.id}/free-roll`, { expr: '1d20' })).json().error).toMatch(/One roll a second/);
    const fun = (await log()).at(-1);
    expect(fun.text).toMatch(/^Esva rolls 2d6\+3 just for fun: \[\d, \d\] \+ 3 = \d+$/);
    expect(fun.data).toMatchObject({ kind: 'free', faces: [{ sides: 6 }, { sides: 6 }] });
    const after = await game();
    expect(after.state).toEqual(before.state);
    expect(after.characters).toEqual(before.characters);

    await new Promise((r) => setTimeout(r, 1000));
    expect((await t.as(t.host, 'POST', `/api/games/${t.id}/free-roll`, { expr: '2d7' })).json().error).toMatch(/no d7/);
    expect((await t.as(t.host, 'POST', `/api/games/${t.id}/free-roll`, { characterId: t.hostChar, skill: 'perception' })).statusCode).toBe(200);
    const asked = (await log()).at(-1);
    expect(asked.text).toMatch(/^Turks asks for a perception check: d20 \d+ \+ \d+ = \d+$/);

    const { recentTurns } = await import('../src/game/prompt.js');
    const seen = recentTurns(t.id);
    expect(seen).toContain('Turks asks for a perception check');
    expect(seen).not.toContain('just for fun');
  });
});
