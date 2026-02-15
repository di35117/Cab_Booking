// src/config/constants.ts
export const CONFIG = {
  MATCHING: {
    MAX_POOL_SIZE: parseInt(process.env.MAX_POOL_SIZE || "4"),
    MAX_LUGGAGE: parseInt(process.env.MAX_LUGGAGE || "6"),
    SEARCH_RADIUS_KM: 5,
    MAX_DETOUR_MINS: 15,
  },
  PRICING: {
    BASE_FARE: 50,
    PER_KM_RATE: 12,
    SURGE_THRESHOLD_PERCENT: 80,
    POOL_DISCOUNT_PERCENT: 30,
  },
  SPATIAL: {
    GRID_SIZE_DEGREES: 0.01, // ~1km
    GRID_TTL_MS: 3600000, // 1 hour
  },
};
