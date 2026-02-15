import { CONFIG } from "../config/constants";

export interface Coordinate {
  lat: number;
  lng: number;
}

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

export function estimateTravelTime(distanceKm: number): number {
  const avgSpeedKmPerHour = 40;
  return (distanceKm / avgSpeedKmPerHour) * 60;
}

export class SpatialGrid<
  T extends { lat: number; lng: number; timestamp?: number },
> {
  private gridSize: number;
  private grid: Map<string, T[]>;
  private ttlMs: number;
  private cleanupInterval: NodeJS.Timeout;

  // ✅ FIX: Use CONFIG constants
  constructor(
    gridSize: number = CONFIG.SPATIAL.GRID_SIZE_DEGREES,
    ttlMs: number = CONFIG.SPATIAL.GRID_TTL_MS,
  ) {
    this.gridSize = gridSize;
    this.grid = new Map();
    this.ttlMs = ttlMs;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  private getGridKey(coord: Coordinate): string {
    const x = Math.floor(coord.lat / this.gridSize);
    const y = Math.floor(coord.lng / this.gridSize);
    return `${x},${y}`;
  }

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

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  insert(item: T): void {
    if (!item.timestamp) item.timestamp = Date.now();
    const key = this.getGridKey({ lat: item.lat, lng: item.lng });
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key)!.push(item);
  }

  findNearby(center: Coordinate, radiusKm: number): T[] {
    const nearby: T[] = [];
    const latDegrees = radiusKm / 111;
    const cellRadius = Math.ceil(latDegrees / this.gridSize);
    const centerKey = this.getGridKey(center);
    const [cx, cy] = centerKey.split(",").map(Number);

    for (let x = cx - cellRadius; x <= cx + cellRadius; x++) {
      for (let y = cy - cellRadius; y <= cy + cellRadius; y++) {
        const key = `${x},${y}`;
        const items = this.grid.get(key) || [];
        for (const item of items) {
          if (
            haversineDistance(center, { lat: item.lat, lng: item.lng }) <=
            radiusKm
          ) {
            nearby.push(item);
          }
        }
      }
    }
    return nearby;
  }

  remove(item: T): void {
    const key = this.getGridKey({ lat: item.lat, lng: item.lng });
    const items = this.grid.get(key);
    if (items) {
      const index = items.indexOf(item);
      if (index > -1) items.splice(index, 1);
      if (items.length === 0) this.grid.delete(key);
    }
  }

  clear(): void {
    this.grid.clear();
  }
}

export function getBoundingBox(center: Coordinate, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos(toRad(center.lat)));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}
