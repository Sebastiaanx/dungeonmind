import type { GameDetail } from '@dungeonmind/shared';
import { DiceTray, FreeRoll } from './DiceTray';
import { tableExtras } from './extras';
import { Approvals, HostTools, RerollBar, SheetActions } from './HostPanel';
import { Initiative, ZoneBoard } from './ZoneBoard';
import { Narration } from './Narration';

function Board({ g }: { g: GameDetail }) {
  return (
    <div className="space-y-3">
      <Initiative g={g} />
      <ZoneBoard g={g} />
    </div>
  );
}

/** What needs doing now, always in view right under the story. */
function Dock({ g }: { g: GameDetail }) {
  return (
    <>
      <Approvals g={g} />
      <DiceTray g={g} />
      <HostTools g={g} />
      <FreeRoll g={g} />
    </>
  );
}

/** M6: the dice tray, zone board, initiative, approvals and host tools on the table. */
export function registerBookkeeping() {
  tableExtras.board = Board;
  tableExtras.dock = Dock;
  tableExtras.sheet = SheetActions;
  tableExtras.top = RerollBar;
  tableExtras.narration = Narration;
}
