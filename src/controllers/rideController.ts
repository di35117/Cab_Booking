/**
 * Ride Request Controllers
 * Handles all ride-related API endpoints
 */

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { queueRideMatch, queueCancellation, getJobStatus } from '../services/queueService';
import { getEstimatedPrice } from '../services/pricingEngine';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * POST /api/rides/request
 * Create a new ride request and queue for matching
 */
export async function createRideRequest(req: Request, res: Response) {
  try {
    const {
      passengerId,
      passengerName,
      passengerPhone,
      pickupLat,
      pickupLng,
      pickupAddress,
      dropoffLat,
      dropoffLng,
      dropoffAddress,
      luggageCount = 1,
      seatCount = 1,
      maxDetourMins = 15,
    } = req.body;

    // Validate required fields
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      return res.status(400).json({ error: 'Missing required location fields' });
    }

    // Create or find passenger
    let passenger;
    if (passengerId) {
      passenger = await prisma.passenger.findUnique({ where: { id: passengerId } });
    } else if (passengerPhone) {
      passenger = await prisma.passenger.upsert({
        where: { phone: passengerPhone },
        update: { name: passengerName },
        create: {
          name: passengerName,
          phone: passengerPhone,
        },
      });
    } else {
      return res.status(400).json({ error: 'Must provide passengerId or passengerPhone' });
    }

    if (!passenger) {
      return res.status(404).json({ error: 'Passenger not found' });
    }

    // Get price estimate
    const priceEstimate = await getEstimatedPrice(
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      luggageCount,
      seatCount
    );

    // Create ride request
    const rideRequest = await prisma.rideRequest.create({
      data: {
        passengerId: passenger.id,
        pickupLat,
        pickupLng,
        pickupAddress,
        dropoffLat,
        dropoffLng,
        dropoffAddress,
        luggageCount,
        seatCount,
        maxDetourMins,
        estimatedPrice: priceEstimate.pooledPrice,
        status: 'PENDING',
      },
    });

    // Queue for matching (async)
    queueRideMatch(rideRequest.id).catch((err) => {
      logger.error('Failed to queue ride match:', err);
    });

    logger.info(`Created ride request ${rideRequest.id}`);

    res.status(201).json({
      rideRequest,
      priceEstimate,
      message: 'Ride request created and queued for matching',
    });
  } catch (error) {
    logger.error('Error creating ride request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/rides/:id
 * Get ride request details
 */
export async function getRideRequest(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const rideRequest = await prisma.rideRequest.findUnique({
      where: { id },
      include: {
        passenger: {
          select: { id: true, name: true, phone: true },
        },
        pool: {
          include: {
            rideRequests: {
              select: {
                id: true,
                pickupAddress: true,
                dropoffAddress: true,
                status: true,
              },
            },
            route: {
              orderBy: { sequence: 'asc' },
            },
          },
        },
      },
    });

    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    // Get job status if pending
    let jobStatus = null;
    if (rideRequest.status === 'PENDING') {
      jobStatus = await getJobStatus(id);
    }

    res.json({
      rideRequest,
      jobStatus,
    });
  } catch (error) {
    logger.error('Error fetching ride request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/rides/:id
 * Cancel a ride request
 */
export async function cancelRideRequest(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const rideRequest = await prisma.rideRequest.findUnique({
      where: { id },
    });

    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    if (rideRequest.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Ride already cancelled' });
    }

    if (['IN_PROGRESS', 'COMPLETED'].includes(rideRequest.status)) {
      return res.status(400).json({ error: 'Cannot cancel ride in this status' });
    }

    // Queue cancellation
    await queueCancellation(id);

    res.json({ message: 'Ride cancellation queued' });
  } catch (error) {
    logger.error('Error cancelling ride request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/rides/estimate
 * Get price estimate without creating request
 */
export async function getPriceEstimate(req: Request, res: Response) {
  try {
    const { pickupLat, pickupLng, dropoffLat, dropoffLng, luggageCount, seatCount } = req.query;

    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      return res.status(400).json({ error: 'Missing required location fields' });
    }

    const estimate = await getEstimatedPrice(
      parseFloat(pickupLat as string),
      parseFloat(pickupLng as string),
      parseFloat(dropoffLat as string),
      parseFloat(dropoffLng as string),
      parseInt(luggageCount as string) || 1,
      parseInt(seatCount as string) || 1
    );

    res.json(estimate);
  } catch (error) {
    logger.error('Error getting price estimate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/rides/passenger/:passengerId
 * Get all rides for a passenger
 */
export async function getPassengerRides(req: Request, res: Response) {
  try {
    const { passengerId } = req.params;
    const { status, limit = 10 } = req.query;

    const where: any = { passengerId };
    if (status) {
      where.status = status;
    }

    const rides = await prisma.rideRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: parseInt(limit as string),
      include: {
        pool: {
          select: {
            id: true,
            status: true,
            currentSeats: true,
          },
        },
      },
    });

    res.json({ rides });
  } catch (error) {
    logger.error('Error fetching passenger rides:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
