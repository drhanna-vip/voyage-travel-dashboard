'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const path = require('path');

// ─── Auth Config ──────────────────────────────────────────────────────────────
const AUTH_USER = process.env.AUTH_USER || 'gh';
const AUTH_PASS = process.env.AUTH_PASS || 'gh';
const SESSION_SECRET = process.env.SESSION_SECRET || 'voyage-secret-2026-vip';

const app = express();
const PORT = process.env.PORT || 3030;
const DEMO_MODE = !process.env.AMADEUS_CLIENT_ID;

// ─── Security & Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  // Allow health check without auth
  if (req.path === '/health') return next();
  // Allow login page and auth route
  if (req.path === '/login.html' || req.path.startsWith('/auth/')) return next();
  // API calls get 401
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  // Everything else → login page
  return res.redirect('/login.html');
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === AUTH_USER && password === AUTH_PASS) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

app.use(requireAuth);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again shortly.' }
});
app.use('/api', limiter);

// ─── Amadeus Client ───────────────────────────────────────────────────────────
let amadeus = null;
if (!DEMO_MODE) {
  const Amadeus = require('amadeus');
  amadeus = new Amadeus({
    clientId: process.env.AMADEUS_CLIENT_ID,
    clientSecret: process.env.AMADEUS_CLIENT_SECRET
  });
}

// ─── Airline Metadata ─────────────────────────────────────────────────────────
const AIRLINE_MAP = {
  AA: { name: 'American Airlines', website: 'aa.com' },
  DL: { name: 'Delta Air Lines',   website: 'delta.com' },
  UA: { name: 'United Airlines',   website: 'united.com' },
  B6: { name: 'JetBlue Airways',   website: 'jetblue.com' },
  WN: { name: 'Southwest Airlines',website: 'southwest.com' },
  AS: { name: 'Alaska Airlines',   website: 'alaskaair.com' },
  F9: { name: 'Frontier Airlines', website: 'flyfrontier.com' },
  NK: { name: 'Spirit Airlines',   website: 'spirit.com' },
  LH: { name: 'Lufthansa',         website: 'lufthansa.com' },
  BA: { name: 'British Airways',   website: 'britishairways.com' },
  AF: { name: 'Air France',        website: 'airfrance.com' },
  EK: { name: 'Emirates',          website: 'emirates.com' },
  QR: { name: 'Qatar Airways',     website: 'qatarairways.com' },
  SQ: { name: 'Singapore Airlines',website: 'singaporeair.com' }
};

