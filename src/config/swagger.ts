/**
 * Swagger API Documentation Configuration
 */

import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Airport Ride Pooling API',
      version: '1.0.0',
      description: 'Smart Airport Ride Pooling Backend System with real-time matching and route optimization',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    tags: [
      {
        name: 'Rides',
        description: 'Ride request operations',
      },
      {
        name: 'Pools',
        description: 'Ride pool management',
      },
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
    ],
  },
  apis: ['./src/routes/*.ts', './src/server.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
