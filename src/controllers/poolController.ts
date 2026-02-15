/**
 * Pool Controllers
 * Manage ride pools and their lifecycle
 */

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * GET /api/pools
 * Get active pools with optional filters
 */
export async function getPools(req: Request, res: Response) {
  try {
    const { status, limit = 20 } = req.query;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const pools = await prisma.pool.findMany({
      where,
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      include: {
        rideRequests: {
          include: {
            passenger: {
              select: { id: true, name: true },
            },
          },
        },
        route: {
          orderBy: { sequence: 'asc' },
        },
      },
    });

    res.json({ pools });
  } catch (error) {
    logger.error('Error fetching pools:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/pools/:id
 * Get detailed pool information
 */
export async function getPool(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const pool = await prisma.pool.findUnique({
      where: { id },
      include: {
        rideRequests: {
          include: {
            passenger: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
        route: {
          orderBy: { sequence: 'asc' },
        },
      },
    });

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    res.json({ pool });
  } catch (error) {
    logger.error('Error fetching pool:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/pools/:id/status
 * Update pool status (admin only)
 */
export async function updatePoolStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['FORMING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const pool = await prisma.pool.update({
      where: { id },
      data: {
        status,
        startedAt: status === 'IN_PROGRESS' ? new Date() : undefined,
        completedAt: status === 'COMPLETED' ? new Date() : undefined,
      },
    });

    // If pool is starting, update all ride requests
    if (status === 'IN_PROGRESS') {
      await prisma.rideRequest.updateMany({
        where: { poolId: id },
        data: { status: 'IN_PROGRESS' },
      });
    }

    logger.info(`Pool ${id} status updated to ${status}`);
    res.json({ pool });
  } catch (error) {
    logger.error('Error updating pool status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/pools/stats
 * Get aggregated pool statistics
 */
export async function getPoolStats(req: Request, res: Response) {
  try {
    const [totalPools, formingPools, activePools, completedPools] = await Promise.all([
      prisma.pool.count(),
      prisma.pool.count({ where: { status: 'FORMING' } }),
      prisma.pool.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.pool.count({ where: { status: 'COMPLETED' } }),
    ]);

    const avgPoolSize = await prisma.pool.aggregate({
      _avg: { currentSeats: true },
      where: { status: { in: ['READY', 'IN_PROGRESS', 'COMPLETED'] } },
    });

    const totalDistance = await prisma.pool.aggregate({
      _sum: { totalDistance: true },
      where: { status: 'COMPLETED' },
    });

    res.json({
      totalPools,
      formingPools,
      activePools,
      completedPools,
      avgPoolSize: avgPoolSize._avg.currentSeats || 0,
      totalDistanceCompleted: totalDistance._sum.totalDistance || 0,
    });
  } catch (error) {
    logger.error('Error fetching pool stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
