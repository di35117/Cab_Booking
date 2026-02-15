# Architecture Documentation

## System Architecture Overview

### 1. Layered Architecture

```
┌─────────────────────────────────────────┐
│         Presentation Layer              │
│  (Express Routes + Controllers)         │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│         Business Logic Layer            │
│  - Matching Engine                      │
│  - Route Optimizer                      │
│  - Pricing Engine                       │
│  - Queue Service                        │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│         Data Access Layer               │
│  (Prisma ORM)                           │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│         Data Layer                      │
│  PostgreSQL + Redis                     │
└─────────────────────────────────────────┘
```

## 2. Matching Engine Design

### Algorithm Flow

```
Input: New RideRequest R
Output: Pool assignment

START
  │
  ├──> Query nearby pools (spatial index)
  │    Complexity: O(k), k = ~5-10 pools
  │
  ├──> For each pool P:
  │    │
  │    ├──> Check capacity constraints
  │    │    - Seats: P.currentSeats + R.seats <= maxSeats
  │    │    - Luggage: P.luggage + R.luggage <= maxLuggage
  │    │    Complexity: O(1)
  │    │
  │    ├──> Simulate route with R added
  │    │    - Build stops array
  │    │    - Call route optimizer
  │    │    Complexity: O(n²), n = pool size
  │    │
  │    ├──> Validate detour constraints
  │    │    - For each existing passenger
  │    │    - Check detour <= maxDetourMins
  │    │    Complexity: O(n)
  │    │
  │    └──> If all valid → MATCH FOUND
  │
  ├──> If no match → Create new pool
  │
END
```

### Data Structures

**Spatial Grid (for fast lookup)**
```
┌─────┬─────┬─────┬─────┐
│ A,B │  C  │     │     │  Grid cell size: ~1km
├─────┼─────┼─────┼─────┤
│     │ D,E │  F  │     │  Each cell contains
├─────┼─────┼─────┼─────┤  list of ride requests
│     │     │ G,H │  I  │
├─────┼─────┼─────┼─────┤  Lookup: O(1)
│     │     │     │     │  Nearby search: O(k)
└─────┴─────┴─────┴─────┘
```

**Route Constraint Graph**
```
Pickup A ──must come before──> Dropoff A
Pickup B ──must come before──> Dropoff B
Pickup C ──must come before──> Dropoff C

Prevents invalid orderings like:
❌ Dropoff A → Pickup A
✅ Pickup A → Pickup B → Dropoff A → Dropoff B
```

## 3. Route Optimization Algorithm

### TSP Variant with Constraints

**Problem:** Visit all pickup and dropoff points in optimal order

**Constraints:**
1. Pickup before dropoff (same passenger)
2. Minimize total distance
3. No passenger exceeds detour tolerance

**Algorithm: Nearest Neighbor with Constraint Checking**

```python
def optimizeRoute(stops, constraints):
    route = []
    remaining = Set(stops)
    visited = Set()
    
    # Start with any pickup
    current = findFirstPickup(stops)
    route.append(current)
    visited.add(current.id)
    remaining.remove(current)
    
    while remaining not empty:
        nearest = null
        minDist = infinity
        
        for candidate in remaining:
            # Check if dependencies satisfied
            if hasUnmetDependencies(candidate, visited, constraints):
                continue
            
            dist = distance(current, candidate)
            if dist < minDist:
                minDist = dist
                nearest = candidate
        
        route.append(nearest)
        visited.add(nearest.id)
        remaining.remove(nearest)
        current = nearest
    
    return route
```

**Complexity Analysis:**
- Outer loop: O(n) iterations
- Inner loop: O(n) candidates to check
- Distance calc: O(1)
- **Total: O(n²)** where n = 2 * poolSize ≤ 8

**Why not exact TSP solver?**
- Exact TSP is NP-hard: O(n!)
- For n=8: 40,320 permutations
- Our greedy: 64 operations
- Greedy gives 95%+ optimal solution in practice

## 4. Concurrency Control

### Optimistic Locking Pattern

**Problem:** Multiple requests trying to join same pool simultaneously

**Solution:** Version-based optimistic locking

```sql
-- Request 1 reads pool
SELECT * FROM Pool WHERE id = 'pool-123';
-- version = 5

-- Request 2 reads same pool
SELECT * FROM Pool WHERE id = 'pool-123';
-- version = 5

-- Request 1 tries to update
UPDATE Pool 
SET currentSeats = 3, version = 6
WHERE id = 'pool-123' AND version = 5;
-- ✅ Success! 1 row updated

-- Request 2 tries to update
UPDATE Pool 
SET currentSeats = 3, version = 6
WHERE id = 'pool-123' AND version = 5;
-- ❌ Fails! 0 rows updated (version mismatch)
-- Request 2 retries with fresh data
```

**Advantages:**
- No locks → Better throughput
- No deadlocks
- Scales horizontally
- Conflicts are rare (pools fill sequentially)

### Queue-Based Processing

```
HTTP Request → Queue Job → Worker Pool → Database

Benefits:
1. Rate limiting (natural backpressure)
2. Retry on failure
3. Job persistence
4. Concurrent processing
5. Priority handling
```

## 5. Database Design

### Indexing Strategy

**Why these indexes?**

```sql
-- Fast status filtering
CREATE INDEX idx_ride_status ON RideRequest(status);
-- Used in: WHERE status = 'PENDING'

-- Spatial queries
CREATE INDEX idx_ride_location ON RideRequest(pickupLat, pickupLng);
-- Used in: WHERE pickupLat BETWEEN ... AND pickupLng BETWEEN ...

-- Join optimization
CREATE INDEX idx_ride_pool ON RideRequest(poolId);
-- Used in: JOIN Pool WHERE poolId = ...

-- Route ordering
CREATE INDEX idx_route_sequence ON RoutePoint(poolId, sequence);
-- Used in: WHERE poolId = ... ORDER BY sequence
```

