import { useEffect, useState } from 'react';
import type { GameDetail } from '@dungeonmind/shared';
import { api } from '../api';
import { Sheet } from '../components/Sheet';
import { useMe } from '../me';
import { Busy } from '../components/Busy';
import { setOpenGame } from '../openGame';
import { navigate } from '../router';
import { useGame } from '../useGame';
import { CampaignModal } from './CampaignModal';
import { AskBox, ChoiceBox } from './ChoiceBox';
import { StoryLog } from './StoryLog';
import { useLog } from './useLog';
import { tableExtras } from './extras';
import { NowPlayingBar, ReadSelection } from './Narration';
import { DiceOverlay } from './DiceOverlay';

const PHASE: Record<string, string> = {
  opening: 'The DM is setting the scene…',
  adjudicating: 'The DM weighs your actions…',
  rolling: 'Roll the dice!',
  narrating: 'The DM is telling what happens…',
  approval: 'Waiting for the host to approve a change…',
};

export function PhaseBanner({ g }: { g: GameDetail }) {
  if (g.status === 'paused') return <div className="bg-amber-900/60 px-3 py-1 text-center text-sm">The host paused the game.</div>;
  if (g.status === 'ended')
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 bg-slate-800 px-3 py-1 text-center text-sm">
        This game has ended. The story stays readable.
        {g.myRole === 'host' && !g.settings.tutorial && (
          <>
            <button className="btn py-0.5" onClick={() => api(`/api/games/${g.id}/status`, { body: { status: 'playing' } })}>
              Keep playing
            </button>
            <button className="btn-ghost py-0.5" title="A new adventure with the same rules and players, and ideas in the same style" onClick={async () => navigate(`/games/${(await api<{ id: string }>(`/api/games/${g.id}/similar`, { method: 'POST' })).id}`)}>
              Start a similar game
            </button>
          </>
        )}
        <button className="btn-ghost py-0.5" onClick={() => navigate('/')}>
          Back to the lobby
        </button>
      </div>
    );
  if (g.state.phase === 'error')
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 bg-red-950 px-3 py-1 text-center text-sm text-red-100">
        {g.state.error}
        {(g.myRole === 'host' || g.myRole === 'player') && (
          <button className="btn py-0.5" onClick={() => api(`/api/games/${g.id}/retry`, { method: 'POST' })}>
            Retry
          </button>
        )}
      </div>
    );
  const msg = PHASE[g.state.phase];
  if (!msg) return null;
  const canRedo = (g.state.phase === 'opening' || g.state.phase === 'narrating') && g.myRole !== 'spectator' && !g.state.queue;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 bg-indigo-950/70 px-3 py-1 text-center text-sm text-indigo-100">
      <span className="dm-breathe">{g.state.queue ? `The DM is thinking… (#${g.state.queue} in queue)` : msg}</span>
      {canRedo && (
        <button className="btn-ghost py-0.5 text-xs" title="Does the story look wrong? This stops the DM and writes it again. Your dice stay the same and no reroll is used." onClick={() => api(`/api/games/${g.id}/redo`, { method: 'POST' })}>
          Story looks wrong? Start over
        </button>
      )}
    </div>
  );
}