// ─── Mock Data ────────────────────────────────────────────────────────────────
const MOCK_FLIGHTS = [
  {
    id: 'mock-1',
    airline: { code: 'DL', name: 'Delta Air Lines', website: 'delta.com', logo: 'https://logo.clearbit.com/delta.com' },
    flightNumber: 'DL302',
    departure: { iata: 'JFK', time: '06:00', date: '' },
    arrival:   { iata: 'LAX', time: '09:30', date: '' },
    duration: '5h 30m',
    stops: 0,
    stopAirports: [],
    price: 347,
    currency: 'USD',
    class: 'ECONOMY',
    seatsLeft: 4,
    baggage: 'Carry-on included. Checked bag $30.',
    amenities: ['Power outlets', 'In-flight entertainment', 'Wi-Fi available'],
    co2: '142 kg CO₂ per passenger'
  },
  {
    id: 'mock-2',
    airline: { code: 'AA', name: 'American Airlines', website: 'aa.com', logo: 'https://logo.clearbit.com/aa.com' },
    flightNumber: 'AA102',
    departure: { iata: 'JFK', time: '08:00', date: '' },
    arrival:   { iata: 'LAX', time: '11:45', date: '' },
    duration: '5h 45m',
    stops: 0,
    stopAirports: [],
    price: 298,
    currency: 'USD',
    class: 'ECONOMY',
    seatsLeft: 7,
    baggage: 'Carry-on included. Checked bag $35.',
    amenities: ['Power outlets', 'In-flight entertainment'],
    co2: '148 kg CO₂ per passenger'
  },
  {
    id: 'mock-3',
    airline: { code: 'UA', name: 'United Airlines', website: 'united.com', logo: 'https://logo.clearbit.com/united.com' },
    flightNumber: 'UA175',
    departure: { iata: 'JFK', time: '10:00', date: '' },
    arrival:   { iata: 'LAX', time: '13:55', date: '' },
    duration: '5h 55m',
    stops: 1,
    stopAirports: ['ORD'],
    price: 219,
    currency: 'USD',
    class: 'ECONOMY',
    seatsLeft: 12,
    baggage: 'Carry-on included. Checked bag $35.',
    amenities: ['Power outlets'],
    co2: '162 kg CO₂ per passenger'
  },
  {
    id: 'mock-4',
    airline: { code: 'B6', name: 'JetBlue Airways', website: 'jetblue.com', logo: 'https://logo.clearbit.com/jetblue.com' },
    flightNumber: 'B6623',
    departure: { iata: 'JFK', time: '12:00', date: '' },
    arrival:   { iata: 'LAX', time: '15:45', date: '' },
    duration: '5h 45m',
    stops: 0,
    stopAirports: [],
    price: 389,
    currency: 'USD',
    class: 'ECONOMY',
    seatsLeft: 3,
    baggage: 'First bag free. Carry-on included.',
    amenities: ['Free Wi-Fi', 'Power outlets', 'In-flight entertainment', 'Snacks'],
    co2: '148 kg CO₂ per passenger'
  },
  {
    id: 'mock-5',
    airline: { code: 'DL', name: 'Delta Air Lines', website: 'delta.com', logo: 'https://logo.clearbit.com/delta.com' },
    flightNumber: 'DL1968',
    departure: { iata: 'JFK', time: '18:00', date: '' },
    arrival:   { iata: 'LAX', time: '21:30', date: '' },
    duration: '5h 30m',
    stops: 0,
    stopAirports: [],
    price: 447,
    currency: 'USD',
    class: 'PREMIUM_ECONOMY',
    seatsLeft: 2,
    baggage: '2 checked bags included.',
    amenities: ['Premium seat', 'Power outlets', 'In-flight entertainment', 'Meal service'],
    co2: '142 kg CO₂ per passenger'
  },
  {
    id: 'mock-6',
    airline: { code: 'AA', name: 'American Airlines', website: 'aa.com', logo: 'https://logo.clearbit.com/aa.com' },
    flightNumber: 'AA268',
    departure: { iata: 'JFK', time: '21:00', date: '' },
    arrival:   { iata: 'LAX', time: '00:35', date: '+1' },
    duration: '5h 35m',
    stops: 0,
    stopAirports: [],
    price: 899,
    currency: 'USD',
    class: 'BUSINESS',
    seatsLeft: 5,
    baggage: '3 checked bags included. Priority boarding.',
    amenities: ['Lie-flat seat', 'Premium meal', 'Lounge access', 'Wi-Fi', 'Amenity kit'],
    co2: '148 kg CO₂ per passenger'
  }
];

