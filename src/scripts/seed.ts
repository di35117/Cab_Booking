import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const LOCATIONS = {
  airport: { lat: 12.9716, lng: 77.5946, address: 'Kempegowda International Airport, Bangalore' },
  destinations: [
    { lat: 12.9716, lng: 77.5946, address: 'MG Road, Bangalore' },
    { lat: 13.0067, lng: 77.5537, address: 'Koramangala, Bangalore' },
    { lat: 12.9698, lng: 77.7500, address: 'Whitefield, Bangalore' },
    { lat: 13.0358, lng: 77.597, address: 'Indiranagar, Bangalore' },
    { lat: 12.9342, lng: 77.6094, address: 'HSR Layout, Bangalore' },
    { lat: 13.0451, lng: 77.6269, address: 'Hebbal, Bangalore' },
    { lat: 12.9344, lng: 77.6053, address: 'Jayanagar, Bangalore' },
    { lat: 12.9279, lng: 77.6271, address: 'BTM Layout, Bangalore' },
    { lat: 13.0418, lng: 77.5800, address: 'Malleshwaram, Bangalore' },
    { lat: 12.9538, lng: 77.4912, address: 'Rajajinagar, Bangalore' },
  ],
};

const PASSENGER_NAMES = [
  'Arjun Kumar',
  'Priya Sharma',
  'Rahul Verma',
  'Sneha Patel',
  'Vikram Singh',
  'Ananya Reddy',
  'Aditya Gupta',
  'Kavya Nair',
  'Rohan Joshi',
  'Ishita Iyer',
  'Siddharth Malhotra',
  'Divya Menon',
  'Karthik Rao',
  'Meera Krishnan',
  'Nikhil Desai',
];

async function main() {
  console.log('Starting database seed...');
  await prisma.pricingConfig.upsert({
    where: { id: '1' },
    update: {},
    create: {
      id: '1',
      baseFare: 50.0,
      perKmRate: 12.0,
      perMinuteRate: 2.0,
      poolDiscount: 0.30,
      surgeThreshold: 80,
      maxSurgeFactor: 2.5,
    },
  });
  console.log('Pricing config created');
  const passengers = [];
  for (let i = 0; i < PASSENGER_NAMES.length; i++) {
    const passenger = await prisma.passenger.upsert({
      where: { phone: `+91-98765${String(i).padStart(5, '0')}` },
      update: {},
      create: {
        name: PASSENGER_NAMES[i],
        phone: `+91-98765${String(i).padStart(5, '0')}`,
        email: `${PASSENGER_NAMES[i].toLowerCase().replace(' ', '.')}@example.com`,
      },
    });
    passengers.push(passenger);
  }
  console.log(`Created ${passengers.length} passengers`);
  const rideRequests = [];
  for (let i = 0; i < 30; i++) {
    const passenger = passengers[i % passengers.length];
    const destination = LOCATIONS.destinations[i % LOCATIONS.destinations.length];
    
    const isToAirport = i % 2 === 0;
    const [pickup, dropoff] = isToAirport 
      ? [destination, LOCATIONS.airport]
      : [LOCATIONS.airport, destination];

    const request = await prisma.rideRequest.create({
      data: {
        passengerId: passenger.id,
        pickupLat: pickup.lat + (Math.random() - 0.5) * 0.01, // Add small random offset
        pickupLng: pickup.lng + (Math.random() - 0.5) * 0.01,
        pickupAddress: pickup.address,
        dropoffLat: dropoff.lat + (Math.random() - 0.5) * 0.01,
        dropoffLng: dropoff.lng + (Math.random() - 0.5) * 0.01,
        dropoffAddress: dropoff.address,
        luggageCount: Math.floor(Math.random() * 3) + 1,
        seatCount: Math.random() > 0.7 ? 2 : 1,
        maxDetourMins: 15,
        status: i < 10 ? 'PENDING' : i < 20 ? 'MATCHED' : 'COMPLETED',
        requestedAt: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
        completedAt: i >= 20 ? new Date() : null,
      },
    });
    rideRequests.push(request);
  }
  console.log(`Created ${rideRequests.length} ride requests`);
  for (let i = 0; i < 5; i++) {
    const status = i === 0 ? 'FORMING' : i < 3 ? 'IN_PROGRESS' : 'COMPLETED';
    await prisma.pool.create({
      data: {
        status,
        maxSeats: 4,
        maxLuggage: 6,
        currentSeats: i + 1,
        currentLuggage: (i + 1) * 2,
        totalDistance: 15 + Math.random() * 20,
        basePrice: 200 + Math.random() * 300,
        surgeFactor: 1.0 + Math.random() * 0.5,
        createdAt: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
        startedAt: status !== 'FORMING' ? new Date(Date.now() - Math.random() * 12 * 60 * 60 * 1000) : null,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
    });
  }
  console.log('Created 5 sample pools');
  console.log('Database seeding completed!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
