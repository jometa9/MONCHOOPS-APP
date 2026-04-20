// Tiles headed Playwright Chromium windows into a grid on the primary
// display. Each running headed browser claims one cell so the user can see
// every concurrent automation at once instead of windows stacking on top
// of each other.
//
// Slot count is derived from the work area (display minus menubar/dock):
// we aim for cells that are at least ~640x480 (Instagram's lower bound for
// a usable layout), and we cap at 4 cols x 3 rows = 12 slots so very large
// monitors don't end up with unreadably tiny windows. A 13" MacBook (≈1440
// usable width) lands at 2x2 = 4 slots, matching the user's mental model.

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Slot {
  index: number;
  bounds: WindowBounds;
  jobId: string | null;
}

const MIN_CELL_W = 640;
const MIN_CELL_H = 480;
const MAX_COLS = 4;
const MAX_ROWS = 3;

let slots: Slot[] = [];
// Where the next overflow window goes when every slot is taken. We cycle
// through slot indices in order, so window #5 stacks on top of #1, #6 on
// top of #2, etc. Overflow jobs don't claim the slot's jobId — the
// original owner still releases it when they finish.
let overflowIndex = 0;

interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getPrimaryWorkArea(): WorkArea | null {
  // Lazy-require so this module can be imported in non-Electron contexts
  // (e.g. unit tests) without crashing.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { screen } = require('electron') as typeof import('electron');
    const display = screen.getPrimaryDisplay();
    return display.workArea;
  } catch {
    return null;
  }
}

function buildSlots(): Slot[] {
  const wa = getPrimaryWorkArea();
  if (!wa) return [];
  const cols = Math.min(MAX_COLS, Math.max(2, Math.floor(wa.width / MIN_CELL_W)));
  const rows = Math.min(MAX_ROWS, Math.max(2, Math.floor(wa.height / MIN_CELL_H)));
  const cellW = Math.floor(wa.width / cols);
  const cellH = Math.floor(wa.height / rows);
  const out: Slot[] = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        index: i++,
        bounds: {
          x: wa.x + c * cellW,
          y: wa.y + r * cellH,
          width: cellW,
          height: cellH,
        },
        jobId: null,
      });
    }
  }
  return out;
}

function ensureSlots(): void {
  // Recompute the grid whenever no windows are currently positioned, so a
  // resolution change (external monitor plugged in, dock moved, etc.) gets
  // picked up the next time the user is starting fresh. We deliberately
  // don't rebuild while windows are open — moving an in-use cell would
  // require resizing the live Chromium, which Playwright doesn't expose.
  if (slots.length === 0 || slots.every((s) => !s.jobId)) {
    slots = buildSlots();
    overflowIndex = 0;
  }
}

export function acquireSlot(jobId: string): WindowBounds | null {
  ensureSlots();
  if (slots.length === 0) return null;
  for (const s of slots) {
    if (!s.jobId) {
      s.jobId = jobId;
      return s.bounds;
    }
  }
  // All slots full — wrap around. We hand back the next slot's bounds
  // (so the new window stacks on top of an existing tile) but don't
  // change ownership; the original tenant still releases the slot when
  // it finishes.
  const slot = slots[overflowIndex % slots.length]!;
  overflowIndex = (overflowIndex + 1) % slots.length;
  return slot.bounds;
}

export function releaseSlot(jobId: string): void {
  for (const s of slots) {
    if (s.jobId === jobId) {
      s.jobId = null;
      return;
    }
  }
}
