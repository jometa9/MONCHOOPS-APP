

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

let overflowIndex = 0;

interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getPrimaryWorkArea(): WorkArea | null {

  try {

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
