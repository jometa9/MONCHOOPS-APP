// Tiles headed Playwright Chromium windows into a grid on the primary
// display. Each running headed browser claims one cell so the user can see
// every concurrent automation at once instead of windows stacking on top
// of each other.
//
// Grid is fixed at 2x2 so every tile is ~1/4 of the screen regardless of
// resolution. The OS window can be smaller than IG's desktop breakpoint —
// lib.pickViewport() pins the viewport to 1280x800 in that case so the
// scraper sees the desktop DOM.

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

const MAX_COLS = 2;
const MAX_ROWS = 2;

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
  const cellW = Math.floor(wa.width / MAX_COLS);
  const cellH = Math.floor(wa.height / MAX_ROWS);
  const out: Slot[] = [];
  let i = 0;
  for (let r = 0; r < MAX_ROWS; r++) {
    for (let c = 0; c < MAX_COLS; c++) {
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
