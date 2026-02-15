/**
 * Ride Matching Algorithm
 * Groups passengers into pools while respecting constraints
 * Uses greedy algorithm with spatial filtering
 */

import { RideRequest, Pool } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { haversineDistance, Coordinate } from "../utils/geospatial";
import {
  optimizeRoute,
  calculateDirectRoute,
  RouteStop,
  DetourConstraint,
} from "./routeOptimizer";
import logger from "../utils/logger";
import { CONFIG } from "../config/constants"; // ✅ Import CONFIG

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
  config: MatchingConfig,
): Promise<MatchResult> {
  const request = await prisma.rideRequest.findUnique({
    where: { id: requestId },
  });

  if (!request) {
    return { success: false, message: "Request not found" };
  }

  const matchedPool = await findCompatiblePool(request, config);

  if (matchedPool) {
    const success = await addToPool(request, matchedPool, config);
    if (success) {
      const price = await calculatePooledPrice(request, matchedPool.id);
      return {
        success: true,
        poolId: matchedPool.id,
        message: "Matched with existing pool",
        estimatedPrice: price,
      };
    }
  }

  const newPool = await createNewPool(request);
  const price = await calculatePooledPrice(request, newPool.id);

  return {
    success: true,
    poolId: newPool.id,
    message: "Created new pool",
    estimatedPrice: price,
  };
}

async function findCompatiblePool(
  request: RideRequest,
  config: MatchingConfig,
): Promise<Pool | null> {
  const candidatePools = await prisma.pool.findMany({
    where: {
      status: "FORMING",
      currentSeats: { lt: config.maxPoolSize },
      currentLuggage: { lt: config.maxLuggage },
    },
    include: {
      rideRequests: true,
    },
    take: 50,
    orderBy: { createdAt: "desc" },
  });

  const requestLoc: Coordinate = {
    lat: request.pickupLat,
    lng: request.pickupLng,
  };

  const nearbyPools = candidatePools.filter((pool) => {
    if (pool.rideRequests.length === 0) return true;

    const poolLoc: Coordinate = {
      lat: pool.rideRequests[0].pickupLat,
      lng: pool.rideRequests[0].pickupLng,
    };

    const dist = haversineDistance(requestLoc, poolLoc);
    return dist <= config.searchRadiusKm;
  });

  for (const pool of nearbyPools) {
    if (await isCompatible(request, pool, config)) {
      return pool;
    }
  }

  return null;
}

async function isCompatible(
  request: RideRequest,
  pool: Pool,
  config: MatchingConfig,
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

  requests.forEach((req) => {
    stops.push({
      id: `${req.id}-pickup`,
      requestId: req.id,
      coordinate: { lat: req.pickupLat, lng: req.pickupLng },
      type: "PICKUP",
      address: req.pickupAddress,
    });

    stops.push({
      id: `${req.id}-dropoff`,
      requestId: req.id,
      coordinate: { lat: req.dropoffLat, lng: req.dropoffLng },
      type: "DROPOFF",
      address: req.dropoffAddress,
    });
  });

  return stops;
}

