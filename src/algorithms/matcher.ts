/**
 * Ride Matching Algorithm
 * Groups passengers into pools while respecting constraints
 * Uses greedy algorithm with spatial indexing
 * 
 * Complexity Analysis:
 * - Spatial lookup: O(k) where k = nearby requests
 * - Compatibility check: O(1)
 * - Route optimization: O(n²) where n = pool size
 * - Overall: O(k * n²) per match attempt
 */

import { PrismaClient, RideRequest, Pool } from '@prisma/client';
import { SpatialGrid, haversineDistance, Coordinate } from '../utils/geospatial';
import { optimizeRoute, calculateDirectRoute, RouteStop, DetourConstraint } from './routeOptimizer';

const prisma = new PrismaClient();

export interface MatchingConfig {
  maxPoolSize: number;
  maxLuggage: number;
  searchRadiusKm: number;
  maxDetourMins: number;
}

export interface MatchResult {
  success: boolean;
  poolId?: string;
  message: string;
  estimatedPrice?: number;
}

export async function matchRideRequest(
  requestId: string,
  config: MatchingConfig
): Promise<MatchResult> {
  const request = await prisma.rideRequest.findUnique({
    where: { id: requestId },
  });

  if (!request) {
    return { success: false, message: 'Request not found' };
  }
  const matchedPool = await findCompatiblePool(request, config);

  if (matchedPool) {

    const success = await addToPool(request, matchedPool, config);
    if (success) {
      const price = await calculatePooledPrice(request, matchedPool.id);
      return {
        success: true,
        poolId: matchedPool.id,
        message: 'Matched with existing pool',
        estimatedPrice: price,
      };
    }
  }

  const newPool = await createNewPool(request);
  const price = await calculatePooledPrice(request, newPool.id);

  return {
    success: true,
    poolId: newPool.id,
    message: 'Created new pool',
    estimatedPrice: price,
  };
}

/**
 * Find compatible pool for a ride request
 * Uses spatial indexing for efficient nearby search
 * Complexity: O(k * n) where k = nearby pools, n = avg pool size
 */
async function findCompatiblePool(
  request: RideRequest,
  config: MatchingConfig
): Promise<Pool | null> {
  const nearbyPools = await prisma.pool.findMany({
    where: {
      status: 'FORMING',
      currentSeats: { lt: config.maxPoolSize },
      currentLuggage: { lt: config.maxLuggage },
    },
    include: {
      rideRequests: true,
    },
  });
  for (const pool of nearbyPools) {
    if (await isCompatible(request, pool, config)) {
      return pool;
    }
  }

  return null;
}

/**
 * Check if request is compatible with pool
 * Validates: capacity, luggage, route detour
 * Complexity: O(n²) due to route optimization
 */
async function isCompatible(
  request: RideRequest,
  pool: Pool,
  config: MatchingConfig
): Promise<boolean> {
  if (pool.currentSeats + request.seatCount > config.maxPoolSize) {
    return false;
  }

  if (pool.currentLuggage + request.luggageCount > config.maxLuggage) {
    return false;
  }
  const poolRequests = await prisma.rideRequest.findMany({
    where: { poolId: pool.id },
  });
  const allRequests = [...poolRequests, request];
  const stops = buildRouteStops(allRequests);
  const constraints = buildDetourConstraints(allRequests);

  const optimizedRoute = optimizeRoute(stops, constraints);
  return optimizedRoute.valid;
}

function buildRouteStops(requests: RideRequest[]): RouteStop[] {
  const stops: RouteStop[] = [];

  requests.forEach(req => {
    stops.push({
      id: `${req.id}-pickup`,
      requestId: req.id,
      coordinate: { lat: req.pickupLat, lng: req.pickupLng },
      type: 'PICKUP',
      address: req.pickupAddress,
    });

    stops.push({
      id: `${req.id}-dropoff`,
      requestId: req.id,
      coordinate: { lat: req.dropoffLat, lng: req.dropoffLng },
      type: 'DROPOFF',
      address: req.dropoffAddress,
    });
  });

  return stops;
}

function buildDetourConstraints(
  requests: RideRequest[]
): Map<string, DetourConstraint> {
  const constraints = new Map<string, DetourConstraint>();

  requests.forEach(req => {
    const { distance, time } = calculateDirectRoute(
      { lat: req.pickupLat, lng: req.pickupLng },
      { lat: req.dropoffLat, lng: req.dropoffLng }
    );

    constraints.set(req.id, {
      requestId: req.id,
      maxDetourMins: req.maxDetourMins,
      directDistance: distance,
      directTime: time,
    });
  });

  return constraints;
}

