/**
 * Queue Service for Ride Matching
 * Handles concurrent ride requests using Bull queue
 * Prevents race conditions and ensures FIFO processing
 */

import Queue from 'bull';
import Redis from 'ioredis';
import { matchRideRequest, handleCancellation, MatchingConfig } from '../algorithms/matcher';
import logger from '../utils/logger';

// Redis connection
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

// Create Bull queue
export const matchingQueue = new Queue('ride-matching', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// Matching configuration
const matchingConfig: MatchingConfig = {
  maxPoolSize: parseInt(process.env.MAX_POOL_SIZE || '4'),
  maxLuggage: parseInt(process.env.MAX_LUGGAGE_PER_POOL || '6'),
  searchRadiusKm: 5,
  maxDetourMins: parseInt(process.env.MAX_DETOUR_TOLERANCE_MINS || '15'),
};

/**
 * Process matching jobs
 * Concurrency: 10 parallel jobs (configurable)
 */
matchingQueue.process(
  parseInt(process.env.QUEUE_CONCURRENCY || '10'),
  async (job) => {
    const { requestId, action } = job.data;
    
    logger.info(`Processing ${action} for request ${requestId}`);
    
    try {
      if (action === 'match') {
        const result = await matchRideRequest(requestId, matchingConfig);
        logger.info(`Match result for ${requestId}:`, result);
        return result;
      } else if (action === 'cancel') {
        await handleCancellation(requestId);
        logger.info(`Cancelled request ${requestId}`);
        return { success: true, message: 'Cancelled successfully' };
      }
    } catch (error) {
      logger.error(`Error processing request ${requestId}:`, error);
      throw error;
    }
  }
);

/**
 * Add ride matching job to queue
 */
export async function queueRideMatch(requestId: string): Promise<void> {
  await matchingQueue.add(
    { requestId, action: 'match' },
    {
      jobId: `match-${requestId}`,
      priority: 1,
    }
  );
  logger.info(`Queued match job for request ${requestId}`);
}

/**
 * Add cancellation job to queue
 */
export async function queueCancellation(requestId: string): Promise<void> {
  // Remove pending match job if exists
  const matchJob = await matchingQueue.getJob(`match-${requestId}`);
  if (matchJob) {
    await matchJob.remove();
  }
  
  await matchingQueue.add(
    { requestId, action: 'cancel' },
    {
      jobId: `cancel-${requestId}`,
      priority: 10, // Higher priority for cancellations
    }
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
matchingQueue.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed:`, result);
});

matchingQueue.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed:`, err);
});

matchingQueue.on('stalled', (job) => {
  logger.warn(`Job ${job.id} stalled`);
});

/**
 * Graceful shutdown
 */
export async function closeQueue(): Promise<void> {
  await matchingQueue.close();
  logger.info('Queue closed');
}