function buildDetourConstraints(
  requests: RideRequest[],
): Map<string, DetourConstraint> {
  const constraints = new Map<string, DetourConstraint>();

  requests.forEach((req) => {
    const { distance, time } = calculateDirectRoute(
      { lat: req.pickupLat, lng: req.pickupLng },
      { lat: req.dropoffLat, lng: req.dropoffLng },
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

async function addToPool(
  request: RideRequest,
  pool: Pool,
  config: MatchingConfig,
  maxRetries: number = 3,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const currentPool = await tx.pool.findUnique({
            where: { id: pool.id },
          });

          if (!currentPool) {
            throw new Error("Pool no longer exists");
          }

          if (currentPool.version !== pool.version && attempt > 0) {
            pool = currentPool;
          }

          if (
            currentPool.currentSeats + request.seatCount >
            config.maxPoolSize
          ) {
            return false;
          }

          await tx.pool.update({
            where: {
              id: pool.id,
              version: currentPool.version,
            },
            data: {
              currentSeats: { increment: request.seatCount },
              version: { increment: 1 },
            },
          });

          await tx.rideRequest.update({
            where: { id: request.id },
            data: { poolId: pool.id, status: "MATCHED" },
          });
        },
        {
          maxWait: 5000,
          timeout: 10000,
        },
      );

      return true;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        logger.error("Pool assignment failed after max retries", {
          requestId: request.id,
          poolId: pool.id,
          error: error instanceof Error ? error.message : "Unknown error",
          attempt: attempt + 1,
          context: "matching-engine",
        });
        return false;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * Math.pow(2, attempt)),
      );
    }
  }
  return false;
}

async function createNewPool(request: RideRequest): Promise<Pool> {
  const pool = await prisma.pool.create({
    data: {
      currentSeats: request.seatCount,
      currentLuggage: request.luggageCount,
      status: "FORMING",
    },
  });

  await prisma.rideRequest.update({
    where: { id: request.id },
    data: {
      poolId: pool.id,
      status: "MATCHED",
    },
  });

  await updatePoolRoute(pool.id, prisma);

  return pool;
}

async function updatePoolRoute(poolId: string, tx: any): Promise<void> {
  const requests = await tx.rideRequest.findMany({
    where: { poolId },
  });

  const stops = buildRouteStops(requests);
  const constraints = buildDetourConstraints(requests);
  const route = optimizeRoute(stops, constraints);

  await tx.routePoint.deleteMany({
    where: { poolId },
  });

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

  await tx.pool.update({
    where: { id: poolId },
    data: {
      totalDistance: route.totalDistance,
    },
  });
}

/**
 * Calculate price for pooled ride
 * ✅ FIX: Now uses CONFIG constants for fallback values
 */
async function calculatePooledPrice(
  request: RideRequest,
  poolId: string,
): Promise<number> {
  const pricingConfig = await prisma.pricingConfig.findFirst();

  // Use DB config if available, otherwise use CONFIG constants
  const config = pricingConfig || {
    baseFare: CONFIG.PRICING.BASE_FARE,
    perKmRate: CONFIG.PRICING.PER_KM_RATE,
    perMinuteRate: 2.0, // Keeping 2.0 as it wasn't in the provided CONFIG snippet
    poolDiscount: CONFIG.PRICING.POOL_DISCOUNT_PERCENT / 100, // Convert 30 to 0.30
  };

  const { distance, time } = calculateDirectRoute(
    { lat: request.pickupLat, lng: request.pickupLng },
    { lat: request.dropoffLat, lng: request.dropoffLng },
  );

  let price =
    config.baseFare + distance * config.perKmRate + time * config.perMinuteRate;

  const pool = await prisma.pool.findUnique({
    where: { id: poolId },
    include: { rideRequests: true },
  });

  if (pool && pool.rideRequests.length > 1) {
    price *= 1 - config.poolDiscount;
  }

  price *= pool?.surgeFactor || 1.0;

  return Math.round(price * 100) / 100;
}

export async function handleCancellation(requestId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const request = await tx.rideRequest.findUnique({
        where: { id: requestId },
      });

      if (!request || !request.poolId) {
        return;
      }

      await tx.pool.update({
        where: { id: request.poolId },
        data: {
          currentSeats: { decrement: request.seatCount },
          currentLuggage: { decrement: request.luggageCount },
          version: { increment: 1 },
        },
      });

      await tx.rideRequest.update({
        where: { id: requestId },
        data: {
          status: "CANCELLED",
          poolId: null,
          cancelledAt: new Date(),
        },
      });

      await updatePoolRoute(request.poolId, tx);
    },
    {
      maxWait: 5000,
      timeout: 10000,
    },
  );
}