/**
 * Add request to pool with optimistic locking
 * Uses version field to prevent race conditions
 */
async function addToPool(
  request: RideRequest,
  pool: Pool,
  config: MatchingConfig
): Promise<boolean> {
  try {
    // Use transaction with optimistic locking
    await prisma.$transaction(async (tx) => {
      // Re-fetch pool with lock
      const currentPool = await tx.pool.findUnique({
        where: { id: pool.id },
      });

      if (!currentPool || currentPool.version !== pool.version) {
        throw new Error('Pool was modified by another transaction');
      }

      // Update pool
      await tx.pool.update({
        where: { id: pool.id },
        data: {
          currentSeats: { increment: request.seatCount },
          currentLuggage: { increment: request.luggageCount },
          version: { increment: 1 },
        },
      });

      // Update request
      await tx.rideRequest.update({
        where: { id: request.id },
        data: {
          poolId: pool.id,
          status: 'MATCHED',
          version: { increment: 1 },
        },
      });

      // Recalculate and update route
      await updatePoolRoute(pool.id, tx);
    });

    return true;
  } catch (error) {
    console.error('Failed to add to pool:', error);
    return false;
  }
}

/**
 * Create new pool for request
 */
async function createNewPool(request: RideRequest): Promise<Pool> {
  const pool = await prisma.pool.create({
    data: {
      currentSeats: request.seatCount,
      currentLuggage: request.luggageCount,
      status: 'FORMING',
    },
  });

  await prisma.rideRequest.update({
    where: { id: request.id },
    data: {
      poolId: pool.id,
      status: 'MATCHED',
    },
  });

  await updatePoolRoute(pool.id, prisma);

  return pool;
}

/**
 * Update optimized route for pool
 */
async function updatePoolRoute(poolId: string, tx: any): Promise<void> {
  const requests = await tx.rideRequest.findMany({
    where: { poolId },
  });

  const stops = buildRouteStops(requests);
  const constraints = buildDetourConstraints(requests);
  const route = optimizeRoute(stops, constraints);

  // Delete old route points
  await tx.routePoint.deleteMany({
    where: { poolId },
  });

  // Insert new route points
  const routePoints = route.stops.map((stop, index) => ({
    poolId,
    sequence: index,
    latitude: stop.coordinate.lat,
    longitude: stop.coordinate.lng,
    address: stop.address,
    type: stop.type,
    requestId: stop.requestId,
  }));

  await tx.routePoint.createMany({
    data: routePoints,
  });

  // Update pool distance
  await tx.pool.update({
    where: { id: poolId },
    data: {
      totalDistance: route.totalDistance,
    },
  });
}

/**
 * Calculate price for pooled ride
 */
async function calculatePooledPrice(
  request: RideRequest,
  poolId: string
): Promise<number> {
  const pricingConfig = await prisma.pricingConfig.findFirst();
  const config = pricingConfig || {
    baseFare: 50,
    perKmRate: 12,
    perMinuteRate: 2,
    poolDiscount: 0.30,
  };

  const { distance, time } = calculateDirectRoute(
    { lat: request.pickupLat, lng: request.pickupLng },
    { lat: request.dropoffLat, lng: request.dropoffLng }
  );

  let price = config.baseFare + distance * config.perKmRate + time * config.perMinuteRate;

  // Apply pool discount
  const pool = await prisma.pool.findUnique({
    where: { id: poolId },
    include: { rideRequests: true },
  });

  if (pool && pool.rideRequests.length > 1) {
    price *= 1 - config.poolDiscount;
  }

  // Apply surge pricing if high demand
  price *= pool?.surgeFactor || 1.0;

  return Math.round(price * 100) / 100;
}

/**
 * Handle ride cancellation
 * Removes from pool and reoptimizes route
 */
export async function handleCancellation(requestId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const request = await tx.rideRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || !request.poolId) {
      return;
    }

    // Update pool capacity
    await tx.pool.update({
      where: { id: request.poolId },
      data: {
        currentSeats: { decrement: request.seatCount },
        currentLuggage: { decrement: request.luggageCount },
        version: { increment: 1 },
      },
    });

    // Update request
    await tx.rideRequest.update({
      where: { id: requestId },
      data: {
        status: 'CANCELLED',
        poolId: null,
        cancelledAt: new Date(),
      },
    });

    // Reoptimize route
    await updatePoolRoute(request.poolId, tx);
  });
}
