/**
 * Unit tests for geospatial utilities
 */

import { haversineDistance, estimateTravelTime, SpatialGrid, getBoundingBox } from '../utils/geospatial';

describe('Geospatial Utilities', () => {
  describe('haversineDistance', () => {
    it('should calculate distance between two coordinates', () => {
      const coord1 = { lat: 12.9716, lng: 77.5946 };
      const coord2 = { lat: 13.0067, lng: 77.5537 };
      
      const distance = haversineDistance(coord1, coord2);
      
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(10); // Should be a few km
    });

    it('should return 0 for same coordinates', () => {
      const coord = { lat: 12.9716, lng: 77.5946 };
      const distance = haversineDistance(coord, coord);
      
      expect(distance).toBe(0);
    });
  });

  describe('estimateTravelTime', () => {
    it('should estimate travel time correctly', () => {
      const distance = 20; // 20 km
      const time = estimateTravelTime(distance);
      
      // At 40 km/h, 20km should take 30 minutes
      expect(time).toBe(30);
    });

    it('should handle zero distance', () => {
      const time = estimateTravelTime(0);
      expect(time).toBe(0);
    });
  });

  describe('SpatialGrid', () => {
    let grid: SpatialGrid<{ lat: number; lng: number; id: string }>;

    beforeEach(() => {
      grid = new SpatialGrid(0.01);
    });

    it('should insert and find nearby items', () => {
      const item1 = { lat: 12.9716, lng: 77.5946, id: '1' };
      const item2 = { lat: 12.9720, lng: 77.5950, id: '2' };
      const item3 = { lat: 13.0067, lng: 77.5537, id: '3' }; // Far away

      grid.insert(item1);
      grid.insert(item2);
      grid.insert(item3);

      const nearby = grid.findNearby({ lat: 12.9716, lng: 77.5946 }, 1);
      
      expect(nearby.length).toBe(2);
      expect(nearby).toContainEqual(item1);
      expect(nearby).toContainEqual(item2);
      expect(nearby).not.toContainEqual(item3);
    });

    it('should handle empty grid', () => {
      const nearby = grid.findNearby({ lat: 12.9716, lng: 77.5946 }, 5);
      expect(nearby).toEqual([]);
    });
  });

  describe('getBoundingBox', () => {
    it('should calculate bounding box correctly', () => {
      const center = { lat: 12.9716, lng: 77.5946 };
      const radius = 5; // 5 km

      const bbox = getBoundingBox(center, radius);

      expect(bbox.minLat).toBeLessThan(center.lat);
      expect(bbox.maxLat).toBeGreaterThan(center.lat);
      expect(bbox.minLng).toBeLessThan(center.lng);
      expect(bbox.maxLng).toBeGreaterThan(center.lng);
    });
  });
});
