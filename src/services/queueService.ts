
import Queue from "bull";
import Redis from "ioredis";
import {
  matchRideRequest,
  handleCancellation,
  MatchingConfig,
} from "../algorithms/matcher";
import logger from "../utils/logger";
import { prisma } from "../utils/prisma"; // Added import for DB updates

// Redis connection
const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

// Create Bull queue
export const matchingQueue = new Queue("ride-matching", {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// Matching configuration
const matchingConfig: MatchingConfig = {
  maxPoolSize: parseInt(process.env.MAX_POOL_SIZE || "4"),
  maxLuggage: parseInt(process.env.MAX_LUGGAGE_PER_POOL || "6"),
  searchRadiusKm: 5,
  maxDetourMins: parseInt(process.env.MAX_DETOUR_TOLERANCE_MINS || "15"),
};

/**
 * Process matching jobs
 * Concurrency: 10 parallel jobs (configurable)
 */
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

export async function queueRideMatch(requestId: string): Promise<void> {
  const existingJob = await matchingQueue.getJob(`match-${requestId}`);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === "active" || state === "waiting") {
      return;
    }
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
  // Remove pending match job if exists
  const matchJob = await matchingQueue.getJob(`match-${requestId}`);
  if (matchJob) {
    await matchJob.remove();
  }

  await matchingQueue.add(
    { requestId, action: "cancel" },
    {
      jobId: `cancel-${requestId}`,
      priority: 10, // Higher priority for cancellations
    },
  );
  logger.info(`Queued cancellation job for request ${requestId}`);
}

/**
 * Get job status
 */
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

/**
 * Queue health check
 */
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
    healthy: active < 100 && waiting < 500, // Arbitrary thresholds
  };
}

/**
 * Event listeners for monitoring
 */
matchingQueue.on("completed", (job, result) => {
  logger.info(`Job ${job.id} completed:`, result);
});

// ✅ FIX: Enhanced failure monitoring and recovery
matchingQueue.on("failed", async (job, err) => {
  logger.error(`Job ${job.id} failed:`, err);

  try {
    // Update ride status in DB to allow manual retry or analysis
    // Note: Assuming 'failureCount' might be added to schema later,
    // for now we reset status to PENDING so it's not stuck in limbo.
    await prisma.rideRequest.update({
      where: { id: job.data.requestId },
      data: {
        status: "PENDING",
        // failureCount: { increment: 1 } // Uncomment if schema supports it
      },
    });

    // Alert if too many failures
    const failedCount = await matchingQueue.getFailedCount();
    if (failedCount > 100) {
      // Replaced undefined 'alertOps' with logger
      logger.error(`CRITICAL ALERT: High queue failure rate: ${failedCount}`);
    }
  } catch (error) {
    logger.error(`Error handling failed job logic for ${job.id}:`, error);
  }
});

matchingQueue.on("stalled", (job) => {
  logger.warn(`Job ${job.id} stalled`);
});

/**
 * Graceful shutdown
 */
export async function closeQueue(): Promise<void> {
  await matchingQueue.close();
  logger.info("Queue closed");
}
