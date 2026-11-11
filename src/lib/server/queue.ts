import { db } from "@/lib/db";
import { processClaimedDocument } from "@/lib/server/pipeline";

// The extraction queue lives in Postgres, not in memory. A document with status
// `uploaded` is a pending job; a worker claims the oldest one with
// FOR UPDATE SKIP LOCKED, which flips it to `extracting` in the same statement.
// Two workers (or two server processes) can never take the same document, and a
// restart loses nothing: the jobs are rows.
//
// The only in-process state is how many workers are running, kept on globalThis
// so dev-mode module reloads don't start extra ones.

const CONCURRENCY = 2;
const STALE_EXTRACTING_MS = 5 * 60 * 1000;

interface QueueState {
  running: number;
}

const globalForQueue = globalThis as unknown as { __apExtractionWorkers?: QueueState };
const state: QueueState = (globalForQueue.__apExtractionWorkers ??= { running: 0 });

interface ClaimedJob {
  id: string;
  organizationId: string;
}

/** Atomically takes the oldest waiting document, or returns null when none is waiting. */
export async function claimNextDocument(): Promise<ClaimedJob | null> {
  const rows = await db.$queryRaw<ClaimedJob[]>`
    UPDATE "Document"
       SET "status" = 'extracting',
           "extractionStartedAt" = now(),
           "extractionAttempts" = "extractionAttempts" + 1,
           "updatedAt" = now()
     WHERE "id" = (
             SELECT "id" FROM "Document"
              WHERE "status" = 'uploaded'
              ORDER BY "createdAt", "id"
              LIMIT 1
                FOR UPDATE SKIP LOCKED
           )
    RETURNING "id", "organizationId"`;
  return rows[0] ?? null;
}

async function work(): Promise<void> {
  for (let job = await claimNextDocument(); job; job = await claimNextDocument()) {
    await processClaimedDocument(job.organizationId, job.id).catch((error) =>
      console.error("[queue] job crashed", job, error),
    );
  }
}

/** Starts workers (up to the concurrency limit) to drain whatever is waiting. */
export function kickExtraction(): void {
  while (state.running < CONCURRENCY) {
    state.running += 1;
    work()
      .catch((error) => console.error("[queue] worker stopped", error))
      .finally(() => {
        state.running -= 1;
      });
  }
}

/**
 * Puts documents left `extracting` by a dead process back in line, then drains
 * the queue. Called by the status poll, so a restart heals on the next request.
 */
export async function recoverStuckDocuments(organizationId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_EXTRACTING_MS);
  await db.document.updateMany({
    where: { organizationId, status: "extracting", extractionStartedAt: { lt: staleBefore } },
    data: { status: "uploaded" },
  });
  const waiting = await db.document.count({ where: { organizationId, status: "uploaded" } });
  if (waiting > 0) kickExtraction();
}
