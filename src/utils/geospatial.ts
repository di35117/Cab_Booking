/**
 * Geospatial utility functions
 * Uses Haversine formula for distance calculation
 */

export interface Coordinate {
  lat: number;
  lng: number;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Complexity: O(1)
 * @param coord1 First coordinate
 * @param coord2 Second coordinate
 * @returns Distance in kilometers
 */
export function haversineDistance(
  coord1: Coordinate,
  coord2: Coordinate,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(coord2.lat - coord1.lat);
  const dLng = toRad(coord2.lng - coord1.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(coord1.lat)) *
      Math.cos(toRad(coord2.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Estimate travel time based on distance
 * Assumes average speed of 40 km/h in city traffic
 * @param distanceKm Distance in kilometers
 * @returns Estimated time in minutes
 */
export function estimateTravelTime(distanceKm: number): number {
  const avgSpeedKmPerHour = 40;
  return (distanceKm / avgSpeedKmPerHour) * 60;
}

/**
 * Simple spatial grid for nearby search
 * Divides area into grid cells for O(1) lookup
 * Now includes TTL-based cleanup to prevent memory leaks
 */
export class SpatialGrid<
  T extends { lat: number; lng: number; timestamp?: number },
> {
  private gridSize: number;
  private grid: Map<string, T[]>;
  private ttlMs: number;
  private cleanupInterval: NodeJS.Timeout;

  /**
   * @param gridSize Size of grid cells (default ~1km)
   * @param ttlMs Time to live for items in ms (default 1 hour)
   */
  constructor(gridSize: number = 0.01, ttlMs: number = 3600000) {
    this.gridSize = gridSize;
    this.grid = new Map();
    this.ttlMs = ttlMs;

    // Start periodic cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  private getGridKey(coord: Coordinate): string {
    const x = Math.floor(coord.lat / this.gridSize);
    const y = Math.floor(coord.lng / this.gridSize);
    return `${x},${y}`;
  }

  /**
   * Cleanup expired items
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, items] of this.grid.entries()) {
      const validItems = items.filter(
        (item) => !item.timestamp || now - item.timestamp < this.ttlMs,
      );

      if (validItems.length !== items.length) {
        if (validItems.length === 0) {
          this.grid.delete(key);
        } else {
          this.grid.set(key, validItems);
        }
      }
    }
  }

  /**
   * Stop the cleanup interval (call when destroying instance)
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Insert item into spatial grid
   * Complexity: O(1)
   */
  insert(item: T): void {
    // Ensure item has timestamp if not present
    if (!item.timestamp) {
      item.timestamp = Date.now();
    }
    const key = this.getGridKey({ lat: item.lat, lng: item.lng });
    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    this.grid.get(key)!.push(item);
  }

  /**
   * Find items within radius
   * Complexity: O(k) where k is number of items in nearby cells
   * @param center Center coordinate
   * @param radiusKm Search radius in km
   * @returns Array of items within radius
   */
  findNearby(center: Coordinate, radiusKm: number): T[] {
    const nearby: T[] = [];
    // Convert radius to grid cells (approximate)
    const latDegrees = radiusKm / 111;
    const cellRadius = Math.ceil(latDegrees / this.gridSize);

    const centerKey = this.getGridKey(center);
    const [cx, cy] = centerKey.split(",").map(Number);

    // Check surrounding cells
    for (let x = cx - cellRadius; x <= cx + cellRadius; x++) {
      for (let y = cy - cellRadius; y <= cy + cellRadius; y++) {
        const key = `${x},${y}`;
        const items = this.grid.get(key) || [];

        for (const item of items) {
          const distance = haversineDistance(center, {
            lat: item.lat,
            lng: item.lng,
          });
          if (distance <= radiusKm) {
            nearby.push(item);
          }
        }
      }
    }

    return nearby;
  }

  /**
   * Remove item from grid
   * Complexity: O(k) where k is items in cell
   */
  remove(item: T): void {
    const key = this.getGridKey({ lat: item.lat, lng: item.lng });
    const items = this.grid.get(key);
    if (items) {
      const index = items.indexOf(item);
      if (index > -1) {
        items.splice(index, 1);
      }
      if (items.length === 0) {
        this.grid.delete(key);
      }
    }
  }

  clear(): void {
    this.grid.clear();
  }
}

/**
 * Calculate bounding box for a coordinate and radius
 * Used for database queries with spatial indexes
 */
export function getBoundingBox(center: Coordinate, radiusKm: number) {
  const latDelta = radiusKm / 111; // 1 degree lat ≈ 111km
  // Correction for longitude convergence at poles
  const lngDelta = radiusKm / (111 * Math.cos(toRad(center.lat)));

  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}
