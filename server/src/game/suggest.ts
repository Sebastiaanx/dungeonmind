import { outputJson, runCanvas, withRetry } from '../hivemind.js';
import { logProblem } from '../problems.js';
import { recordCall } from '../trainer/records.js';
import { campaignFor, partyJson, recentTurns } from './prompt.js';
import { think } from './queue.js';
import { broadcast, gameCharacters, loadGame, saveGame, type GameRow } from './store.js';
import { clip, sameName } from './text.js';
import { activeCharacters, playersOf } from './turn.js';

/** Characters whose ideas are on their way ("gameId:characterId"), so a double click asks once. */
const asking = new Set<string>();

/**
 * Suggest Actions: 4 ideas per character, only when a player asks (and once for the opening scene).
 * Not part of the turn: the state JSON stays small and the table never waits for ideas nobody uses.
 * The ideas land in state.choices only if the turn hasn't moved on in the meantime. Throws when the DM fails.
 */
export async function suggestChoices(g: GameRow, characterIds: string[]): Promise<void> {
  const all = gameCharacters(g.id);
  const chars = activeCharacters(all).filter((c) => characterIds.includes(c.id) && !asking.has(`${g.id}:${c.id}`));
  if (!chars.length) return;
  const keys = chars.map((c) => `${g.id}:${c.id}`);
  for (const k of keys) asking.add(k);
  const turn = g.state.turn;
  try {
    const question = chars.map((c) => c.name).join('\n');
    const vars = {
      ruleset: g.ruleset,
      campaign: campaignFor(g, all),
      party: partyJson(g.ruleset, all, g.state, playersOf(g.id)),
      recent: recentTurns(g.id, 6000, 4),
    };
    // Not dm(): its queue callback saves the game object it was given, which would undo actions declared meanwhile.
    const res = await think(g.id, () => withRetry(() => runCanvas('dnd-suggest', question, { vars })));
    void recordCall(g, 'dnd-suggest', question, vars, res, turn).catch(() => {});
    const raw = outputJson<Record<string, unknown>>(res, 'choices');
    const fresh = loadGame(g.id);
    if (!fresh || fresh.status !== 'playing' || fresh.state.turn !== turn) return;
    for (const c of chars) {
      const list = ideasFor(raw, c.name, chars.length === 1);
      if (list.length) fresh.state.choices[c.id] = list;
    }
    saveGame(fresh);
    broadcast(fresh);
  } finally {
    for (const k of keys) asking.delete(k);
  }
}

/** The opening scene comes with ideas for everyone; a failure only means no ideas yet (the button still works). */
export function suggestForOpening(g: GameRow) {
  if (g.settings.tutorial) return;
  const ids = activeCharacters(gameCharacters(g.id)).filter((c) => !g.state.choices[c.id]?.length).map((c) => c.id);
  if (ids.length) suggestChoices(g, ids).catch((err) => logProblem('suggest', err, `Game "${g.name}" (${g.id}), opening`));
}

/** {"choices":{"Mira":[…]}}, {"Mira":[…]}, or for one character just {"choices":[…]}. */
function ideasFor(raw: Record<string, unknown>, name: string, only: boolean): string[] {
  const inner = raw.choices ?? raw;
  let list: unknown = Array.isArray(inner) ? (only ? inner : undefined) : undefined;
  if (!list && inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const map = inner as Record<string, unknown>;
    const key = Object.keys(map).find((k) => sameName(k, name)) ?? (only && Object.keys(map).length === 1 ? Object.keys(map)[0] : undefined);
    list = key ? map[key] : undefined;
  }
  return (Array.isArray(list) ? list : []).map((x) => clip(String(x), 200)).filter(Boolean).slice(0, 4);
}
