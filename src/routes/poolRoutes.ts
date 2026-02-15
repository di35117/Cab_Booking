/**
 * Pool Routes
 */

import express from 'express';
import {
  getPools,
  getPool,
  updatePoolStatus,
  getPoolStats,
} from '../controllers/poolController';

const router = express.Router();

/**
 * @swagger
 * /api/pools:
 *   get:
 *     summary: Get all active pools
 *     tags: [Pools]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [FORMING, READY, IN_PROGRESS, COMPLETED, CANCELLED]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of pools
 */
router.get('/', getPools);

/**
 * @swagger
 * /api/pools/stats:
 *   get:
 *     summary: Get pool statistics
 *     tags: [Pools]
 *     responses:
 *       200:
 *         description: Aggregated stats
 */
router.get('/stats', getPoolStats);

/**
 * @swagger
 * /api/pools/{id}:
 *   get:
 *     summary: Get pool details
 *     tags: [Pools]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pool details
 *       404:
 *         description: Pool not found
 */
router.get('/:id', getPool);

/**
 * @swagger
 * /api/pools/{id}/status:
 *   put:
 *     summary: Update pool status
 *     tags: [Pools]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [FORMING, READY, IN_PROGRESS, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: Pool updated
 *       404:
 *         description: Pool not found
 */
router.put('/:id/status', updatePoolStatus);

export default router;