**Index Cardinality Analysis:**

| Index | Cardinality | Selectivity | Impact |
|-------|-------------|-------------|--------|
| status | Low (6 values) | Medium | Partial table scan |
| poolId | High (many pools) | High | Few rows returned |
| location | High (continuous) | High | Small result set |

### Query Optimization

**Example: Find nearby pending requests**

```sql
-- Inefficient (no indexes)
SELECT * FROM RideRequest 
WHERE status = 'PENDING';
-- Scans all requests

-- Optimized (uses composite index)
CREATE INDEX idx_status_location ON RideRequest(status, pickupLat, pickupLng);

SELECT * FROM RideRequest 
WHERE status = 'PENDING'
  AND pickupLat BETWEEN 12.96 AND 12.98
  AND pickupLng BETWEEN 77.58 AND 77.60;
-- Index seek → Fast!
```

## 6. Pricing Engine

### Dynamic Pricing Formula

```
finalPrice = (baseFare + distanceFare + timeFare + luggageFee) 
             × surgeFactor 
             × (1 - poolDiscount)

Where:
- baseFare = fixed cost per ride
- distanceFare = distance (km) × perKmRate
- timeFare = time (min) × perMinRate
- luggageFee = (luggage - 1) × luggageRate
- surgeFactor = f(demand) ∈ [1.0, 2.5]
- poolDiscount = 30% for pooled rides
```

### Surge Calculation

```
utilization = activeRequests / estimatedCapacity

if utilization <= threshold (80%):
    surge = 1.0  # No surge
else:
    surge = 1.0 + ((utilization - threshold) / (100 - threshold)) × (maxSurge - 1)
    surge = min(surge, maxSurge)

Examples:
- 50% utilization → 1.0x
- 80% utilization → 1.0x
- 90% utilization → 1.75x
- 100% utilization → 2.5x (max)
```

## 7. Scalability Considerations

### Vertical Scaling Limits

Single server capacity:
- **Database**: ~5000 TPS on modern SSD
- **Redis**: ~100K ops/s
- **Node.js**: ~1000 req/s per CPU core

### Horizontal Scaling Strategy

```
                    ┌──────────────┐
                    │Load Balancer │
                    └───┬──────┬───┘
                        │      │
              ┌─────────┘      └─────────┐
              │                          │
         ┌────▼────┐              ┌─────▼─────┐
         │ App 1   │              │  App 2    │
         │ Node.js │              │  Node.js  │
         └────┬────┘              └─────┬─────┘
              │                          │
              └───────┬──────────────────┘
                      │
            ┌─────────▼────────────┐
            │  PostgreSQL Primary  │
            │  (Write Master)      │
            └─────────┬────────────┘
                      │
            ┌─────────┼────────────┐
            │         │            │
       ┌────▼───┐ ┌──▼───┐   ┌───▼────┐
       │ Read   │ │ Read │   │ Read   │
       │Replica1│ │Replica2│  │Replica3│
       └────────┘ └──────┘   └────────┘
```

**For 10K concurrent users:**
- 3-5 app servers
- 1 primary + 2 read replicas
- Redis cluster (3 nodes)
- Total cost: ~$500-1000/month on AWS

## 8. Performance Tuning

### Critical Path Optimization

**Hot path:** POST /api/rides/request

```
1. Create request in DB         [~10ms]
2. Queue matching job           [~2ms]
3. Return response              [~1ms]
─────────────────────────────────────────
Total: ~13ms  ✅

Matching happens async:
4. Find nearby pools            [~20ms]
5. Check compatibility          [~30ms]
6. Optimize route               [~15ms]
7. Update database              [~10ms]
─────────────────────────────────────────
Total: ~75ms  ✅
```

### Caching Strategy

```typescript
// Cache pool metadata
const poolKey = `pool:${poolId}:meta`;
await redis.setex(poolKey, 60, JSON.stringify(pool));

// Cache nearby pools (geohash)
const geoKey = `pools:geo:${geohash}`;
await redis.zadd(geoKey, lat, lng, poolId);
```

**Cache hit rate target: >80%**

## 9. Error Handling

### Retry Strategy

```
Job fails
  │
  ├─> Attempt 1: Immediate retry
  ├─> Attempt 2: Wait 2s, retry
  ├─> Attempt 3: Wait 4s, retry
  └─> Failed: Move to DLQ (Dead Letter Queue)
```

### Failure Scenarios

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| DB connection loss | Health check | Reconnect + retry |
| Redis down | Operation failure | Fallback to DB |
| Invalid route | Validation error | Cancel + refund |
| Concurrent modification | Version mismatch | Retry with fresh data |

## 10. Monitoring & Alerts

### Key Metrics

```
Application Metrics:
- Request rate (req/s)
- Response time (p50, p95, p99)
- Error rate (%)
- Queue depth

Business Metrics:
- Pool fill rate
- Average detour time
- Price distribution
- Cancellation rate

Infrastructure:
- CPU usage
- Memory usage
- DB connections
- Network I/O
```

### Alert Thresholds

```yaml
alerts:
  - name: High latency
    threshold: p95 > 500ms
    severity: warning
  
  - name: Error spike
    threshold: error_rate > 5%
    severity: critical
  
  - name: Queue backup
    threshold: pending_jobs > 1000
    severity: warning
```

---

This architecture is designed for:
- ✅ High availability (99.9% uptime)
- ✅ Horizontal scalability (10K+ users)
- ✅ Low latency (<300ms p95)
- ✅ Cost efficiency ($0.10 per 1000 requests)