const MOCK_HOTELS = [
  {
    id: 'mock-h1',
    name: 'The Peninsula New York',
    stars: 5,
    rating: 9.5,
    ratingLabel: 'Exceptional',
    location: '700 5th Ave, Midtown Manhattan',
    amenities: ['Spa', 'Pool', 'Restaurant', 'Gym', 'Wi-Fi', 'Concierge'],
    pricePerNight: 595,
    currency: 'USD',
    image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600&q=80',
    brand: null
  },
  {
    id: 'mock-h2',
    name: 'Kimpton Hotel Eventi',
    stars: 4,
    rating: 9.1,
    ratingLabel: 'Excellent',
    location: '851 Avenue of the Americas, Chelsea',
    amenities: ['Restaurant', 'Gym', 'Wi-Fi', 'Bar', 'Business Center'],
    pricePerNight: 289,
    currency: 'USD',
    image: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600&q=80',
    brand: null
  },
  {
    id: 'mock-h3',
    name: 'The Plaza Hotel',
    stars: 5,
    rating: 9.3,
    ratingLabel: 'Exceptional',
    location: 'Fifth Avenue at Central Park South',
    amenities: ['Spa', 'Restaurant', 'Gym', 'Wi-Fi', 'Concierge', 'Valet'],
    pricePerNight: 750,
    currency: 'USD',
    image: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=600&q=80',
    brand: null
  },
  {
    id: 'mock-h4',
    name: 'Arlo SoHo',
    stars: 3,
    rating: 8.7,
    ratingLabel: 'Excellent',
    location: '231 Hudson St, SoHo',
    amenities: ['Rooftop Bar', 'Wi-Fi', 'Restaurant', 'Gym'],
    pricePerNight: 199,
    currency: 'USD',
    image: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=600&q=80',
    brand: null
  },
  {
    id: 'mock-h5',
    name: 'Park Hyatt New York',
    stars: 5,
    rating: 9.6,
    ratingLabel: 'Exceptional',
    location: '153 W 57th St, Midtown',
    amenities: ['Spa', 'Pool', 'Restaurant', 'Gym', 'Wi-Fi', 'Butler Service'],
    pricePerNight: 895,
    currency: 'USD',
    image: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80',
    brand: 'Hyatt'
  },
  {
    id: 'mock-h6',
    name: 'citizenM New York Times Square',
    stars: 4,
    rating: 8.9,
    ratingLabel: 'Excellent',
    location: '218 W 50th St, Times Square',
    amenities: ['Rooftop Bar', 'Wi-Fi', 'Gym', 'Restaurant'],
    pricePerNight: 249,
    currency: 'USD',
    image: 'https://images.unsplash.com/photo-1549294413-26f195200c16?w=600&q=80',
    brand: null
  }
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseAmadeusFlights(offers, searchParams) {
  return offers.map((offer, idx) => {
    const itinerary = offer.itineraries[0];
    const segment   = itinerary.segments[0];
    const lastSeg   = itinerary.segments[itinerary.segments.length - 1];
    const airlineCode = segment.carrierCode;
    const airlineInfo = AIRLINE_MAP[airlineCode] || { name: airlineCode, website: `${airlineCode.toLowerCase()}.com` };

    const depTime = segment.departure.at.split('T')[1].slice(0,5);
    const arrTime = lastSeg.arrival.at.split('T')[1].slice(0,5);
    const depDate = segment.departure.at.split('T')[0];
    const arrDate = lastSeg.arrival.at.split('T')[0];

    const stops = itinerary.segments.length - 1;
    const stopAirports = itinerary.segments.slice(0, -1).map(s => s.arrival.iataCode);

    const durationRaw = itinerary.duration || 'PT0H0M';
    const durMatch = durationRaw.match(/PT(\d+H)?(\d+M)?/);
    const hours   = durMatch && durMatch[1] ? parseInt(durMatch[1]) : 0;
    const minutes = durMatch && durMatch[2] ? parseInt(durMatch[2]) : 0;
    const duration = `${hours}h ${minutes}m`;

    const price = parseFloat(offer.price.total);
    const travelClass = offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || searchParams.class || 'ECONOMY';

    return {
      id: offer.id || `flight-${idx}`,
      airline: {
        code: airlineCode,
        name: airlineInfo.name,
        website: airlineInfo.website,
        logo: `https://logo.clearbit.com/${airlineInfo.website}`
      },
      flightNumber: `${airlineCode}${segment.number}`,
      departure: { iata: segment.departure.iataCode, time: depTime, date: depDate },
      arrival:   { iata: lastSeg.arrival.iataCode, time: arrTime, date: arrDate },
      duration,
      stops,
      stopAirports,
      price,
      currency: offer.price.currency || 'USD',
      class: travelClass,
      seatsLeft: offer.numberOfBookableSeats || null,
      baggage: 'See airline for baggage policy.',
      amenities: [],
      co2: null
    };
  });
}

function parseAmadeusHotels(hotels) {
  return hotels.map((h, idx) => {
    const offer = h.offers?.[0];
    const price = offer ? parseFloat(offer.price.total) : null;
    const images = [
      'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600&q=80',
      'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600&q=80',
      'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=600&q=80',
      'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=600&q=80',
      'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80',
      'https://images.unsplash.com/photo-1549294413-26f195200c16?w=600&q=80'
    ];
    return {
      id: h.hotel?.hotelId || `hotel-${idx}`,
      name: h.hotel?.name || 'Hotel',
      stars: h.hotel?.rating || 3,
      rating: null,
      ratingLabel: null,
      location: h.hotel?.address?.lines?.join(', ') || h.hotel?.cityCode || '',
      amenities: h.hotel?.amenities?.slice(0,6) || ['Wi-Fi'],
      pricePerNight: price,
      currency: offer?.price?.currency || 'USD',
      image: images[idx % images.length],
      brand: null
    };
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', demo: DEMO_MODE, ts: new Date().toISOString() });
});

// Airport autocomplete
app.get('/api/airports', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  if (DEMO_MODE) {
    const DEMO_AIRPORTS = [
      { iata: 'JFK', name: 'John F. Kennedy International Airport', city: 'New York', country: 'US' },
      { iata: 'LAX', name: 'Los Angeles International Airport',    city: 'Los Angeles', country: 'US' },
      { iata: 'ORD', name: "O'Hare International Airport",         city: 'Chicago', country: 'US' },
      { iata: 'MIA', name: 'Miami International Airport',          city: 'Miami', country: 'US' },
      { iata: 'LGA', name: 'LaGuardia Airport',                    city: 'New York', country: 'US' },
      { iata: 'EWR', name: 'Newark Liberty International Airport', city: 'Newark', country: 'US' },
      { iata: 'SFO', name: 'San Francisco International Airport',  city: 'San Francisco', country: 'US' },
      { iata: 'BOS', name: 'Boston Logan International Airport',   city: 'Boston', country: 'US' },
      { iata: 'CDG', name: 'Charles de Gaulle Airport',            city: 'Paris', country: 'FR' },
      { iata: 'LHR', name: 'Heathrow Airport',                     city: 'London', country: 'GB' },
      { iata: 'NRT', name: 'Narita International Airport',         city: 'Tokyo', country: 'JP' },
      { iata: 'DXB', name: 'Dubai International Airport',          city: 'Dubai', country: 'AE' },
      { iata: 'ATL', name: 'Hartsfield-Jackson Atlanta International', city: 'Atlanta', country: 'US' },
      { iata: 'DFW', name: 'Dallas/Fort Worth International Airport',  city: 'Dallas', country: 'US' },
      { iata: 'SEA', name: 'Seattle-Tacoma International Airport',     city: 'Seattle', country: 'US' }
    ];
    const filtered = DEMO_AIRPORTS.filter(a =>
      a.iata.toLowerCase().includes(q.toLowerCase()) ||
      a.name.toLowerCase().includes(q.toLowerCase()) ||
      a.city.toLowerCase().includes(q.toLowerCase())
    );
    return res.json(filtered.slice(0, 8));
  }

  try {
    const response = await amadeus.referenceData.locations.get({
      keyword: q,
      subType: 'AIRPORT,CITY'
    });
    const results = (response.data || []).map(loc => ({
      iata:    loc.iataCode,
      name:    loc.name,
      city:    loc.address?.cityName || '',
      country: loc.address?.countryCode || ''
    }));
    res.json(results.slice(0, 10));
  } catch (err) {
    console.error('Airport search error:', err.description || err.message);
    res.json([]);
  }
});

// Flight search
app.get('/api/flights', async (req, res) => {
  const { origin, destination, departure, return: returnDate, adults = 1, class: travelClass = 'ECONOMY' } = req.query;
  if (!origin || !destination || !departure) {
    return res.json({ flights: [], error: 'Missing required parameters: origin, destination, departure' });
  }

  if (DEMO_MODE) {
    const flights = MOCK_FLIGHTS.map(f => ({
      ...f,
      departure: { ...f.departure, date: departure },
      arrival:   { ...f.arrival,   date: departure }
    }));
    return res.json({ flights, demo: true });
  }

  try {
    const params = {
      originLocationCode:      origin.toUpperCase(),
      destinationLocationCode: destination.toUpperCase(),
      departureDate:           departure,
      adults:                  parseInt(adults),
      travelClass:             travelClass.toUpperCase(),
      max:                     20
    };
    if (returnDate) params.returnDate = returnDate;

    const response = await amadeus.shopping.flightOffersSearch.get(params);
    const flights  = parseAmadeusFlights(response.data || [], { class: travelClass });
    res.json({ flights, demo: false });
  } catch (err) {
    console.error('Flight search error:', err.description || err.message);
    res.json({ flights: [], error: 'Flight search unavailable. Please try again.', demo: false });
  }
});

// Hotel search
app.get('/api/hotels', async (req, res) => {
  const { city, checkin, checkout, adults = 2 } = req.query;
  if (!city) return res.json({ hotels: [], error: 'Missing city parameter' });

  if (DEMO_MODE) {
    const nights = checkin && checkout
      ? Math.max(1, (new Date(checkout) - new Date(checkin)) / 86400000)
      : 2;
    const hotels = MOCK_HOTELS.map(h => ({ ...h, nights, totalPrice: h.pricePerNight * nights }));
    return res.json({ hotels, demo: true });
  }

  try {
    // Step 1: Get hotel IDs by city
    const cityCode = city.toUpperCase().slice(0, 3);
    const hotelList = await amadeus.referenceData.locations.hotels.byCity.get({ cityCode });
    const hotelIds  = (hotelList.data || []).slice(0, 20).map(h => h.hotelId);

    if (!hotelIds.length) return res.json({ hotels: [], demo: false });

    // Step 2: Get offers for those hotels
    const offerParams = { hotelIds: hotelIds.join(','), adults: parseInt(adults) };
    if (checkin)  offerParams.checkInDate  = checkin;
    if (checkout) offerParams.checkOutDate = checkout;

    const offersResp = await amadeus.shopping.hotelOffersSearch.get(offerParams);
    const nights = checkin && checkout
      ? Math.max(1, (new Date(checkout) - new Date(checkin)) / 86400000)
      : 1;
    const hotels = parseAmadeusHotels(offersResp.data || []).map(h => ({ ...h, nights, totalPrice: h.pricePerNight ? h.pricePerNight * nights : null }));
    res.json({ hotels, demo: false });
  } catch (err) {
    console.error('Hotel search error:', err.description || err.message);
    res.json({ hotels: [], error: 'Hotel search unavailable. Please try again.', demo: false });
  }
});

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Voyage Travel Dashboard running on port ${PORT}`);
  console.log(`   Mode: ${DEMO_MODE ? '⚡ DEMO (no Amadeus key)' : '✅ LIVE (Amadeus connected)'}`);
});
