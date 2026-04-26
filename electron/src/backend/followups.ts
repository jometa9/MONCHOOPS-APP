// Follow-up sequences: ordered Steps that fire after a delay if the lead
// hasn't replied. Patterned after ColdDMs / Dripify.
//
// Storage: see migration 17 in db.ts. The scheduler tick lives in
// followupScheduler.ts; this module is the data + business-logic layer.

import crypto from 'crypto';
import { getDb } from './db';

export interface FollowupSequencePublic {
  id: string;
  name: string;
  isArchived: boolean;
  stepCount: number;
  activeEnrollmentCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface FollowupStepPublic {
  id: string;
  sequenceId: string;
  stepIndex: number;
  delayHours: number;
  variantIds: number[];
  stopOnReply: boolean;
}

export type FollowupEnrollmentStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'replied';

export interface FollowupEnrollmentPublic {
  id: string;
  sequenceId: string;
  sequenceName: string | null;
  accountId: string;
  accountUsername: string | null;
  threadId: string | null;
  peerUsername: string;
  currentStepIndex: number;
  status: FollowupEnrollmentStatus;
  enrolledAt: number;
  nextRunAt: number;
  lastStepRunAt: number | null;
  cancelledReason: string | null;
}

interface SeqRow {
  id: string;
  name: string;
  is_archived: number;
  created_at: number;
  updated_at: number;
}
interface StepRow {
  id: string;
  sequence_id: string;
  step_index: number;
  delay_hours: number;
  variant_ids_json: string;
  stop_on_reply: number;
}
interface EnrollmentRow {
  id: string;
  sequence_id: string;
  sequence_name: string | null;
  account_id: string;
  account_username: string | null;
  thread_id: string | null;
  peer_username: string;
  current_step_index: number;
  status: FollowupEnrollmentStatus;
  enrolled_at: number;
  next_run_at: number;
  last_step_run_at: number | null;
  cancelled_reason: string | null;
}

function seqToPublic(row: SeqRow, stepCount: number, activeCount: number): FollowupSequencePublic {
  return {
    id: row.id,
    name: row.name,
    isArchived: row.is_archived !== 0,
    stepCount,
    activeEnrollmentCount: activeCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stepToPublic(row: StepRow): FollowupStepPublic {
  let ids: number[] = [];
  try { ids = JSON.parse(row.variant_ids_json) as number[]; } catch {}
  return {
    id: row.id,
    sequenceId: row.sequence_id,
    stepIndex: row.step_index,
    delayHours: row.delay_hours,
    variantIds: Array.isArray(ids) ? ids.filter((n) => Number.isFinite(n)) : [],
    stopOnReply: row.stop_on_reply !== 0,
  };
}

function enrollmentToPublic(row: EnrollmentRow): FollowupEnrollmentPublic {
  return {
    id: row.id,
    sequenceId: row.sequence_id,
    sequenceName: row.sequence_name,
    accountId: row.account_id,
    accountUsername: row.account_username,
    threadId: row.thread_id,
    peerUsername: row.peer_username,
    currentStepIndex: row.current_step_index,
    status: row.status,
    enrolledAt: row.enrolled_at,
    nextRunAt: row.next_run_at,
    lastStepRunAt: row.last_step_run_at,
    cancelledReason: row.cancelled_reason,
  };
}

export function listSequences(includeArchived = false): FollowupSequencePublic[] {
  const where = includeArchived ? '' : 'WHERE is_archived = 0';
  const rows = getDb()
    .prepare<[], SeqRow>(`SELECT * FROM followup_sequences ${where} ORDER BY created_at DESC`)
    .all();
  return rows.map((r) => {
    const sc = getDb()
      .prepare<[string], { c: number }>('SELECT COUNT(*) AS c FROM followup_steps WHERE sequence_id = ?')
      .get(r.id);
    const ec = getDb()
      .prepare<[string], { c: number }>(
        `SELECT COUNT(*) AS c FROM followup_enrollments WHERE sequence_id = ? AND status = 'active'`
      )
      .get(r.id);
    return seqToPublic(r, Number(sc?.c) || 0, Number(ec?.c) || 0);
  });
}

export function getSequence(sequenceId: string): { sequence: FollowupSequencePublic; steps: FollowupStepPublic[] } | null {
  const seq = getDb()
    .prepare<[string], SeqRow>('SELECT * FROM followup_sequences WHERE id = ?')
    .get(sequenceId);
  if (!seq) return null;
  const stepRows = getDb()
    .prepare<[string], StepRow>(
      'SELECT * FROM followup_steps WHERE sequence_id = ? ORDER BY step_index ASC'
    )
    .all(sequenceId);
  const ec = getDb()
    .prepare<[string], { c: number }>(
      `SELECT COUNT(*) AS c FROM followup_enrollments WHERE sequence_id = ? AND status = 'active'`
    )
    .get(sequenceId);
  return {
    sequence: seqToPublic(seq, stepRows.length, Number(ec?.c) || 0),
    steps: stepRows.map(stepToPublic),
  };
}

export interface CreateSequenceInput {
  name: string;
  steps: Array<{ delayHours: number; variantIds: number[]; stopOnReply: boolean }>;
}

export function createSequence(input: CreateSequenceInput): FollowupSequencePublic {
  const id = crypto.randomUUID();
  const now = Date.now();
  const tx = getDb().transaction((args: CreateSequenceInput) => {
    getDb()
      .prepare(
        `INSERT INTO followup_sequences(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
      .run(id, args.name.trim(), now, now);
    args.steps.forEach((step, idx) => insertStep(id, idx, step));
  });
  tx(input);
  return getSequence(id)!.sequence;
}

export function updateSequence(
  sequenceId: string,
  input: CreateSequenceInput
): FollowupSequencePublic {
  const tx = getDb().transaction((args: CreateSequenceInput) => {
    getDb()
      .prepare(`UPDATE followup_sequences SET name = ?, updated_at = ? WHERE id = ?`)
      .run(args.name.trim(), Date.now(), sequenceId);
    getDb().prepare(`DELETE FROM followup_steps WHERE sequence_id = ?`).run(sequenceId);
    args.steps.forEach((step, idx) => insertStep(sequenceId, idx, step));
  });
  tx(input);
  const result = getSequence(sequenceId);
  if (!result) throw new Error('Sequence not found after update');
  return result.sequence;
}

function insertStep(
  sequenceId: string,
  stepIndex: number,
  step: { delayHours: number; variantIds: number[]; stopOnReply: boolean }
): void {
  const id = crypto.randomUUID();
  const delay = Math.max(1, Math.min(720, Math.floor(step.delayHours)));
  const variantIds = (step.variantIds ?? []).filter((n) => Number.isFinite(n));
  if (variantIds.length === 0) {
    throw new Error(`Step ${stepIndex + 1} requires at least one message variant`);
  }
  getDb()
    .prepare(
      `INSERT INTO followup_steps(id, sequence_id, step_index, delay_hours, variant_ids_json, stop_on_reply)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, sequenceId, stepIndex, delay, JSON.stringify(variantIds), step.stopOnReply ? 1 : 0);
}

export function archiveSequence(sequenceId: string): void {
  getDb()
    .prepare(`UPDATE followup_sequences SET is_archived = 1, updated_at = ? WHERE id = ?`)
    .run(Date.now(), sequenceId);
  getDb()
    .prepare(`UPDATE followup_enrollments SET status = 'cancelled', cancelled_reason = 'sequence_archived' WHERE sequence_id = ? AND status IN ('active','paused')`)
    .run(sequenceId);
}

const ENROLLMENT_SELECT = `
  SELECT e.*, s.name AS sequence_name, a.username AS account_username
  FROM followup_enrollments e
  LEFT JOIN followup_sequences s ON s.id = e.sequence_id
  LEFT JOIN accounts a ON a.id = e.account_id
`;

export interface ListEnrollmentsArgs {
  status?: FollowupEnrollmentStatus | null;
  accountId?: string | null;
  threadId?: string | null;
  limit?: number;
}

export function listEnrollments(args: ListEnrollmentsArgs = {}): FollowupEnrollmentPublic[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (args.status) {
    where.push('e.status = ?');
    params.push(args.status);
  }
  if (args.accountId) {
    where.push('e.account_id = ?');
    params.push(args.accountId);
  }
  if (args.threadId) {
    where.push('e.thread_id = ?');
    params.push(args.threadId);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, args.limit ?? 200));
  const rows = getDb()
    .prepare<unknown[], EnrollmentRow>(
      `${ENROLLMENT_SELECT} ${whereSql} ORDER BY e.next_run_at ASC LIMIT ?`
    )
    .all(...params, limit);
  return rows.map(enrollmentToPublic);
}

export interface EnrollArgs {
  sequenceId: string;
  accountId: string;
  peerUsername: string;
  threadId?: string | null;
}

export function enrollPeer(args: EnrollArgs): FollowupEnrollmentPublic {
  const seq = getSequence(args.sequenceId);
  if (!seq || seq.steps.length === 0) {
    throw new Error('Sequence has no steps');
  }
  const firstStep = seq.steps[0]!;
  const id = crypto.randomUUID();
  const now = Date.now();
  const nextRun = now + firstStep.delayHours * 60 * 60_000;
  getDb()
    .prepare(
      `INSERT INTO followup_enrollments(
         id, sequence_id, account_id, thread_id, peer_username,
         current_step_index, status, enrolled_at, next_run_at
       ) VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)`
    )
    .run(id, args.sequenceId, args.accountId, args.threadId ?? null, args.peerUsername.replace(/^@+/, ''), now, nextRun);
  const row = getDb()
    .prepare<[string], EnrollmentRow>(`${ENROLLMENT_SELECT} WHERE e.id = ?`)
    .get(id);
  return enrollmentToPublic(row!);
}

export function pauseEnrollment(id: string): void {
  getDb()
    .prepare(`UPDATE followup_enrollments SET status = 'paused' WHERE id = ? AND status = 'active'`)
    .run(id);
}

export function resumeEnrollment(id: string): void {
  getDb()
    .prepare(
      `UPDATE followup_enrollments SET status = 'active', next_run_at = ? WHERE id = ? AND status = 'paused'`
    )
    .run(Date.now(), id);
}

export function cancelEnrollment(id: string, reason = 'user_cancelled'): void {
  getDb()
    .prepare(
      `UPDATE followup_enrollments SET status = 'cancelled', cancelled_reason = ? WHERE id = ? AND status IN ('active','paused')`
    )
    .run(reason, id);
}

// Called by inbox sync after inserting an inbound message. Flips any active /
// paused enrollments for this thread to 'replied'.
export function cancelOnReply(threadId: string): void {
  getDb()
    .prepare(
      `UPDATE followup_enrollments SET status = 'replied' WHERE thread_id = ? AND status IN ('active','paused')`
    )
    .run(threadId);
}

// Returns the variant body for a given variant id by looking it up in the
// existing message_variants table. Used by the scheduler to pick what to send.
export function getVariantBody(variantId: number): string | null {
  const row = getDb()
    .prepare<[number], { content: string }>(
      `SELECT content FROM message_variants WHERE id = ?`
    )
    .get(variantId);
  return row?.content ?? null;
}

export function getDueEnrollments(now: number, limit = 50): EnrollmentRow[] {
  return getDb()
    .prepare<[number, number], EnrollmentRow>(
      `${ENROLLMENT_SELECT} WHERE e.status = 'active' AND e.next_run_at <= ? ORDER BY e.next_run_at ASC LIMIT ?`
    )
    .all(now, limit);
}

export function advanceEnrollment(
  enrollment: EnrollmentRow,
  result: 'sent' | 'failed' | 'skipped',
  variantId: number | null,
  reason: string | null
): void {
  const seq = getSequence(enrollment.sequence_id);
  const tx = getDb().transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO followup_send_log(enrollment_id, step_index, variant_id, status, reason, ran_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        enrollment.id,
        enrollment.current_step_index,
        variantId == null ? null : String(variantId),
        result,
        reason,
        Date.now()
      );
    if (result === 'sent') {
      const nextIdx = enrollment.current_step_index + 1;
      const nextStep = seq?.steps[nextIdx];
      if (nextStep) {
        const jitter = 0.85 + Math.random() * 0.3;
        const nextRun = Date.now() + nextStep.delayHours * 60 * 60_000 * jitter;
        getDb()
          .prepare(
            `UPDATE followup_enrollments SET current_step_index = ?, last_step_run_at = ?, next_run_at = ? WHERE id = ?`
          )
          .run(nextIdx, Date.now(), Math.floor(nextRun), enrollment.id);
      } else {
        getDb()
          .prepare(
            `UPDATE followup_enrollments SET status = 'completed', last_step_run_at = ? WHERE id = ?`
          )
          .run(Date.now(), enrollment.id);
      }
    } else if (result === 'failed') {
      getDb()
        .prepare(
          `UPDATE followup_enrollments SET status = 'cancelled', cancelled_reason = ? WHERE id = ?`
        )
        .run(reason ?? 'send_failed', enrollment.id);
    } else {
      // skipped (e.g. lead replied) — flip to replied
      getDb()
        .prepare(
          `UPDATE followup_enrollments SET status = 'replied', last_step_run_at = ? WHERE id = ?`
        )
        .run(Date.now(), enrollment.id);
    }
  });
  tx();
}
