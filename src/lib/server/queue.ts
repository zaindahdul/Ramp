import { db } from "@/lib/db";
import { processDocument } from "@/lib/server/pipeline";

// A small in-process queue. Uploads return immediately; extraction runs in the
// background of the same Node process. State lives on globalThis so dev-mode
// module reloads don't lose it. If the process dies mid-extraction, the next
// status poll finds the stuck document and queues it again (recoverStuckDocuments).

const CONCURRENCY = 2;
const STALE_EXTRACTING_MS = 5 * 60 * 1000;

interface Job {
  organizationId: string;
  documentId: string;
}

interface QueueState {
  pending: Job[];
  queued: Set<string>;
  running: number;
}

const globalForQueue = globalThis as unknown as { __apExtractionQueue?: QueueState };
const state: QueueState = (globalForQueue.__apExtractionQueue ??= {
  pending: [],
  queued: new Set(),
  running: 0,
});

function pump(): void {
  while (state.running < CONCURRENCY && state.pending.length > 0) {
    const job = state.pending.shift()!;
    state.running += 1;
    processDocument(job.organizationId, job.documentId)
      .catch((error) => console.error("[queue] job crashed", job, error))
      .finally(() => {
        state.running -= 1;
        state.queued.delete(job.documentId);
        pump();
      });
  }
}

export function enqueueExtraction(organizationId: string, documentIds: string[]): void {
  for (const documentId of documentIds) {
    if (state.queued.has(documentId)) continue;
    state.queued.add(documentId);
    state.pending.push({ organizationId, documentId });
  }
  pump();
}

/** Re-queues documents left behind by a restart: never started, or stuck extracting. */
export async function recoverStuckDocuments(organizationId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_EXTRACTING_MS);
  await db.document.updateMany({
    where: { organizationId, status: "extracting", extractionStartedAt: { lt: staleBefore } },
    data: { status: "uploaded" },
  });
  const waiting = await db.document.findMany({
    where: { organizationId, status: "uploaded" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const toQueue = waiting.map((d) => d.id).filter((id) => !state.queued.has(id));
  if (toQueue.length > 0) enqueueExtraction(organizationId, toQueue);
}
