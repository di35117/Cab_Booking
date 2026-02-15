import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import rateLimit from "express-rate-limit";
import { prisma } from "./utils/prisma";

// Load environment variables
dotenv.config();

// Import routes
import rideRoutes from "./routes/rideRoutes";
import poolRoutes from "./routes/poolRoutes";
import { swaggerSpec } from "./config/swagger";
import { getQueueHealth, closeQueue } from "./services/queueService";
import logger from "./utils/logger";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // CORS
app.use(compression()); // Response compression
app.use(express.json()); // JSON body parser
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Rate Limiters configuration
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const createRideLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Max 10 ride requests per minute
  message: { error: "Too many ride creation requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * /health:
 * get:
 * summary: Health check endpoint
 * tags: [Health]
 * responses:
 * 200:
 * description: Service is healthy
 * 503:
 * description: Service is degraded (Queue backlog or DB down)
 */
app.get("/health", async (req: Request, res: Response) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check queue health
    const queueHealth = await getQueueHealth();

    // ✅ FIX: Check for queue overload
    // If queue depth > 1000, return 503 to signal degradation
    if (queueHealth.waiting > 1000) {
      logger.warn(
        `Health check failed: Queue overloaded with ${queueHealth.waiting} jobs`,
      );
      return res.status(503).json({
        status: "degraded",
        timestamp: new Date().toISOString(),
        database: "connected",
        queue: {
          waiting: queueHealth.waiting,
          status: "overloaded",
        },
      });
    }

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
      queue: queueHealth,
    });
  } catch (error) {
    logger.error("Health check failed:", error);
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * @swagger
 * /:
 * get:
 * summary: Root endpoint
 * responses:
 * 200:
 * description: Welcome message
 */
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Airport Ride Pooling API",
    version: "1.0.0",
    docs: "/api-docs",
    health: "/health",
  });
});

// Apply rate limiting
app.use("/api/rides/request", createRideLimiter);
app.use("/api", apiLimiter);

// API Routes
app.use("/api/rides", rideRoutes);
app.use("/api/pools", poolRoutes);

// Swagger documentation
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Airport Ride Pooling API Docs",
  }),
);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  await closeQueue();
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully...");
  await closeQueue();
  await prisma.$disconnect();
  process.exit(0);
});

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`API Docs: http://localhost:${PORT}/api-docs`);
  logger.info(`Health Check: http://localhost:${PORT}/health`);
});

export default app;
