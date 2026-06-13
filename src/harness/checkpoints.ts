import { AlarmType, createAlarm, fireAlarm } from './alarms'
import type {
  CheckpointRecord,
  CheckpointStage,
} from '../agents/pr-review/schema'
import { CheckpointRecordSchema } from '../agents/pr-review/schema'

// ── CheckpointStore interface ─────────────────────────────────────────────────
// Injected dependency — decoupled from Supabase directly.

export interface CheckpointStore {
  save(record: CheckpointRecord): Promise<void>
  load(
    reviewId: string,
    stage: CheckpointStage
  ): Promise<CheckpointRecord | null>
}

// ── runCheckpoint ─────────────────────────────────────────────────────────────
// Executes a checkpoint gate: runs the check fn, persists the result, fires an
// alarm on failure. Returns the payload on PASS; throws on FAIL.

export async function runCheckpoint<T>(options: {
  reviewId: string
  stage: CheckpointStage
  agentName?: string
  store: CheckpointStore
  check: () => Promise<{ pass: boolean; payload: T; error?: string }>
}): Promise<T> {
  const { reviewId, stage, agentName, store, check } = options

  const { pass, payload, error } = await check()

  const record: CheckpointRecord = CheckpointRecordSchema.parse({
    reviewId,
    stage,
    agentName,
    status: pass ? 'PASS' : 'FAIL',
    payload: pass ? payload : { error: error ?? 'Checkpoint failed' },
    createdAt: new Date().toISOString(),
  })

  await store.save(record)

  if (!pass) {
    const alarm = createAlarm(
      AlarmType.CHECKPOINT_FAILED,
      { stage, agentName, reviewId, error: error ?? 'Checkpoint failed' },
      reviewId
    )
    fireAlarm(alarm)
    throw new CheckpointFailedError(stage, error ?? 'Checkpoint failed')
  }

  return payload
}

// ── resumeFromCheckpoint ──────────────────────────────────────────────────────
// Loads a persisted checkpoint result so a run can resume without re-running prior stages.

export async function resumeFromCheckpoint<T>(
  reviewId: string,
  stage: CheckpointStage,
  store: CheckpointStore
): Promise<T | null> {
  const record = await store.load(reviewId, stage)
  if (!record || record.status !== 'PASS') return null
  return record.payload as T
}

// ── In-memory store (dev / tests) ─────────────────────────────────────────────

export class InMemoryCheckpointStore implements CheckpointStore {
  private records = new Map<string, CheckpointRecord>()

  save(record: CheckpointRecord): Promise<void> {
    this.records.set(
      `${record.reviewId}:${record.stage}:${record.agentName ?? ''}`,
      record
    )
    return Promise.resolve()
  }

  load(
    reviewId: string,
    stage: CheckpointStage
  ): Promise<CheckpointRecord | null> {
    for (const [key, record] of this.records) {
      if (key.startsWith(`${reviewId}:${stage}:`))
        return Promise.resolve(record)
    }
    return Promise.resolve(null)
  }
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class CheckpointFailedError extends Error {
  constructor(
    public stage: CheckpointStage,
    message: string
  ) {
    super(`Checkpoint FAILED [${stage}]: ${message}`)
    this.name = 'CheckpointFailedError'
  }
}
