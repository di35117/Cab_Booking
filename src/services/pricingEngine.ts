/**
 * Dynamic Pricing Engine
 * Calculates ride prices based on multiple factors:
 * - Base fare + distance + time
 * - Pool discount
 * - Surge pricing based on demand
 * - Luggage fees
 */

import { PrismaClient } from '@prisma/client';
import { haversineDistance, estimateTravelTime } from '../utils/geospatial';

const prisma = new PrismaClient();

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
export async function calculatePrice(input: PricingInput): Promise<PriceBreakdown> {
  const config = await getPricingConfig();
  
  // Calculate distance and time
  const distance = haversineDistance(
    { lat: input.pickupLat, lng: input.pickupLng },
    { lat: input.dropoffLat, lng: input.dropoffLng }
  );
  const time = estimateTravelTime(distance);
  
  // Base components
  const baseFare = config.baseFare * input.seatCount;
  const distanceFare = distance * config.perKmRate;
  const timeFare = time * config.perMinuteRate;
  const luggageFee = calculateLuggageFee(input.luggageCount, config);
  
  const subtotal = baseFare + distanceFare + timeFare + luggageFee;
  
  // Apply pool discount
  let poolDiscount = 0;
  if (input.isPooled && input.poolSize && input.poolSize > 1) {
    poolDiscount = subtotal * config.poolDiscount;
  }
  
  // Calculate surge
  const surgeFactor = await calculateSurgeFactor(input, config);
  
  // Final price
  const totalPrice = (subtotal - poolDiscount) * surgeFactor;
  
  return {
    baseFare,
    distanceFare,
    timeFare,
    luggageFee,
    subtotal,
    poolDiscount,
    surgeFactor,
    totalPrice: Math.round(totalPrice * 100) / 100,
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
 * 
 * Example:
 * - 50% utilization → 1.0x (no surge)
 * - 80% utilization → 1.0x (at threshold)
 * - 90% utilization → 1.5x
 * - 100% utilization → 2.5x (max)
 */
async function calculateSurgeFactor(input: PricingInput, config: any): Promise<number> {
  // Get current active requests in area
  const activeRequestsCount = await prisma.rideRequest.count({
    where: {
      status: { in: ['PENDING', 'MATCHED'] },
      requestedAt: {
        gte: new Date(Date.now() - 15 * 60 * 1000), // Last 15 minutes
      },
    },
  });
  
  // Estimate capacity (simplified - in real system, use actual cab availability)
  const estimatedCapacity = 1000; // Assume 1000 cabs available
  const utilizationPercent = (activeRequestsCount / estimatedCapacity) * 100;
  
  if (utilizationPercent <= config.surgeThreshold) {
    return 1.0; // No surge
  }
  
  // Linear surge above threshold
  const surgeMultiplier = (utilizationPercent - config.surgeThreshold) / (100 - config.surgeThreshold);
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
        poolDiscount: 0.30,
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
export async function updatePricingConfig(updates: Partial<{
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  poolDiscount: number;
  surgeThreshold: number;
  maxSurgeFactor: number;
}>) {
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
  seatCount: number = 1
): Promise<{ soloPrice: number; pooledPrice: number }> {
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
}
