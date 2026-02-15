/**
 * Load Testing Script
 * Simulates 100 req/s to test concurrency handling
 */

import axios from 'axios';

const API_BASE = 'http://localhost:3000/api';
const REQUESTS_PER_SECOND = 100;
const DURATION_SECONDS = 10;

interface TestResult {
  totalRequests: number;
  successful: number;
  failed: number;
  avgLatency: number;
  maxLatency: number;
  minLatency: number;
  p95Latency: number;
  p99Latency: number;
}

// Sample test data
const SAMPLE_LOCATIONS = [
  { lat: 12.9716, lng: 77.5946, address: 'Kempegowda Airport' },
  { lat: 13.0067, lng: 77.5537, address: 'Koramangala' },
  { lat: 12.9698, lng: 77.7500, address: 'Whitefield' },
  { lat: 13.0358, lng: 77.597, address: 'Indiranagar' },
];

const NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];

function randomLocation() {
  return SAMPLE_LOCATIONS[Math.floor(Math.random() * SAMPLE_LOCATIONS.length)];
}

function randomName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

async function createRideRequest(): Promise<{ latency: number; success: boolean }> {
  const pickup = randomLocation();
  const dropoff = randomLocation();
  
  const payload = {
    passengerName: randomName(),
    passengerPhone: `+91-${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
    pickupLat: pickup.lat + (Math.random() - 0.5) * 0.01,
    pickupLng: pickup.lng + (Math.random() - 0.5) * 0.01,
    pickupAddress: pickup.address,
    dropoffLat: dropoff.lat + (Math.random() - 0.5) * 0.01,
    dropoffLng: dropoff.lng + (Math.random() - 0.5) * 0.01,
    dropoffAddress: dropoff.address,
    luggageCount: Math.floor(Math.random() * 3) + 1,
    seatCount: Math.random() > 0.7 ? 2 : 1,
  };

  const start = Date.now();
  
  try {
    await axios.post(`${API_BASE}/rides/request`, payload);
    const latency = Date.now() - start;
    return { latency, success: true };
  } catch (error) {
    const latency = Date.now() - start;
    return { latency, success: false };
  }
}

async function runLoadTest(): Promise<TestResult> {
  console.log(`🚀 Starting load test: ${REQUESTS_PER_SECOND} req/s for ${DURATION_SECONDS}s`);
  console.log(`📊 Total requests: ${REQUESTS_PER_SECOND * DURATION_SECONDS}`);
  console.log('');

  const results: { latency: number; success: boolean }[] = [];
  const totalRequests = REQUESTS_PER_SECOND * DURATION_SECONDS;
  const interval = 1000 / REQUESTS_PER_SECOND; // ms between requests
  
  let requestsSent = 0;
  let successful = 0;
  let failed = 0;

  const startTime = Date.now();
  
  // Send requests at specified rate
  while (requestsSent < totalRequests) {
    const batchStart = Date.now();
    const promises: Promise<any>[] = [];
    
    // Send batch of requests
    for (let i = 0; i < REQUESTS_PER_SECOND && requestsSent < totalRequests; i++) {
      promises.push(createRideRequest());
      requestsSent++;
    }
    
    // Wait for batch to complete
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    
    batchResults.forEach(r => {
      if (r.success) successful++;
      else failed++;
    });
    
    // Progress update
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r⏱️  Progress: ${requestsSent}/${totalRequests} | ${elapsed}s | ✅ ${successful} | ❌ ${failed}`);
    
    // Wait to maintain rate (if needed)
    const batchDuration = Date.now() - batchStart;
    if (batchDuration < 1000) {
      await new Promise(resolve => setTimeout(resolve, 1000 - batchDuration));
    }
  }
  
  console.log('\n');
  
  // Calculate statistics
  const latencies = results.map(r => r.latency).sort((a, b) => a - b);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Index = Math.floor(latencies.length * 0.95);
  const p99Index = Math.floor(latencies.length * 0.99);

  return {
    totalRequests,
    successful,
    failed,
    avgLatency,
    maxLatency: Math.max(...latencies),
    minLatency: Math.min(...latencies),
    p95Latency: latencies[p95Index],
    p99Latency: latencies[p99Index],
  };
}

async function checkHealth() {
  try {
    const response = await axios.get(`${API_BASE.replace('/api', '')}/health`);
    console.log('✅ Server health check passed');
    return true;
  } catch (error) {
    console.log('❌ Server health check failed - is the server running?');
    return false;
  }
}

async function main() {
  console.log('🏥 Checking server health...\n');
  
  const healthy = await checkHealth();
  if (!healthy) {
    console.log('\n💡 Make sure to start the server first: npm run dev\n');
    process.exit(1);
  }
  
  console.log('');
  
  const result = await runLoadTest();
  
  console.log('\n📈 Load Test Results:');
  console.log('═'.repeat(50));
  console.log(`Total Requests:    ${result.totalRequests}`);
  console.log(`Successful:        ${result.successful} (${((result.successful / result.totalRequests) * 100).toFixed(2)}%)`);
  console.log(`Failed:            ${result.failed}`);
  console.log('');
  console.log('Latency Statistics:');
  console.log(`  Average:         ${result.avgLatency.toFixed(2)} ms`);
  console.log(`  Min:             ${result.minLatency} ms`);
  console.log(`  Max:             ${result.maxLatency} ms`);
  console.log(`  P95:             ${result.p95Latency} ms`);
  console.log(`  P99:             ${result.p99Latency} ms`);
  console.log('═'.repeat(50));
  
  if (result.avgLatency > 300) {
    console.log('\n⚠️  WARNING: Average latency exceeds 300ms threshold');
  } else {
    console.log('\n✅ Average latency within 300ms threshold');
  }
  
  if (result.successful / result.totalRequests < 0.95) {
    console.log('⚠️  WARNING: Success rate below 95%');
  } else {
    console.log('✅ Success rate above 95%');
  }
}

main().catch(console.error);