function SheetPane({ g }: { g: GameDetail }) {
  const me = useMe();
  const mineFirst = [...g.characters].sort((a, b) => Number(b.userId === me.id) - Number(a.userId === me.id));
  const [sel, setSel] = useState(mineFirst[0]?.id);
  const c = g.characters.find((x) => x.id === sel) ?? mineFirst[0];
  const Extra = tableExtras.sheet;
  if (!c) return <p className="text-sm text-slate-500">No characters yet.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {mineFirst.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className={`rounded-md px-2 py-1 text-xs ${x.id === c.id ? 'bg-[#21262d] text-white' : 'text-slate-400 hover:text-white'}`}>
            {x.name}
            {x.absent && ' (away)'}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
        <Sheet c={c} d={g.derived[c.id]}>
          {Extra && <Extra g={g} c={c} />}
        </Sheet>
        {(g.myRole === 'host' || c.userId === me.id) && g.status !== 'ended' && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-[#30363d] pt-2">
            <button className="btn-ghost text-xs" onClick={() => api(`/api/games/${g.id}/characters/${c.id}/seat`, { method: 'PATCH', body: { absent: !c.absent } })}>
              {c.absent ? 'Back at the table' : g.myRole === 'host' && c.userId !== me.id ? 'Skip (player away)' : "I'm away"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BoardPane({ g }: { g: GameDetail }) {
  const Board = tableExtras.board;
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {g.state.sceneImage && <img src={g.state.sceneImage} alt="The scene" className="dm-pop max-h-28 w-full shrink-0 rounded-lg border border-[#30363d] object-cover lg:max-h-none" />}
      {Board ? (
        <Board g={g} />
      ) : (
        <ul className="space-y-1 text-sm">
          {g.state.npcs
            .filter((n) => n.status !== 'dead' && n.status !== 'fled')
            .map((n) => (
              <li key={n.name}>
                {n.name} {n.hp !== undefined && <span className="text-xs text-slate-400">{n.hp}/{n.maxHp} HP</span>}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/** Phones: the party in one line, with the full sheet one tap away. */
function PartyStrip({ g, onStats }: { g: GameDetail; onStats: () => void }) {
  const me = useMe();
  const party = [...g.characters].sort((a, b) => Number(b.userId === me.id) - Number(a.userId === me.id));
  return (
    <div className="flex shrink-0 items-center gap-2 lg:hidden">
      <div className="scroll-thin flex min-w-0 flex-1 gap-3 overflow-x-auto whitespace-nowrap text-xs">
        {party.map((c) => (
          <span key={c.id}>
            <b className={c.userId === me.id ? 'text-indigo-200' : 'text-slate-300'}>{c.name}</b> {c.hp}/{c.maxHp} HP
            {c.userId === me.id && ` · AC ${g.derived[c.id]?.ac}`}
            {c.absent && ' (away)'}
            {c.levelUpPending && c.userId === me.id && <span className="text-amber-300"> ★</span>}
          </span>
        ))}
      </div>
      <button className="btn-ghost shrink-0 px-2 py-0.5 text-xs" onClick={onStats}>
        Stats
      </button>
    </div>
  );
}

export function Table({ id }: { id: string }) {
  const { g } = useGame(id);
  const { log, streaming, loadOlder } = useLog(id);
  const [stats, setStats] = useState(false);
  const [campaign, setCampaign] = useState(false);
  useEffect(() => {
    if (g && g.status === 'setup' && g.myRole !== 'spectator') navigate(`/games/${id}`);
  }, [g?.status]);
  // The top bar shows the game you're in, and keeps it as a tab while you look elsewhere.
  useEffect(() => {
    if (g === null) setOpenGame(null);
    else if (g && g.status !== 'setup') setOpenGame({ id: g.id, name: g.name, ended: g.status === 'ended' });
  }, [g?.id, g?.name, g?.status, g === null]);
  if (g === null) return <p className="p-4 text-slate-400">This table doesn't exist, or it's private.</p>;
  if (!g) return null;
  const host = g.myRole === 'host';
  const Narr = tableExtras.narration;
  const Top = tableExtras.top;
  const Dock = tableExtras.dock;
  const painting = !!g.state.paintingSince && Date.now() - g.state.paintingSince < 10 * 60_000;
  const hasBoard = !!g.state.sceneImage || g.state.zones.length > 0 || !!g.state.combat;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-end gap-2 border-b border-[#30363d] px-3 py-1.5">
        <h1 className="hidden min-w-0 flex-1 truncate font-serif text-lg text-indigo-100 lg:block">{g.name}</h1>
        {g.myRole === 'spectator' && <span className="chip">spectating</span>}
        {Top && <Top g={g} />}
        {g.myRole !== 'spectator' && g.settings.sceneImages !== false && g.status === 'playing' && (
          <button className="btn-ghost text-xs" disabled={painting} title="Paints the current scene. This takes about 50 seconds and slows the game down while it runs." onClick={() => api(`/api/games/${g.id}/scene-image`, { method: 'POST' })}>
            🖼 Make a picture <span className="hidden sm:inline">(about 50 sec)</span>
          </button>
        )}
        <button className="btn-ghost text-xs" onClick={() => setCampaign(true)}>
          Campaign
        </button>
        {host && g.status !== 'ended' && (
          <>
            <button className="btn-ghost text-xs" onClick={() => api(`/api/games/${g.id}/status`, { body: { status: g.status === 'paused' ? 'playing' : 'paused' } })}>
              {g.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button className="btn-danger text-xs" onClick={() => confirm('End this game for everyone? The story stays readable.') && api(`/api/games/${g.id}/status`, { body: { status: 'ended' } })}>
              End
            </button>
          </>
        )}
      </header>
      <PhaseBanner g={g} />
      {painting && (
        <div className="shrink-0 px-2 pt-2 sm:px-3">
          <Busy since={g.state.paintingSince} text="Painting the scene. This can take about 50 seconds." />
        </div>
      )}
      <main className="dm-safe-bottom flex min-h-0 flex-1 flex-col gap-2 p-2 sm:p-3 lg:grid lg:grid-cols-[320px_1fr_minmax(360px,34%)] lg:gap-3">
        <PartyStrip g={g} onStats={() => setStats(true)} />
        <section className={`card min-h-0 flex-col p-3 lg:static lg:z-auto lg:flex ${stats ? 'fixed inset-0 z-20 flex' : 'hidden'}`}>
          <button className="btn-ghost mb-2 self-end text-xs lg:hidden" onClick={() => setStats(false)}>
            ✕ Back to the game
          </button>
          <SheetPane g={g} />
        </section>
        <section className={`card max-h-[18dvh] shrink-0 flex-col p-2 lg:flex lg:max-h-none lg:min-h-0 lg:shrink lg:p-3 ${hasBoard ? 'flex' : 'hidden'}`}>
          <BoardPane g={g} />
        </section>
        <section className="card flex min-h-0 flex-1 flex-col gap-2 p-2 lg:p-3">
          <StoryLog log={log} streaming={streaming} onOlder={loadOlder} renderNarration={Narr ? (e, last) => <Narr g={g} e={e} last={last} /> : undefined} />
          <div className="scroll-thin max-h-[42dvh] shrink-0 space-y-2 overflow-y-auto">
            {Dock && <Dock g={g} />}
            {g.myRole !== 'spectator' && (
              <>
                <ChoiceBox g={g} />
                <AskBox g={g} />
              </>
            )}
          </div>
        </section>
      </main>
      {campaign && <CampaignModal g={g} onClose={() => setCampaign(false)} />}
      <NowPlayingBar />
      <DiceOverlay gameId={g.id} />
      <ReadSelection />
    </div>
  );
}
