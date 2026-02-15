/**
 * Ride Request Routes
 */

import express from 'express';
import {
  createRideRequest,
  getRideRequest,
  cancelRideRequest,
  getPriceEstimate,
  getPassengerRides,
} from '../controllers/rideController';

const router = express.Router();

/**
 * @swagger
 * /api/rides/request:
 *   post:
 *     summary: Create a new ride request
 *     tags: [Rides]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - passengerPhone
 *               - passengerName
 *               - pickupLat
 *               - pickupLng
 *               - pickupAddress
 *               - dropoffLat
 *               - dropoffLng
 *               - dropoffAddress
 *             properties:
 *               passengerPhone:
 *                 type: string
 *               passengerName:
 *                 type: string
 *               pickupLat:
 *                 type: number
 *               pickupLng:
 *                 type: number
 *               pickupAddress:
 *                 type: string
 *               dropoffLat:
 *                 type: number
 *               dropoffLng:
 *                 type: number
 *               dropoffAddress:
 *                 type: string
 *               luggageCount:
 *                 type: integer
 *                 default: 1
 *               seatCount:
 *                 type: integer
 *                 default: 1
 *               maxDetourMins:
 *                 type: integer
 *                 default: 15
 *     responses:
 *       201:
 *         description: Ride request created successfully
 *       400:
 *         description: Invalid input
 */
router.post('/request', createRideRequest);

/**
 * @swagger
 * /api/rides/{id}:
 *   get:
 *     summary: Get ride request details
 *     tags: [Rides]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ride request details
 *       404:
 *         description: Ride not found
 */
router.get('/:id', getRideRequest);

/**
 * @swagger
 * /api/rides/{id}:
 *   delete:
 *     summary: Cancel a ride request
 *     tags: [Rides]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cancellation queued
 *       404:
 *         description: Ride not found
 */
router.delete('/:id', cancelRideRequest);

/**
 * @swagger
 * /api/rides/estimate:
 *   get:
 *     summary: Get price estimate
 *     tags: [Rides]
 *     parameters:
 *       - in: query
 *         name: pickupLat
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: pickupLng
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: dropoffLat
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: dropoffLng
 *         required: true
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Price estimate
 */
router.get('/estimate', getPriceEstimate);

/**
 * @swagger
 * /api/rides/passenger/{passengerId}:
 *   get:
 *     summary: Get all rides for a passenger
 *     tags: [Rides]
 *     parameters:
 *       - in: path
 *         name: passengerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of passenger rides
 */
router.get('/passenger/:passengerId', getPassengerRides);

export default router;
