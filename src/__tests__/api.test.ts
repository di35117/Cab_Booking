/**
 * Integration tests for Ride API
 */

import request from 'supertest';
import app from '../../server';

describe('Ride API Integration Tests', () => {
  let createdRideId: string;

  describe('POST /api/rides/request', () => {
    it('should create a new ride request', async () => {
      const response = await request(app)
        .post('/api/rides/request')
        .send({
          passengerName: 'Test User',
          passengerPhone: '+91-9876543210',
          pickupLat: 12.9716,
          pickupLng: 77.5946,
          pickupAddress: 'Airport',
          dropoffLat: 13.0067,
          dropoffLng: 77.5537,
          dropoffAddress: 'Koramangala',
          luggageCount: 2,
          seatCount: 1,
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('rideRequest');
      expect(response.body).toHaveProperty('priceEstimate');
      expect(response.body.rideRequest.status).toBe('PENDING');
      
      createdRideId = response.body.rideRequest.id;
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/rides/request')
        .send({
          passengerName: 'Test User',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/rides/:id', () => {
    it('should return ride request details', async () => {
      if (!createdRideId) {
        return; // Skip if creation failed
      }

      const response = await request(app)
        .get(`/api/rides/${createdRideId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('rideRequest');
      expect(response.body.rideRequest.id).toBe(createdRideId);
    });

    it('should return 404 for non-existent ride', async () => {
      const response = await request(app)
        .get('/api/rides/non-existent-id');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/rides/estimate', () => {
    it('should return price estimate', async () => {
      const response = await request(app)
        .get('/api/rides/estimate')
        .query({
          pickupLat: 12.9716,
          pickupLng: 77.5946,
          dropoffLat: 13.0067,
          dropoffLng: 77.5537,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('soloPrice');
      expect(response.body).toHaveProperty('pooledPrice');
      expect(response.body.pooledPrice).toBeLessThan(response.body.soloPrice);
    });
  });

  describe('DELETE /api/rides/:id', () => {
    it('should cancel a ride request', async () => {
      if (!createdRideId) {
        return;
      }

      const response = await request(app)
        .delete(`/api/rides/${createdRideId}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('cancellation');
    });
  });
});

describe('Pool API Integration Tests', () => {
  describe('GET /api/pools', () => {
    it('should return list of pools', async () => {
      const response = await request(app)
        .get('/api/pools');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('pools');
      expect(Array.isArray(response.body.pools)).toBe(true);
    });

    it('should filter pools by status', async () => {
      const response = await request(app)
        .get('/api/pools')
        .query({ status: 'FORMING' });

      expect(response.status).toBe(200);
      expect(response.body.pools.every((p: any) => p.status === 'FORMING' || p.status === undefined)).toBe(true);
    });
  });

  describe('GET /api/pools/stats', () => {
    it('should return aggregated statistics', async () => {
      const response = await request(app)
        .get('/api/pools/stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('totalPools');
      expect(response.body).toHaveProperty('formingPools');
      expect(response.body).toHaveProperty('avgPoolSize');
    });
  });
});

describe('Health Check', () => {
  it('should return healthy status', async () => {
    const response = await request(app)
      .get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body).toHaveProperty('database');
    expect(response.body).toHaveProperty('queue');
  });
});
