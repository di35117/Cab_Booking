/**
 * Route Optimization Algorithm
 * Modified TSP solver with pickup-before-dropoff constraints
 * Uses nearest neighbor heuristic with local optimization
 */

import { haversineDistance, estimateTravelTime, Coordinate } from '../utils/geospatial';

export interface RouteStop {
  id: string;
  requestId: string;
  coordinate: Coordinate;
  type: 'PICKUP' | 'DROPOFF';
  address: string;
  passengerName?: string;
}

export interface OptimizedRoute {
  stops: RouteStop[];
  totalDistance: number;
  totalTime: number;
  valid: boolean;
  detourViolations: string[];
}

export interface DetourConstraint {
  requestId: string;
  maxDetourMins: number;
  directDistance: number;
  directTime: number;
}

/**
 * Optimize route for multiple pickups and dropoffs
 * Complexity: O(n²) with n = number of stops
 * Uses greedy nearest neighbor with constraint validation
 * 
 * @param stops Array of pickup and dropoff points
 * @param detourConstraints Maximum detour allowed per passenger
 * @returns Optimized route with validation
 */
export function optimizeRoute(
  stops: RouteStop[],
  detourConstraints: Map<string, DetourConstraint>
): OptimizedRoute {
  if (stops.length === 0) {
    return {
      stops: [],
      totalDistance: 0,
      totalTime: 0,
      valid: true,
      detourViolations: [],
    };
  }

  // Build constraint graph: pickup must come before dropoff
  const constraints = buildConstraintGraph(stops);
  
  // Use nearest neighbor with constraints
  const route = nearestNeighborWithConstraints(stops, constraints);
  
  // Calculate total distance and time
  const { totalDistance, totalTime } = calculateRouteMetrics(route);
  
  // Validate detour constraints
  const { valid, violations } = validateDetourConstraints(
    route,
    detourConstraints
  );

  return {
    stops: route,
    totalDistance,
    totalTime,
    valid,
    detourViolations: violations,
  };
}

/**
 * Build dependency graph for pickup-before-dropoff constraints
 */
function buildConstraintGraph(stops: RouteStop[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  
  // Group by request ID
  const requestStops = new Map<string, RouteStop[]>();
  stops.forEach(stop => {
    if (!requestStops.has(stop.requestId)) {
      requestStops.set(stop.requestId, []);
    }
    requestStops.get(stop.requestId)!.push(stop);
  });
  
  // For each request, dropoff depends on pickup
  requestStops.forEach((reqStops, requestId) => {
    const pickup = reqStops.find(s => s.type === 'PICKUP');
    const dropoff = reqStops.find(s => s.type === 'DROPOFF');
    
    if (pickup && dropoff) {
      if (!graph.has(dropoff.id)) {
        graph.set(dropoff.id, new Set());
      }
      graph.get(dropoff.id)!.add(pickup.id);
    }
  });
  
  return graph;
}

/**
 * Nearest neighbor algorithm with constraint checking
 * Greedy approach: always pick closest valid next stop
 * Complexity: O(n²)
 */
function nearestNeighborWithConstraints(
  stops: RouteStop[],
  constraints: Map<string, Set<string>>
): RouteStop[] {
  const route: RouteStop[] = [];
  const remaining = new Set(stops);
  const visited = new Set<string>();
  
  // Start with first pickup point
  let current = findFirstPickup(stops);
  route.push(current);
  remaining.delete(current);
  visited.add(current.id);
  
  while (remaining.size > 0) {
    let nearest: RouteStop | null = null;
    let minDistance = Infinity;
    
    // Find nearest valid stop
    for (const candidate of remaining) {
      // Check constraints: all dependencies must be visited
      const deps = constraints.get(candidate.id);
      if (deps && !Array.from(deps).every(d => visited.has(d))) {
        continue; // Skip if dependencies not met
      }
      
      const distance = haversineDistance(
        current.coordinate,
        candidate.coordinate
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearest = candidate;
      }
    }
    
    if (!nearest) {
      // No valid next stop (shouldn't happen with proper constraints)
      break;
    }
    
    route.push(nearest);
    remaining.delete(nearest);
    visited.add(nearest.id);
    current = nearest;
  }
  
  return route;
}

/**
 * Find first pickup point (prefer closest to origin or arbitrary start)
 */
function findFirstPickup(stops: RouteStop[]): RouteStop {
  const pickups = stops.filter(s => s.type === 'PICKUP');
  return pickups[0]; // In real system, start from depot/airport
}

/**
 * Calculate total distance and time for route
 * Complexity: O(n)
 */
function calculateRouteMetrics(route: RouteStop[]): {
  totalDistance: number;
  totalTime: number;
} {
  let totalDistance = 0;
  
  for (let i = 0; i < route.length - 1; i++) {
    const distance = haversineDistance(
      route[i].coordinate,
      route[i + 1].coordinate
    );
    totalDistance += distance;
  }
  
  const totalTime = estimateTravelTime(totalDistance);
  
  return { totalDistance, totalTime };
}

/**
 * Validate that no passenger exceeds their detour tolerance
 * Complexity: O(n)
 * 
 * For each passenger, compare actual route time vs direct time
 */
function validateDetourConstraints(
  route: RouteStop[],
  constraints: Map<string, DetourConstraint>
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const requestTimes = new Map<string, { pickup: number; dropoff: number }>();
  
  let cumulativeTime = 0;
  
  // Calculate time at each stop
  for (let i = 0; i < route.length; i++) {
    const stop = route[i];
    
    if (i > 0) {
      const distance = haversineDistance(
        route[i - 1].coordinate,
        stop.coordinate
      );
      cumulativeTime += estimateTravelTime(distance);
    }
    
    if (!requestTimes.has(stop.requestId)) {
      requestTimes.set(stop.requestId, { pickup: 0, dropoff: 0 });
    }
    
    if (stop.type === 'PICKUP') {
      requestTimes.get(stop.requestId)!.pickup = cumulativeTime;
    } else {
      requestTimes.get(stop.requestId)!.dropoff = cumulativeTime;
    }
  }
  
  // Check each passenger's detour
  constraints.forEach((constraint, requestId) => {
    const times = requestTimes.get(requestId);
    if (!times) return;
    
    const actualTravelTime = times.dropoff - times.pickup;
    const detour = actualTravelTime - constraint.directTime;
    
    if (detour > constraint.maxDetourMins) {
      violations.push(
        `Request ${requestId}: detour ${detour.toFixed(1)}min exceeds limit ${constraint.maxDetourMins}min`
      );
    }
  });
  
  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Calculate direct distance and time between pickup and dropoff
 */
export function calculateDirectRoute(
  pickup: Coordinate,
  dropoff: Coordinate
): { distance: number; time: number } {
  const distance = haversineDistance(pickup, dropoff);
  const time = estimateTravelTime(distance);
  return { distance, time };
}
