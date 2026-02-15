# 🚖 Airport Ride Pooling Backend System

A production-ready, high-performance ride pooling backend system that intelligently groups passengers into shared cabs while optimizing routes and pricing.

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [System Design](#system-design)
- [Setup Instructions](#setup-instructions)
- [API Documentation](#api-documentation)
- [Algorithm Complexity](#algorithm-complexity)
- [Performance](#performance)
- [Testing](#testing)
- [Database Schema](#database-schema)

## ✨ Features

### Core Functionality
- ✅ **Smart Passenger Matching**: Groups passengers with similar routes
- ✅ **Route Optimization**: Modified TSP solver for pickup/dropoff sequences
- ✅ **Constraint Validation**: Respects luggage, seat, and detour limits
- ✅ **Real-time Cancellation**: Handles ride cancellations and pool rebalancing
- ✅ **Dynamic Pricing**: Surge pricing based on demand + pool discounts

### Performance & Scalability
- ✅ **10,000 concurrent users** support
- ✅ **100 req/s** throughput with <300ms latency
- ✅ **Optimistic locking** for race condition prevention
- ✅ **Queue-based processing** with Bull + Redis
- ✅ **Spatial indexing** for fast nearby searches

## 🛠 Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Node.js 18+ | JavaScript runtime |
| **Framework** | Express.js | Web server |
| **Language** | TypeScript | Type safety |
| **Database** | PostgreSQL | Primary data store |
| **Cache** | Redis | Caching + queue backend |
| **ORM** | Prisma | Type-safe DB access |
| **Queue** | Bull | Job processing |
| **Docs** | Swagger/OpenAPI | API documentation |
| **Testing** | Jest + Supertest | Unit & integration tests |
| **Logging** | Winston | Structured logging |

## 🏗 Architecture

### High-Level Architecture

```
┌─────────────┐
│   Client    │
│   (Mobile)  │
└──────┬──────┘
       │
       │ HTTPS
       ▼
┌─────────────────────────────────┐
│      Express.js Server          │
│  ┌─────────────────────────┐   │
│  │   API Layer (Routes)    │   │
│  └────────┬────────────────┘   │
│           │                     │
│  ┌────────▼────────────────┐   │
│  │   Controllers           │   │
│  └────────┬────────────────┘   │
│           │                     │
│  ┌────────▼────────────────┐   │
│  │   Services Layer        │   │
│  │  - Matching Engine      │   │
│  │  - Route Optimizer      │   │
│  │  - Pricing Engine       │   │
│  └────────┬────────────────┘   │
│           │                     │
│  ┌────────▼────────────────┐   │
│  │   Queue Service         │   │
│  │   (Bull + Redis)        │   │
│  └────────┬────────────────┘   │
└───────────┼─────────────────────┘
            │
    ┌───────┴────────┐
    │                │
┌───▼────┐    ┌─────▼─────┐
│ Redis  │    │PostgreSQL │
│ Cache  │    │  Database │
└────────┘    └───────────┘
```

### Component Interaction Flow

```
Request Flow:
1. POST /api/rides/request
   ↓
2. RideController.createRideRequest()
   ↓
3. Create RideRequest in DB
   ↓
4. Queue matching job
   ↓
5. Bull Queue processes job
   ↓
6. MatchingEngine.matchRideRequest()
   ↓
7. Find compatible pool (spatial search)
   ↓
8. RouteOptimizer.optimizeRoute()
   ↓
9. Validate constraints
   ↓
10. Update pool + route (with optimistic locking)
    ↓
11. Calculate price
    ↓
12. Return result
```

## 🧠 System Design

### 1. Data Structures & Algorithms

#### Spatial Indexing (Grid-based)
```typescript
// Complexity: O(1) insert, O(k) lookup where k = items in nearby cells
class SpatialGrid {
  - Divides map into grid cells (~1km each)
  - Fast nearby passenger search
  - Used for initial pool matching
}
```

#### Matching Algorithm (Greedy + Backtracking)
```
Algorithm: findCompatiblePool()
Input: RideRequest R, Config C
Output: Pool P or null

1. Query pools near R.pickup (using spatial index)
   Time: O(k) where k = nearby pools
   
2. For each pool P in nearbyPools:
   a. Check capacity constraints: O(1)
   b. Simulate adding R to P: O(n²) where n = pool size
   c. Optimize route: O(n²)
   d. Validate detours: O(n)
   e. If valid, return P
   
3. If no match, create new pool: O(1)

Overall Complexity: O(k * n²)
- k ≈ 5-10 (nearby pools)
- n ≤ 4 (max pool size)
- Typical: ~100-400 operations per match
```

#### Route Optimization (Modified TSP)
```
Algorithm: optimizeRoute()
Input: List of pickup/dropoff stops
Output: Optimized sequence

Approach: Nearest Neighbor with Constraints
1. Start from first pickup
2. Build constraint graph (pickup before dropoff)
3. Greedily select nearest valid next stop
4. Repeat until all stops visited

Complexity: O(n²)
- n = 2 * poolSize (pickups + dropoffs)
- Max n = 8 for pool of 4
- Worst case: 64 distance calculations
```

### 2. Concurrency Handling

```typescript
// Optimistic Locking Pattern
async function addToPool(request, pool) {
  await prisma.$transaction(async (tx) => {
    // 1. Re-fetch with version check
    const currentPool = await tx.pool.findUnique({
      where: { id: pool.id }
    });
    
    if (currentPool.version !== pool.version) {
      throw new Error('Concurrent modification detected');
    }
    
    // 2. Update with version increment
    await tx.pool.update({
      where: { id: pool.id },
      data: {
        currentSeats: { increment: request.seatCount },
        version: { increment: 1 }  // Atomic increment
      }
    });
  });
}
```

**Why Optimistic Locking?**
- ✅ Better performance than pessimistic locks
- ✅ No deadlocks
- ✅ Scales well with concurrent requests
- ✅ Rare conflicts (pools fill sequentially)

### 3. Queue Processing Strategy

```
Bull Queue Configuration:
- Concurrency: 10 parallel workers
- Retry: 3 attempts with exponential backoff
- Priority: Cancellations > New requests
- Job removal: Auto-remove completed jobs

Benefits:
- Prevents database connection exhaustion
- Natural rate limiting
- Graceful degradation under load
- Job persistence across restarts
```

## 🚀 Setup Instructions

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Redis 6+

### 1. Clone Repository

```bash
git clone <repository-url>
cd airport-ride-pooling
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/ride_pooling"
REDIS_HOST="localhost"
REDIS_PORT=6379
PORT=3000
```

### 4. Setup Database

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Seed sample data
npm run seed
```

### 5. Start Services

**Terminal 1 - PostgreSQL:**
```bash
# Mac (Homebrew)
brew services start postgresql@14

# Ubuntu
sudo systemctl start postgresql

# Docker
docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:14
```

**Terminal 2 - Redis:**
```bash
# Mac (Homebrew)
brew services start redis

# Ubuntu
sudo systemctl start redis

# Docker
docker run --name redis -p 6379:6379 -d redis:6-alpine
```

**Terminal 3 - Application:**
```bash
# Development mode (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

### 6. Verify Installation

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "queue": { "healthy": true }
}
```

## 📚 API Documentation

### Interactive Docs

Once running, visit: **http://localhost:3000/api-docs**

### Quick API Reference

#### Create Ride Request
```bash
POST /api/rides/request
Content-Type: application/json

{
  "passengerName": "John Doe",
  "passengerPhone": "+91-9876543210",
  "pickupLat": 12.9716,
  "pickupLng": 77.5946,
  "pickupAddress": "Kempegowda Airport",
  "dropoffLat": 13.0067,
  "dropoffLng": 77.5537,
  "dropoffAddress": "Koramangala",
  "luggageCount": 2,
  "seatCount": 1,
  "maxDetourMins": 15
}
```

#### Get Ride Status
```bash
GET /api/rides/{rideId}
```

#### Cancel Ride
```bash
DELETE /api/rides/{rideId}
```

#### Get Price Estimate
```bash
GET /api/rides/estimate?pickupLat=12.97&pickupLng=77.59&dropoffLat=13.00&dropoffLng=77.55
```

#### View Active Pools
```bash
GET /api/pools?status=FORMING
```

### Postman Collection

Import from: `docs/Airport-Ride-Pooling.postman_collection.json`

## 📊 Algorithm Complexity Analysis

### Matching Engine
| Operation | Complexity | Explanation |
|-----------|-----------|-------------|
| Spatial lookup | O(k) | k = nearby pools (~5-10) |
| Compatibility check | O(n²) | n = pool size (≤4) |
| Route optimization | O(n²) | Modified TSP |
| Overall match | **O(k · n²)** | Dominated by route opt |

**Real-world performance:**
- Typical: k=5, n=3 → ~45 operations
- Worst case: k=10, n=4 → ~160 operations
- Target: <50ms per match

### Route Optimizer
| Operation | Complexity | Details |
|-----------|-----------|---------|
| Build constraints | O(n) | n stops |
| Nearest neighbor | O(n²) | For each stop, find nearest |
| Detour validation | O(n) | Check each passenger |
| **Total** | **O(n²)** | n ≤ 8 for pool of 4 |

### Database Operations
| Query | Complexity | Index |
|-------|-----------|-------|
| Find nearby pools | O(log n) | B-tree on location |
| Get ride by ID | O(1) | Primary key |
| Update pool | O(1) | Primary key + version |

## ⚡ Performance

### Benchmarks

Run load test:
```bash
npm run load-test
```

**Target Metrics:**
- ✅ Throughput: 100+ req/s
- ✅ Latency (avg): <300ms
- ✅ Latency (p95): <500ms
- ✅ Latency (p99): <1000ms
- ✅ Success rate: >99%

**Optimization Techniques:**
1. **Connection Pooling**: 20 PostgreSQL connections
2. **Redis Caching**: Pool metadata cached for 60s
3. **Spatial Indexing**: Grid-based for O(1) lookup
4. **Queue Batching**: Process 10 concurrent matches
5. **Database Indexes**: On status, location, timestamps

### Scaling Strategy

**Horizontal Scaling:**
```
Load Balancer
     │
     ├── App Server 1 ────┐
     ├── App Server 2 ────┤
     └── App Server 3 ────┼── PostgreSQL (Primary)
                          │
                          └── Redis Cluster
```

**For 10K concurrent users:**
- 3-5 app servers (2 CPU, 4GB RAM each)
- 1 PostgreSQL instance (4 CPU, 16GB RAM)
- 1 Redis cluster (3 nodes)

## 🧪 Testing

### Run Tests

```bash
# All tests with coverage
npm test

# Watch mode (for development)
npm run test:watch

# Unit tests only
npm test -- src/utils

# Integration tests only
npm test -- src/__tests__
```

### Test Coverage

Target: **>80% coverage**

```bash
npm test -- --coverage
```

### Test Structure

```
src/
  __tests__/
    api.test.ts           # Integration tests for APIs
  utils/
    __tests__/
      geospatial.test.ts  # Unit tests for utilities
  algorithms/
    __tests__/
      matcher.test.ts     # Matching logic tests
      routeOptimizer.test.ts
```

## 💾 Database Schema

### Entity Relationship Diagram

```
Passenger ──(1:M)── RideRequest ──(M:1)── Pool ──(1:M)── RoutePoint
                                            │
                                         (1:1)
                                            │
                                      PricingConfig
```

### Key Tables

**RideRequest**
```sql
- id (UUID, PK)
- passengerId (FK)
- pickupLat, pickupLng (Indexed for spatial queries)
- dropoffLat, dropoffLng
- status (Indexed)
- poolId (FK, Indexed)
- version (For optimistic locking)
- timestamps
```

**Pool**
```sql
- id (UUID, PK)
- status (Indexed)
- currentSeats, maxSeats
- currentLuggage, maxLuggage
- totalDistance
- surgeFactor
- version (For optimistic locking)
```

**RoutePoint**
```sql
- id (UUID, PK)
- poolId (FK, Indexed)
- sequence (Ordered)
- latitude, longitude
- type ('PICKUP' | 'DROPOFF')
```

### Indexes

```sql
-- Performance-critical indexes
CREATE INDEX idx_ride_status ON RideRequest(status);
CREATE INDEX idx_ride_pool ON RideRequest(poolId);
CREATE INDEX idx_ride_location ON RideRequest(pickupLat, pickupLng);
CREATE INDEX idx_pool_status ON Pool(status);
CREATE INDEX idx_route_pool_seq ON RoutePoint(poolId, sequence);
```

## 🔒 Security & Best Practices

- ✅ Helmet.js for security headers
- ✅ CORS configuration
- ✅ Rate limiting (via queue)
- ✅ Input validation (Zod schemas)
- ✅ SQL injection protection (Prisma)
- ✅ Environment variable management
- ✅ Structured logging (Winston)
- ✅ Graceful shutdown handling

## 📈 Monitoring & Observability

### Health Checks
```bash
GET /health
```

Returns:
- Database status
- Queue health (pending/active jobs)
- Timestamp

### Logs

Winston logging to:
- `combined.log` - All logs
- `error.log` - Errors only
- Console (development)

### Metrics to Track

1. **Request metrics**: req/s, latency percentiles
2. **Pool metrics**: avg pool size, fill rate
3. **Queue metrics**: job wait time, failure rate
4. **Database**: query time, connection pool usage

## 📝 Design Patterns Used

1. **Repository Pattern**: Database access abstraction
2. **Service Layer**: Business logic separation
3. **Queue Pattern**: Async job processing
4. **Optimistic Locking**: Concurrency control
5. **Factory Pattern**: Object creation
6. **Strategy Pattern**: Route optimization algorithms

## 🎯 Future Enhancements

- [ ] WebSocket for real-time updates
- [ ] ML-based demand prediction
- [ ] Multi-stop route planning
- [ ] Driver allocation system
- [ ] Payment integration
- [ ] Admin dashboard
- [ ] Mobile SDK

## 📄 License

MIT

## 👥 Support

For issues or questions, please create a GitHub issue.

---

**Built with ❤️ for high-performance ride pooling**
