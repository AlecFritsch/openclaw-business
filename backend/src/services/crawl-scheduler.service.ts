// Crawl Scheduler — checks for due re-crawl jobs every 60s

import { getDatabase } from '../config/database.js';
import { startCrawlJob, deleteSource, getNextCrawlDate } from './knowledge.service.js';

const CHECK_INTERVAL = 60_000; // 1 minute

export function startCrawlScheduler() {
  setInterval(async () => {
    try {
      const db = getDatabase();
      const dueSources = await db.collection('knowledge_sources').find({
        type: 'crawl',
        crawlSchedule: { $ne: null },
        nextCrawlAt: { $lte: new Date() },
        status: { $ne: 'processing' },
      }).toArray();

      for (const source of dueSources) {
        try {
          // Delete old children
          await deleteSource(source.organizationId, source._id.toString());

          // Re-crawl with same config
          await startCrawlJob({
            organizationId: source.organizationId,
            agentId: source.agentId,
            createdBy: source.createdBy,
            url: source.origin,
            maxPages: source.crawlConfig?.maxPages,
            maxDepth: source.crawlConfig?.maxDepth,
            schedule: source.crawlSchedule,
          });
        } catch (err) {
          console.error(`[crawl-scheduler] Failed to re-crawl ${source.origin}:`, err);
          // Update nextCrawlAt so we don't retry immediately
          await db.collection('knowledge_sources').updateOne(
            { _id: source._id },
            { $set: { nextCrawlAt: getNextCrawlDate(source.crawlSchedule), updatedAt: new Date() } },
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[crawl-scheduler] Check failed:', err);
    }
  }, CHECK_INTERVAL);
}
