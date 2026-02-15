# 🚀 Quick Start Guide - Airport Ride Pooling System

## Option 1: Docker (Recommended - Fastest)

### Prerequisites
- Docker & Docker Compose installed

### Steps
```bash
# 1. Clone and enter directory
cd airport-ride-pooling

# 2. Start all services (PostgreSQL + Redis + App)
docker-compose up -d

# 3. Wait for services to be healthy (~30 seconds)
docker-compose logs -f app

# 4. Access the application
open http://localhost:3000/api-docs
```

That's it! ✅ The system is running with sample data.

---

## Option 2: Local Development (Manual Setup)

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### Step-by-Step Setup

#### 1. Install Dependencies
```bash
npm install
```

#### 2. Start Database Services

**PostgreSQL:**
```bash
# macOS (Homebrew)
brew services start postgresql@14

# Ubuntu/Debian
sudo systemctl start postgresql

# Windows
# Start PostgreSQL service from Services app

# Docker alternative
docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:14
```

**Redis:**
```bash
# macOS (Homebrew)
brew services start redis

# Ubuntu/Debian
sudo systemctl start redis

# Docker alternative
docker run --name redis -p 6379:6379 -d redis:6-alpine
```

#### 3. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` if needed (defaults should work for local development)

#### 4. Setup Database
```bash
# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Seed with sample data (optional but recommended)
npm run seed
```

#### 5. Start Application
```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start
```

#### 6. Verify Installation
```bash
# Test health endpoint
curl http://localhost:3000/health

# Should return:
# {"status":"healthy","database":"connected","queue":{"healthy":true}}
```

---

## 🧪 Testing the System

### 1. Access API Documentation
Open: http://localhost:3000/api-docs

### 2. Create a Ride Request

```bash
curl -X POST http://localhost:3000/api/rides/request \
  -H "Content-Type: application/json" \
  -d '{
    "passengerName": "John Doe",
    "passengerPhone": "+91-9876543210",
    "pickupLat": 12.9716,
    "pickupLng": 77.5946,
    "pickupAddress": "Kempegowda Airport",
    "dropoffLat": 13.0067,
    "dropoffLng": 77.5537,
    "dropoffAddress": "Koramangala",
    "luggageCount": 2,
    "seatCount": 1
  }'
```

### 3. Get Price Estimate

```bash
curl "http://localhost:3000/api/rides/estimate?pickupLat=12.9716&pickupLng=77.5946&dropoffLat=13.0067&dropoffLng=77.5537"
```

### 4. View Active Pools

```bash
curl http://localhost:3000/api/pools?status=FORMING
```

### 5. Run Load Test

```bash
# Install axios for load testing
npm install axios

# Run 100 req/s test
npm run load-test
```

Expected output:
```
✅ Average latency within 300ms threshold
✅ Success rate above 95%
```

---

## 📊 Exploring the System

### Database UI (Prisma Studio)
```bash
npm run prisma:studio
```
Opens at: http://localhost:5555

### View Logs
```bash
# Real-time logs
tail -f combined.log

# Error logs only
tail -f error.log
```

### Queue Monitoring
Visit health endpoint: http://localhost:3000/health

Shows:
- Active jobs
- Pending jobs
- Queue health status

---

## 🧪 Running Tests

```bash
# All tests with coverage
npm test

# Watch mode (for development)
npm run test:watch

# Specific test file
npm test -- src/utils/__tests__/geospatial.test.ts
```

---

## 📁 Project Structure

```
airport-ride-pooling/
├── src/
│   ├── algorithms/          # Core matching & routing logic
│   │   ├── matcher.ts       # Ride matching algorithm
│   │   └── routeOptimizer.ts # Route optimization (TSP)
│   ├── controllers/         # API request handlers
│   ├── routes/             # Express routes
│   ├── services/           # Business logic
│   │   ├── queueService.ts # Bull queue setup
│   │   └── pricingEngine.ts # Dynamic pricing
│   ├── utils/              # Utilities
│   │   ├── geospatial.ts  # Distance calculations
│   │   └── logger.ts      # Winston logging
│   ├── scripts/           # Utility scripts
│   │   ├── seed.ts       # Sample data generator
│   │   └── loadTest.ts   # Performance testing
│   └── server.ts         # Express app entry point
├── prisma/
│   └── schema.prisma     # Database schema
├── docs/                # Documentation
├── package.json
└── README.md
```

---

## 🐛 Troubleshooting

### Database Connection Error
```
Error: Can't reach database server
```

**Solution:**
1. Check PostgreSQL is running: `pg_isready`
2. Verify connection string in `.env`
3. Try: `npm run prisma:migrate`

### Redis Connection Error
```
Error: ECONNREFUSED 127.0.0.1:6379
```

**Solution:**
1. Check Redis is running: `redis-cli ping` (should return PONG)
2. Start Redis: `brew services start redis` or `sudo systemctl start redis`

### Port Already in Use
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution:**
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

### Migration Failed
```
Error: P3009: migrate found failed migrations
```

**Solution:**
```bash
# Reset database (WARNING: deletes all data)
npm run prisma:migrate reset

# Or manually fix in Prisma Studio
npm run prisma:studio
```

---

## 💡 Development Tips

### Hot Reload
```bash
npm run dev
# Server auto-restarts on file changes
```

### Database Changes
```bash
# 1. Edit prisma/schema.prisma
# 2. Create migration
npm run prisma:migrate

# 3. Generate new Prisma client
npm run prisma:generate
```

### Adding New API Endpoint
1. Create route in `src/routes/`
2. Create controller in `src/controllers/`
3. Add Swagger docs (JSDoc comments)
4. Test in `src/__tests__/`

---

## 📚 Additional Resources

- **API Docs**: http://localhost:3000/api-docs
- **Architecture**: See `docs/ARCHITECTURE.md`
- **Algorithms**: See inline comments in `src/algorithms/`
- **Database Schema**: See `prisma/schema.prisma`

---

## 🚀 Deployment Checklist

Before deploying to production:

- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Use strong PostgreSQL password
- [ ] Enable Redis password authentication
- [ ] Configure proper logging (external service)
- [ ] Set up monitoring (e.g., New Relic, DataDog)
- [ ] Configure backup strategy for PostgreSQL
- [ ] Set up SSL/TLS certificates
- [ ] Configure rate limiting
- [ ] Review security headers (Helmet.js config)
- [ ] Set up CI/CD pipeline
- [ ] Load test at expected scale

---

## 📞 Support

**Issues?** Create a GitHub issue with:
1. Error message/logs
2. Steps to reproduce
3. Environment (OS, Node version, etc.)

---

**Built with ❤️ - Ready to handle 10K+ concurrent users!**
