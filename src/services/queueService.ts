import Queue from "bull";
import {
  matchRideRequest,
  handleCancellation,
  MatchingConfig,
} from "../algorithms/matcher";
import logger from "../utils/logger";
import { prisma } from "../utils/prisma";
import { CONFIG } from "../config/constants"; // ✅ Import CONFIG

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

export const matchingQueue = new Queue("ride-matching", {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// ✅ FIX: Use CONFIG constants instead of magic numbers
const matchingConfig: MatchingConfig = {
  maxPoolSize: CONFIG.MATCHING.MAX_POOL_SIZE,
  maxLuggage: CONFIG.MATCHING.MAX_LUGGAGE,
  searchRadiusKm: CONFIG.MATCHING.SEARCH_RADIUS_KM,
  maxDetourMins: CONFIG.MATCHING.MAX_DETOUR_MINS,
};

matchingQueue.process(
  parseInt(process.env.QUEUE_CONCURRENCY || "10"),
  async (job) => {
    const { requestId, action } = job.data;
    logger.info(`Processing ${action} for request ${requestId}`);
    try {
      if (action === "match") {
        const result = await matchRideRequest(requestId, matchingConfig);
        logger.info(`Match result for ${requestId}:`, result);
        return result;
      } else if (action === "cancel") {
        await handleCancellation(requestId);
        logger.info(`Cancelled request ${requestId}`);
        return { success: true, message: "Cancelled successfully" };
      }
    } catch (error) {
      logger.error(`Error processing request ${requestId}:`, error);
      throw error;
    }
  },
);

// ... rest of the file remains unchanged (queueRideMatch, queueCancellation, etc.) ...
// Ensure you keep the failure handling and other functions below this line as they were.

export async function queueRideMatch(requestId: string): Promise<void> {
  // ... (Code from Step 12) ...
  const existingJob = await matchingQueue.getJob(`match-${requestId}`);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === "active" || state === "waiting") return;
  }
  await matchingQueue.add(
    { requestId, action: "match" },
    {
      jobId: `match-${requestId}`,
      priority: 1,
      removeOnComplete: true,
      removeOnFail: false,
    },
  );
}

export async function queueCancellation(requestId: string): Promise<void> {
  const matchJob = await matchingQueue.getJob(`match-${requestId}`);
  if (matchJob) await matchJob.remove();
  await matchingQueue.add(
    { requestId, action: "cancel" },
    { jobId: `cancel-${requestId}`, priority: 10 },
  );
  logger.info(`Queued cancellation job for request ${requestId}`);
}

export async function getJobStatus(requestId: string): Promise<any> {
  const job = await matchingQueue.getJob(`match-${requestId}`);
  if (!job) return null;
  const state = await job.getState();
  return {
    id: job.id,
    state,
    progress: job.progress(),
    data: job.data,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
    timestamp: job.timestamp,
  };
}

export async function getQueueHealth(): Promise<any> {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    matchingQueue.getWaitingCount(),
    matchingQueue.getActiveCount(),
    matchingQueue.getCompletedCount(),
    matchingQueue.getFailedCount(),
    matchingQueue.getDelayedCount(),
  ]);
  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    healthy: active < 100 && waiting < 500,
  };
}

matchingQueue.on("completed", (job, result) => {
  logger.info(`Job ${job.id} completed:`, result);
});

matchingQueue.on("failed", async (job, err) => {
  logger.error(`Job ${job.id} failed:`, err);
  try {
    await prisma.rideRequest.update({
      where: { id: job.data.requestId },
      data: { status: "PENDING" },
    });
    const failedCount = await matchingQueue.getFailedCount();
    if (failedCount > 100)
      logger.error(`CRITICAL ALERT: High queue failure rate: ${failedCount}`);
  } catch (error) {
    logger.error(`Error handling failed job logic for ${job.id}:`, error);
  }
});

matchingQueue.on("stalled", (job) => {
  logger.warn(`Job ${job.id} stalled`);
});

export async function closeQueue(): Promise<void> {
  await matchingQueue.close();
  logger.info("Queue closed");
}
