import { prisma } from "../utils/prisma";
import { haversineDistance, estimateTravelTime } from "../utils/geospatial";

export interface PriceBreakdown {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  luggageFee: number;
  subtotal: number;
  poolDiscount: number;
  surgeFactor: number;
  totalPrice: number;
}

export interface PricingInput {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  luggageCount: number;
  seatCount: number;
  isPooled: boolean;
  poolSize?: number;
}

/**
 * Calculate ride price with full breakdown
 * Formula: (BaseFare + Distance * PerKmRate + Time * PerMinRate + LuggageFee) * SurgeFactor * (1 - PoolDiscount)
 */
export async function calculatePrice(
  input: PricingInput,
): Promise<PriceBreakdown> {
  const config = await getPricingConfig();

  // Calculate distance and time
  const distance = haversineDistance(
    { lat: input.pickupLat, lng: input.pickupLng },
    { lat: input.dropoffLat, lng: input.dropoffLng },
  );

  // --- VALIDATION START ---
  // Prevent unrealistic distances (Integer Overflow protection / Business Logic)
  if (distance > 500) {
    throw new Error("Distance exceeds maximum supported range (500km)");
  }

  if (distance < 0.5) {
    throw new Error("Distance too short for ride pooling (min 0.5km)");
  }
  // --- VALIDATION END ---

  const time = estimateTravelTime(distance);

  // Base components
  const baseFare = config.baseFare * input.seatCount;
  const distanceFare = distance * config.perKmRate;
  const timeFare = time * config.perMinuteRate;
  const luggageFee = calculateLuggageFee(input.luggageCount, config);

  const subtotal = baseFare + distanceFare + timeFare + luggageFee;

  // Apply pool discount
  let poolDiscount = 0;
  // Use input.poolSize if provided, otherwise assume standard pool size of 3 for estimation
  const effectivePoolSize = input.poolSize || 3;

  if (input.isPooled && effectivePoolSize > 1) {
    // Discount scales slightly with pool size to encourage filling cabs?
    // For now keeping simple: flat discount if pooled
    poolDiscount = subtotal * config.poolDiscount;
  }

  // Calculate surge
  const surgeFactor = await calculateSurgeFactor(input, config);

  // Final price calculation
  let calculatedTotal = (subtotal - poolDiscount) * surgeFactor;

  // --- PRICE CAP START ---
  // Cap total price to prevent overflow or billing errors
  const MAX_PRICE_CAP = 50000; // Maximum ₹50,000
  calculatedTotal = Math.min(calculatedTotal, MAX_PRICE_CAP);
  // --- PRICE CAP END ---

  return {
    baseFare,
    distanceFare,
    timeFare,
    luggageFee,
    subtotal,
    poolDiscount,
    surgeFactor,
    totalPrice: Math.round(calculatedTotal * 100) / 100,
  };
}

/**
 * Calculate luggage fees
 * Free for 1 bag, charge for additional
 */
function calculateLuggageFee(luggageCount: number, config: any): number {
  if (luggageCount <= 1) return 0;
  return (luggageCount - 1) * 20; // ₹20 per extra bag
}

/**
 * Calculate surge factor based on current demand
 * Formula: 1.0 + (currentDemand / capacity - threshold) * scaleFactor
 */
async function calculateSurgeFactor(
  input: PricingInput,
  config: any,
): Promise<number> {
  // Get current active requests in area
  // In a real system, you'd filter by geohash/location
  const activeRequestsCount = await prisma.rideRequest.count({
    where: {
      status: { in: ["PENDING", "MATCHED"] },
      requestedAt: {
        gte: new Date(Date.now() - 15 * 60 * 1000), // Last 15 minutes
      },
    },
  });

  // Estimate capacity (simplified - in real system, use actual cab availability)
  const estimatedCapacity = 1000; // Assume 1000 cabs available
  const utilizationPercent = (activeRequestsCount / estimatedCapacity) * 100;

  // If config.surgeThreshold is 80 (meaning 80%), we compare directly
  if (utilizationPercent <= config.surgeThreshold) {
    return 1.0; // No surge
  }

  // Linear surge above threshold
  // If utilization is 90% and threshold is 80%, multiplier is (90-80)/(100-80) = 0.5
  const surgeMultiplier =
    (utilizationPercent - config.surgeThreshold) /
    (100 - config.surgeThreshold);
  const surgeFactor = 1.0 + surgeMultiplier * (config.maxSurgeFactor - 1.0);

  return Math.min(surgeFactor, config.maxSurgeFactor);
}

/**
 * Get pricing configuration
 */
async function getPricingConfig() {
  let config = await prisma.pricingConfig.findFirst();

  if (!config) {
    // Create default config
    config = await prisma.pricingConfig.create({
      data: {
        baseFare: 50.0,
        perKmRate: 12.0,
        perMinuteRate: 2.0,
        poolDiscount: 0.3,
        surgeThreshold: 80,
        maxSurgeFactor: 2.5,
      },
    });
  }

  return config;
}

/**
 * Update pricing configuration
 */
export async function updatePricingConfig(
  updates: Partial<{
    baseFare: number;
    perKmRate: number;
    perMinuteRate: number;
    poolDiscount: number;
    surgeThreshold: number;
    maxSurgeFactor: number;
  }>,
) {
  const config = await getPricingConfig();

  return await prisma.pricingConfig.update({
    where: { id: config.id },
    data: updates,
  });
}

/**
 * Get estimated price for display before booking
 */
export async function getEstimatedPrice(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
  luggageCount: number = 1,
  seatCount: number = 1,
): Promise<{ soloPrice: number; pooledPrice: number }> {
  // We need to catch errors here because calculatePrice now throws on invalid distances
  try {
    const soloPrice = await calculatePrice({
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      luggageCount,
      seatCount,
      isPooled: false,
    });

    const pooledPrice = await calculatePrice({
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      luggageCount,
      seatCount,
      isPooled: true,
      poolSize: 3, // Assume average pool size
    });

    return {
      soloPrice: soloPrice.totalPrice,
      pooledPrice: pooledPrice.totalPrice,
    };
  } catch (error) {
    // Rethrow or return 0/null depending on how you want to handle invalid estimates
    throw error;
  }
}
