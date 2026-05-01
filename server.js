require("dotenv").config();
'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Auth Config ──────────────────────────────────────────────────────────────
const AUTH_USER = process.env.AUTH_USER || 'gh';
const AUTH_PASS_HASH = process.env.AUTH_PASS || '';
// Guest access credential (separate revocable login for shared access)
const GUEST_USER = process.env.GUEST_USER || 'guest';
const GUEST_PASS = process.env.GUEST_PASS || 'Voyage2026!';
const SESSION_SECRET = process.env.SESSION_SECRET || 'voyage-secret-2026-vip';

const app = express();
app.set('trust proxy', 1); // Required for Render reverse proxy — enables correct HTTPS detection
const PORT = process.env.PORT || 3030;
const DEMO_MODE = !process.env.AMADEUS_CLIENT_ID;

// ─── Security & Middleware ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors({ origin: false }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path === '/health') return next();
  if (req.path === '/login.html' || req.path.startsWith('/auth/')) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login.html');
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(401).json({ error: 'Invalid credentials' });
  const user = username.toLowerCase().trim();
  // Main credential (supports plain text or SHA256 hash)
  if (user === AUTH_USER.toLowerCase()) {
    const passOk = (password === AUTH_PASS_HASH) ||
      (crypto.createHash('sha256').update(password).digest('hex') === AUTH_PASS_HASH);
    if (passOk) {
      req.session.authenticated = true;
      return res.json({ ok: true });
    }
  }
  // Guest credential (revocable shared access)
  if (user === GUEST_USER.toLowerCase() && password === GUEST_PASS) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// Public routes — no auth required
app.use((req, res, next) => {
  if (req.path === '/login.html' || req.path === '/api/airports' || req.path.startsWith('/auth/')) return next();
  return requireAuth(req, res, next);
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
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
  AA: { name: 'American Airlines',  website: 'aa.com' },
  DL: { name: 'Delta Air Lines',    website: 'delta.com' },
  UA: { name: 'United Airlines',    website: 'united.com' },
  B6: { name: 'JetBlue Airways',    website: 'jetblue.com' },
  WN: { name: 'Southwest Airlines', website: 'southwest.com' },
  AS: { name: 'Alaska Airlines',    website: 'alaskaair.com' },
  F9: { name: 'Frontier Airlines',  website: 'flyfrontier.com' },
  NK: { name: 'Spirit Airlines',    website: 'spirit.com' },
  LH: { name: 'Lufthansa',          website: 'lufthansa.com' },
  BA: { name: 'British Airways',    website: 'britishairways.com' },
  AF: { name: 'Air France',         website: 'airfrance.com' },
  EK: { name: 'Emirates',           website: 'emirates.com' },
  QR: { name: 'Qatar Airways',      website: 'qatarairways.com' },
  SQ: { name: 'Singapore Airlines', website: 'singaporeair.com' },
  NH: { name: 'ANA',                website: 'ana.co.jp' }
};

// ─── Extended Mock Flights (15+, multi-route) ─────────────────────────────────
const MOCK_FLIGHTS = [
  // JFK → LAX
  {
    id: 'f1', route: 'JFK-LAX',
    airline: { code: 'DL', name: 'Delta Air Lines', website: 'delta.com', logo: 'https://logo.clearbit.com/delta.com' },
    flightNumber: 'DL302',
    departure: { iata: 'JFK', time: '06:00', date: '' },
    arrival:   { iata: 'LAX', time: '09:30', date: '' },
    duration: '5h 30m', stops: 0, stopAirports: [],
    price: 347, currency: 'USD', class: 'ECONOMY', seatsLeft: 4,
    baggage: 'Carry-on included. Checked bag $30.',
    amenities: ['Power outlets', 'In-flight entertainment', 'Wi-Fi available'],
    co2: '142 kg CO₂ per passenger', priceHistory: 'typical'
  },
  {
    id: 'f2', route: 'JFK-LAX',
    airline: { code: 'AA', name: 'American Airlines', website: 'aa.com', logo: 'https://logo.clearbit.com/aa.com' },
    flightNumber: 'AA102',
    departure: { iata: 'JFK', time: '08:00', date: '' },
    arrival:   { iata: 'LAX', time: '11:45', date: '' },
    duration: '5h 45m', stops: 0, stopAirports: [],
    price: 298, currency: 'USD', class: 'ECONOMY', seatsLeft: 7,
    baggage: 'Carry-on included. Checked bag $35.',
    amenities: ['Power outlets', 'In-flight entertainment'],
    co2: '148 kg CO₂ per passenger', priceHistory: 'lower'
  },
  {
    id: 'f3', route: 'JFK-LAX',
    airline: { code: 'UA', name: 'United Airlines', website: 'united.com', logo: 'https://logo.clearbit.com/united.com' },
    flightNumber: 'UA175',
    departure: { iata: 'JFK', time: '10:00', date: '' },
    arrival:   { iata: 'LAX', time: '13:55', date: '' },
    duration: '5h 55m', stops: 1, stopAirports: ['ORD'],
    price: 219, currency: 'USD', class: 'ECONOMY', seatsLeft: 12,
    baggage: 'Carry-on included. Checked bag $35.',
    amenities: ['Power outlets'],
    co2: '162 kg CO₂ per passenger', priceHistory: 'lower'
  },
  {
    id: 'f4', route: 'JFK-LAX',
    airline: { code: 'B6', name: 'JetBlue Airways', website: 'jetblue.com', logo: 'https://logo.clearbit.com/jetblue.com' },
    flightNumber: 'B6623',
    departure: { iata: 'JFK', time: '12:00', date: '' },
    arrival:   { iata: 'LAX', time: '15:45', date: '' },
    duration: '5h 45m', stops: 0, stopAirports: [],
    price: 389, currency: 'USD', class: 'ECONOMY', seatsLeft: 3,
    baggage: 'First bag free. Carry-on included.',
    amenities: ['Free Wi-Fi', 'Power outlets', 'In-flight entertainment', 'Snacks'],
    co2: '148 kg CO₂ per passenger', priceHistory: 'typical'
  },
  {
    id: 'f5', route: 'JFK-LAX',
    airline: { code: 'DL', name: 'Delta Air Lines', website: 'delta.com', logo: 'https://logo.clearbit.com/delta.com' },
    flightNumber: 'DL1968',
    departure: { iata: 'JFK', time: '18:00', date: '' },
    arrival:   { iata: 'LAX', time: '21:30', date: '' },
    duration: '5h 30m', stops: 0, stopAirports: [],
    price: 447, currency: 'USD', class: 'PREMIUM_ECONOMY', seatsLeft: 2,
    baggage: '2 checked bags included.',
    amenities: ['Premium seat', 'Power outlets', 'In-flight entertainment', 'Meal service'],
    co2: '142 kg CO₂ per passenger', priceHistory: 'higher'
  },
  {
    id: 'f6', route: 'JFK-LAX',
    airline: { code: 'AA', name: 'American Airlines', website: 'aa.com', logo: 'https://logo.clearbit.com/aa.com' },
    flightNumber: 'AA268',
    departure: { iata: 'JFK', time: '21:00', date: '' },
    arrival:   { iata: 'LAX', time: '00:35', date: '+1' },
    duration: '5h 35m', stops: 0, stopAirports: [],
    price: 899, currency: 'USD', class: 'BUSINESS', seatsLeft: 5,
    baggage: '3 checked bags included. Priority boarding.',
    amenities: ['Lie-flat seat', 'Premium meal', 'Lounge access', 'Wi-Fi', 'Amenity kit'],
    co2: '148 kg CO₂ per passenger', priceHistory: 'higher'
  },
  // JFK → MIA
  {
    id: 'f7', route: 'JFK-MIA',
    airline: { code: 'AA', name: 'American Airlines', website: 'aa.com', logo: 'https://logo.clearbit.com/aa.com' },
    flightNumber: 'AA1623',
    departure: { iata: 'JFK', time: '07:15', date: '' },
    arrival:   { iata: 'MIA', time: '10:42', date: '' },
    duration: '3h 27m', stops: 0, stopAirports: [],
    price: 189, currency: 'USD', class: 'ECONOMY', seatsLeft: 9,
    baggage: 'Carry-on included. Checked bag $30.',
    amenities: ['Power outlets', 'In-flight entertainment'],
    co2: '89 kg CO₂ per passenger', priceHistory: 'lower'
  },
  {
    id: 'f8', route: 'JFK-MIA',
    airline: { code: 'DL', name: 'Delta Air Lines', website: 'delta.com', logo: 'https://logo.clearbit.com/delta.com' },
    flightNumber: 'DL2412',
    departure: { iata: 'JFK', time: '11:30', date: '' },
    arrival:   { iata: 'MIA', time: '14:55', date: '' },
    duration: '3h 25m', stops: 0, stopAirports: [],
    price: 224, currency: 'USD', class: 'ECONOMY', seatsLeft: 14,
    baggage: 'Carry-on included. Checked bag $30.',
    amenities: ['Power outlets', 'In-flight entertainment', 'Wi-Fi available'],
    co2: '86 kg CO₂ per passenger', priceHistory: 'typical'
  },
  {
    id: 'f9', route: 'JFK-MIA',
    airline: { code: 'B6', name: 'JetBlue Airways', website: 'jetblue.com', logo: 'https://logo.clearbit.com/jetblue.com' },
    flightNumber: 'B6817',
    departure: { iata: 'JFK', time: '15:20', date: '' },
    arrival:   { iata: 'MIA', time: '18:44', date: '' },
    duration: '3h 24m', stops: 0, stopAirports: [],
    price: 167, currency: 'USD', class: 'ECONOMY', seatsLeft: 6,
    baggage: 'First bag free. Carry-on included.',
    amenities: ['Free Wi-Fi', 'Power outlets', 'Snacks', 'Live TV'],
    co2: '85 kg CO₂ per passenger', priceHistory: 'lower'
  },
  // JFK → CDG (Paris)
  {
    id: 'f10', route: 'JFK-CDG',
    airline: { code: 'AF', name: 'Air France', website: 'airfrance.com', logo: 'https://logo.clearbit.com/airfrance.com' },
    flightNumber: 'AF007',
    departure: { iata: 'JFK', time: '18:30', date: '' },
    arrival:   { iata: 'CDG', time: '08:05', date: '+1' },
    duration: '7h 35m', stops: 0, stopAirports: [],
    price: 689, currency: 'USD', class: 'ECONOMY', seatsLeft: 8,
    baggage: 'Carry-on included. 1 checked bag included.',
    amenities: ['Meal service', 'Power outlets', 'In-flight entertainment', 'Wi-Fi available'],
    co2: '320 kg CO₂ per passenger', priceHistory: 'typical'
  },
  {
    id: 'f11', route: 'JFK-CDG',
    airline: { code: 'DL', name: 'Delta Air Lines', website: 'delta.com', logo: 'https://logo.clearbit.com/delta.com' },
    flightNumber: 'DL405',
    departure: { iata: 'JFK', time: '22:00', date: '' },
    arrival:   { iata: 'CDG', time: '11:45', date: '+1' },
    duration: '7h 45m', stops: 0, stopAirports: [],
    price: 614, currency: 'USD', class: 'ECONOMY', seatsLeft: 11,
    baggage: 'Carry-on included. Checked bag $35.',
    amenities: ['Meal service', 'Power outlets', 'In-flight entertainment'],
    co2: '325 kg CO₂ per passenger', priceHistory: 'lower'
  },
  {
    id: 'f12', route: 'JFK-CDG',
    airline: { code: 'AF', name: 'Air France', website: 'airfrance.com', logo: 'https://logo.clearbit.com/airfrance.com' },
    flightNumber: 'AF009',
    departure: { iata: 'JFK', time: '23:00', date: '' },
    arrival:   { iata: 'CDG', time: '12:50', date: '+1' },
    duration: '7h 50m', stops: 0, stopAirports: [],
    price: 1890, currency: 'USD', class: 'BUSINESS', seatsLeft: 3,
    baggage: '3 checked bags included. Priority boarding.',
    amenities: ['Lie-flat seat', 'Premium meal', 'Lounge access', 'Wi-Fi', 'Champagne service'],
    co2: '310 kg CO₂ per passenger', priceHistory: 'higher'
  },
  // LAX → NRT (Tokyo)
  {
    id: 'f13', route: 'LAX-NRT',
    airline: { code: 'NH', name: 'ANA', website: 'ana.co.jp', logo: 'https://logo.clearbit.com/ana.co.jp' },
    flightNumber: 'NH106',
    departure: { iata: 'LAX', time: '11:35', date: '' },
    arrival:   { iata: 'NRT', time: '16:30', date: '+1' },
    duration: '11h 55m', stops: 0, stopAirports: [],
    price: 834, currency: 'USD', class: 'ECONOMY', seatsLeft: 16,
    baggage: '2 checked bags included.',
    amenities: ['Meal service', 'Power outlets', 'In-flight entertainment', 'Wi-Fi available'],
    co2: '512 kg CO₂ per passenger', priceHistory: 'typical'
  },
  {
    id: 'f14', route: 'LAX-NRT',
    airline: { code: 'UA', name: 'United Airlines', website: 'united.com', logo: 'https://logo.clearbit.com/united.com' },
    flightNumber: 'UA837',
    departure: { iata: 'LAX', time: '13:00', date: '' },
    arrival:   { iata: 'NRT', time: '17:55', date: '+1' },
    duration: '12h 55m', stops: 0, stopAirports: [],
    price: 769, currency: 'USD', class: 'ECONOMY', seatsLeft: 5,
    baggage: '1 checked bag included. 2nd bag $100.',
    amenities: ['Meal service', 'Power outlets', 'In-flight entertainment'],
    co2: '540 kg CO₂ per passenger', priceHistory: 'lower'
  },
  // JFK → DXB (Dubai)
  {
    id: 'f15', route: 'JFK-DXB',
    airline: { code: 'EK', name: 'Emirates', website: 'emirates.com', logo: 'https://logo.clearbit.com/emirates.com' },
    flightNumber: 'EK202',
    departure: { iata: 'JFK', time: '21:00', date: '' },
    arrival:   { iata: 'DXB', time: '19:00', date: '+1' },
    duration: '13h 45m', stops: 0, stopAirports: [],
    price: 978, currency: 'USD', class: 'ECONOMY', seatsLeft: 22,
    baggage: '2 checked bags included.',
    amenities: ['Meal service', 'Power outlets', 'Ice entertainment system', 'Wi-Fi available'],
    co2: '698 kg CO₂ per passenger', priceHistory: 'typical'
  },
  {
    id: 'f16', route: 'JFK-DXB',
    airline: { code: 'QR', name: 'Qatar Airways', website: 'qatarairways.com', logo: 'https://logo.clearbit.com/qatarairways.com' },
    flightNumber: 'QR701',
    departure: { iata: 'JFK', time: '22:30', date: '' },
    arrival:   { iata: 'DXB', time: '20:15', date: '+1' },
    duration: '14h 45m', stops: 1, stopAirports: ['DOH'],
    price: 812, currency: 'USD', class: 'ECONOMY', seatsLeft: 9,
    baggage: '2 checked bags included.',
    amenities: ['Meal service', 'Power outlets', 'Oryx One entertainment', 'Wi-Fi'],
    co2: '710 kg CO₂ per passenger', priceHistory: 'lower'
  }
];

// ─── Extended Mock Hotels (15+, multi-city) ───────────────────────────────────
const MOCK_HOTELS = [
  // NYC
  {
    id: 'h1', city: 'NYC',
    name: 'The Peninsula New York',
    stars: 5, rating: 9.5, ratingLabel: 'Exceptional',
    location: '700 5th Ave, Midtown Manhattan',
    amenities: ['Spa', 'Pool', 'Restaurant', 'Gym', 'Wi-Fi', 'Concierge'],
    pricePerNight: 595, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600&q=80',
    brand: null
  },
  {
    id: 'h2', city: 'NYC',
    name: 'Kimpton Hotel Eventi',
    stars: 4, rating: 9.1, ratingLabel: 'Excellent',
    location: '851 Avenue of the Americas, Chelsea',
    amenities: ['Restaurant', 'Gym', 'Wi-Fi', 'Bar', 'Business Center'],
    pricePerNight: 289, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600&q=80',
    brand: null
  },
  {
    id: 'h3', city: 'NYC',
    name: 'The Plaza Hotel',
    stars: 5, rating: 9.3, ratingLabel: 'Exceptional',
    location: 'Fifth Avenue at Central Park South',
    amenities: ['Spa', 'Restaurant', 'Gym', 'Wi-Fi', 'Concierge', 'Valet'],
    pricePerNight: 750, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=600&q=80',
    brand: null
  },
  {
    id: 'h4', city: 'NYC',
    name: 'Arlo SoHo',
    stars: 3, rating: 8.7, ratingLabel: 'Excellent',
    location: '231 Hudson St, SoHo',
    amenities: ['Rooftop Bar', 'Wi-Fi', 'Restaurant', 'Gym'],
    pricePerNight: 199, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=600&q=80',
    brand: null
  },
  {
    id: 'h5', city: 'NYC',
    name: 'Park Hyatt New York',
    stars: 5, rating: 9.6, ratingLabel: 'Exceptional',
    location: '153 W 57th St, Midtown',
    amenities: ['Spa', 'Pool', 'Restaurant', 'Gym', 'Wi-Fi', 'Butler Service'],
    pricePerNight: 895, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80',
    brand: 'Hyatt'
  },
  {
    id: 'h6', city: 'NYC',
    name: 'citizenM New York Times Square',
    stars: 4, rating: 8.9, ratingLabel: 'Excellent',
    location: '218 W 50th St, Times Square',
    amenities: ['Rooftop Bar', 'Wi-Fi', 'Gym', 'Restaurant'],
    pricePerNight: 249, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1549294413-26f195200c16?w=600&q=80',
    brand: null
  },
  // Los Angeles
  {
    id: 'h7', city: 'LAX',
    name: 'Hotel Bel-Air',
    stars: 5, rating: 9.7, ratingLabel: 'Exceptional',
    location: '701 Stone Canyon Rd, Bel-Air',
    amenities: ['Spa', 'Pool', 'Restaurant', 'Gym', 'Wi-Fi', 'Concierge'],
    pricePerNight: 1100, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600&q=80',
    brand: null
  },
  {
    id: 'h8', city: 'LAX',
    name: 'The LINE LA',
    stars: 4, rating: 8.8, ratingLabel: 'Excellent',
    location: '3515 Wilshire Blvd, Koreatown',
    amenities: ['Pool', 'Restaurant', 'Bar', 'Wi-Fi', 'Gym'],
    pricePerNight: 259, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=600&q=80',
    brand: null
  },
  {
    id: 'h9', city: 'LAX',
    name: 'Andaz West Hollywood',
    stars: 4, rating: 9.0, ratingLabel: 'Excellent',
    location: '8401 Sunset Blvd, West Hollywood',
    amenities: ['Rooftop Pool', 'Restaurant', 'Bar', 'Wi-Fi', 'Gym', 'Valet'],
    pricePerNight: 349, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=80',
    brand: 'Hyatt'
  },
  // Miami
  {
    id: 'h10', city: 'MIA',
    name: 'Faena Hotel Miami Beach',
    stars: 5, rating: 9.4, ratingLabel: 'Exceptional',
    location: '3201 Collins Ave, Miami Beach',
    amenities: ['Spa', 'Pool', 'Beach', 'Restaurant', 'Wi-Fi', 'Gym'],
    pricePerNight: 689, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80',
    brand: null
  },
  {
    id: 'h11', city: 'MIA',
    name: 'The Standard Spa Miami Beach',
    stars: 4, rating: 8.9, ratingLabel: 'Excellent',
    location: '40 Island Ave, Belle Isle',
    amenities: ['Spa', 'Pool', 'Restaurant', 'Wi-Fi', 'Gym', 'Beach Access'],
    pricePerNight: 299, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600&q=80',
    brand: null
  },
  {
    id: 'h12', city: 'MIA',
    name: 'Kimpton EPIC Hotel Miami',
    stars: 4, rating: 9.2, ratingLabel: 'Excellent',
    location: '270 Biscayne Blvd Way, Downtown Miami',
    amenities: ['Rooftop Pool', 'Restaurant', 'Bar', 'Wi-Fi', 'Gym', 'Marina Views'],
    pricePerNight: 319, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=600&q=80',
    brand: null
  },
  // Paris
  {
    id: 'h13', city: 'CDG',
    name: 'Hôtel Le Meurice',
    stars: 5, rating: 9.6, ratingLabel: 'Exceptional',
    location: '228 Rue de Rivoli, 1st Arrondissement',
    amenities: ['Spa', 'Restaurant', 'Gym', 'Wi-Fi', 'Concierge', 'Butler'],
    pricePerNight: 980, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600&q=80',
    brand: null
  },
  {
    id: 'h14', city: 'CDG',
    name: 'Hôtel des Grands Boulevards',
    stars: 4, rating: 9.0, ratingLabel: 'Excellent',
    location: '17 Boulevard Poissonnière, 2nd Arrondissement',
    amenities: ['Restaurant', 'Bar', 'Wi-Fi', 'Gym', 'Rooftop Terrace'],
    pricePerNight: 345, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=600&q=80',
    brand: null
  },
  // Tokyo
  {
    id: 'h15', city: 'NRT',
    name: 'Park Hyatt Tokyo',
    stars: 5, rating: 9.5, ratingLabel: 'Exceptional',
    location: '3-7-1-2 Nishi-Shinjuku, Shinjuku',
    amenities: ['Pool', 'Spa', 'Restaurant', 'Gym', 'Wi-Fi', 'City Views'],
    pricePerNight: 820, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600&q=80',
    brand: 'Hyatt'
  },
  {
    id: 'h16', city: 'NRT',
    name: 'Andaz Tokyo Toranomon Hills',
    stars: 5, rating: 9.3, ratingLabel: 'Exceptional',
    location: '1-23-4 Toranomon, Minato',
    amenities: ['Restaurant', 'Bar', 'Gym', 'Wi-Fi', 'Concierge', 'Sky Lounge'],
    pricePerNight: 590, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80',
    brand: 'Hyatt'
  },
  // Dubai
  {
    id: 'h17', city: 'DXB',
    name: 'Burj Al Arab Jumeirah',
    stars: 5, rating: 9.8, ratingLabel: 'Exceptional',
    location: 'Jumeirah St, Jumeirah Beach',
    amenities: ['Private Beach', 'Spa', 'Pool', 'Restaurant', 'Helipad', 'Butler'],
    pricePerNight: 2200, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=600&q=80',
    brand: null
  },
  {
    id: 'h18', city: 'DXB',
    name: 'Atlantis The Palm',
    stars: 5, rating: 9.1, ratingLabel: 'Exceptional',
    location: 'Crescent Rd, Palm Jumeirah',
    amenities: ['Waterpark', 'Private Beach', 'Pool', 'Spa', 'Restaurants', 'Wi-Fi'],
    pricePerNight: 650, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1549294413-26f195200c16?w=600&q=80',
    brand: null
  }
];

// ─── Mock Car Rentals ─────────────────────────────────────────────────────────
const MOCK_CARS = [
  {
    id: 'c1', type: 'Economy', name: 'Toyota Corolla or similar', emoji: '🚗',
    provider: 'Enterprise', providerColor: '#006747', pricePerDay: 45,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation'],
    seats: 5, doors: 4, transmission: 'Automatic', mpg: 32, rating: 8.7, reviews: 1243,
    cardColor: '#e5e7eb', description: 'Perfect for solo travelers or couples. Great fuel economy.'
  },
  {
    id: 'c2', type: 'Economy', name: 'Hyundai Elantra or similar', emoji: '🚙',
    provider: 'Budget', providerColor: '#e84c1e', pricePerDay: 38,
    features: ['AC', 'Unlimited Miles', 'Free Cancellation'],
    seats: 5, doors: 4, transmission: 'Automatic', mpg: 35, rating: 8.4, reviews: 892,
    cardColor: '#dbeafe', description: 'Best value economy. Outstanding fuel efficiency.'
  },
  {
    id: 'c3', type: 'Compact', name: 'Honda Civic or similar', emoji: '🚗',
    provider: 'Hertz', providerColor: '#ffcc00', pricePerDay: 58,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation'],
    seats: 5, doors: 4, transmission: 'Automatic', mpg: 30, rating: 8.9, reviews: 2156,
    cardColor: '#dcfce7', description: 'Sporty compact with excellent handling and comfort.'
  },
  {
    id: 'c4', type: 'Compact', name: 'Chevrolet Malibu or similar', emoji: '🚗',
    provider: 'Avis', providerColor: '#cc0001', pricePerDay: 62,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation', 'Bluetooth'],
    seats: 5, doors: 4, transmission: 'Automatic', mpg: 29, rating: 8.6, reviews: 1547,
    cardColor: '#fef3c7', description: 'Comfortable mid-size with spacious interior.'
  },
  {
    id: 'c5', type: 'SUV', name: 'Toyota RAV4 or similar', emoji: '🚙',
    provider: 'National', providerColor: '#009639', pricePerDay: 89,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation', 'AWD'],
    seats: 5, doors: 4, transmission: 'Automatic', mpg: 26, rating: 9.1, reviews: 3421,
    cardColor: '#ede9fe', description: 'Popular family SUV with AWD and ample cargo space.'
  },
  {
    id: 'c6', type: 'SUV', name: 'Ford Explorer or similar', emoji: '🛻',
    provider: 'Enterprise', providerColor: '#006747', pricePerDay: 105,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation', '3rd Row Seating'],
    seats: 7, doors: 4, transmission: 'Automatic', mpg: 22, rating: 9.0, reviews: 2876,
    cardColor: '#fce7f3', description: 'Full-size SUV perfect for family road trips with 7 seats.'
  },
  {
    id: 'c7', type: 'Luxury', name: 'BMW 5 Series or similar', emoji: '🚘',
    provider: 'Hertz', providerColor: '#ffcc00', pricePerDay: 189,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation', 'Premium Sound', 'Heated Seats'],
    seats: 5, doors: 4, transmission: 'Automatic', mpg: 27, rating: 9.4, reviews: 876,
    cardColor: '#f0f4ff', description: 'Premium German engineering. Arrive in style.'
  },
  {
    id: 'c8', type: 'Luxury', name: 'Mercedes-Benz E-Class or similar', emoji: '🚘',
    provider: 'Avis', providerColor: '#cc0001', pricePerDay: 219,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation', 'Heated Seats', 'Premium Sound', 'Sunroof'],
    seats: 5, doors: 4, transmission: 'Automatic', mpg: 25, rating: 9.6, reviews: 654,
    cardColor: '#1a1a2e', textDark: false, description: 'The pinnacle of automotive luxury and refinement.'
  },
  {
    id: 'c9', type: 'Minivan', name: 'Chrysler Pacifica or similar', emoji: '🚐',
    provider: 'Budget', providerColor: '#e84c1e', pricePerDay: 99,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation', '7 Seats', 'Stow N Go'],
    seats: 7, doors: 4, transmission: 'Automatic', mpg: 22, rating: 8.8, reviews: 1234,
    cardColor: '#ecfdf5', description: 'Ideal for large families. Folds flat for extra cargo.'
  },
  {
    id: 'c10', type: 'Compact', name: 'Nissan Altima or similar', emoji: '🚗',
    provider: 'National', providerColor: '#009639', pricePerDay: 55,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation', 'Backup Camera'],
    seats: 5, doors: 4, transmission: 'Automatic', mpg: 31, rating: 8.5, reviews: 987,
    cardColor: '#fff7ed', description: 'Reliable and comfortable for business or leisure.'
  },
  {
    id: 'c11', type: 'Electric', name: 'Tesla Model 3 or similar', emoji: '⚡',
    provider: 'Enterprise', providerColor: '#006747', pricePerDay: 145,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation', 'Autopilot', 'Supercharger'],
    seats: 5, doors: 4, transmission: 'Automatic', mpg: null, range: '358 mi', rating: 9.7, reviews: 432,
    cardColor: '#d1fae5', description: 'Zero emissions, cutting-edge tech. The future of driving.'
  },
  {
    id: 'c12', type: 'Luxury', name: 'Cadillac Escalade or similar', emoji: '🚗',
    provider: 'Hertz', providerColor: '#ffcc00', pricePerDay: 285,
    features: ['AC', 'GPS', 'Unlimited Miles', 'Free Cancellation', 'Heated Seats', '4WD', 'Premium Audio'],
    seats: 7, doors: 4, transmission: 'Automatic', mpg: 16, rating: 9.3, reviews: 321,
    cardColor: '#fdf2f8', description: 'Commanding presence and first-class luxury for VIP travel.'
  }
];

// ─── Mock Bundles ─────────────────────────────────────────────────────────────
function buildMockBundles() {
  const combos = [
    { flight: MOCK_FLIGHTS[1], hotel: MOCK_HOTELS[0], nights: 3 },   // AA JFK-LAX + Peninsula NYC
    { flight: MOCK_FLIGHTS[0], hotel: MOCK_HOTELS[1], nights: 4 },   // DL JFK-LAX + Kimpton
    { flight: MOCK_FLIGHTS[6], hotel: MOCK_HOTELS[9], nights: 5 },   // AA JFK-MIA + Faena
    { flight: MOCK_FLIGHTS[7], hotel: MOCK_HOTELS[10], nights: 3 },  // DL JFK-MIA + Standard Spa
    { flight: MOCK_FLIGHTS[9], hotel: MOCK_HOTELS[12], nights: 6 },  // AF JFK-CDG + Le Meurice
    { flight: MOCK_FLIGHTS[10], hotel: MOCK_HOTELS[13], nights: 5 }, // DL JFK-CDG + Grands Boulevards
    { flight: MOCK_FLIGHTS[12], hotel: MOCK_HOTELS[14], nights: 7 }, // ANA LAX-NRT + Park Hyatt Tokyo
    { flight: MOCK_FLIGHTS[14], hotel: MOCK_HOTELS[16], nights: 4 }  // EK JFK-DXB + Burj Al Arab
  ];

  return combos.map((c, i) => {
    const flightPrice  = c.flight.price;
    const hotelTotal   = c.hotel.pricePerNight * c.nights;
    const individualTotal = flightPrice + hotelTotal;
    const discountPct  = 0.12 + (i % 3) * 0.04; // 12–20% off
    const bundlePrice  = Math.round(individualTotal * (1 - discountPct));
    const savings      = individualTotal - bundlePrice;

    return {
      id: `bundle-${i + 1}`,
      flight: c.flight,
      hotel:  c.hotel,
      nights: c.nights,
      flightPrice,
      hotelPricePerNight: c.hotel.pricePerNight,
      hotelTotal,
      individualTotal,
      bundlePrice,
      savings,
      currency: 'USD',
      rating: c.hotel.rating,
      ratingLabel: c.hotel.ratingLabel
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseAmadeusFlights(offers, searchParams) {
  return offers.map((offer, idx) => {
    const itinerary   = offer.itineraries[0];
    const segment     = itinerary.segments[0];
    const lastSeg     = itinerary.segments[itinerary.segments.length - 1];
    const airlineCode = segment.carrierCode;
    const airlineInfo = AIRLINE_MAP[airlineCode] || { name: airlineCode, website: `${airlineCode.toLowerCase()}.com` };

    const depTime = segment.departure.at.split('T')[1].slice(0, 5);
    const arrTime = lastSeg.arrival.at.split('T')[1].slice(0, 5);
    const depDate = segment.departure.at.split('T')[0];
    const arrDate = lastSeg.arrival.at.split('T')[0];
    const stops   = itinerary.segments.length - 1;
    const stopAirports = itinerary.segments.slice(0, -1).map(s => s.arrival.iataCode);

    const durationRaw = itinerary.duration || 'PT0H0M';
    const durMatch    = durationRaw.match(/PT(\d+H)?(\d+M)?/);
    const hours       = durMatch && durMatch[1] ? parseInt(durMatch[1]) : 0;
    const minutes     = durMatch && durMatch[2] ? parseInt(durMatch[2]) : 0;
    const duration    = `${hours}h ${minutes}m`;

    const price       = parseFloat(offer.price.total);
    const travelClass = offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || searchParams.class || 'ECONOMY';

    return {
      id: offer.id || `flight-${idx}`,
      airline: { code: airlineCode, name: airlineInfo.name, website: airlineInfo.website, logo: `https://logo.clearbit.com/${airlineInfo.website}` },
      flightNumber: `${airlineCode}${segment.number}`,
      departure: { iata: segment.departure.iataCode, time: depTime, date: depDate },
      arrival:   { iata: lastSeg.arrival.iataCode, time: arrTime, date: arrDate },
      duration, stops, stopAirports, price, currency: offer.price.currency || 'USD',
      class: travelClass, seatsLeft: offer.numberOfBookableSeats || null,
      baggage: 'See airline for baggage policy.', amenities: [], co2: null, priceHistory: 'typical'
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
      stars: h.hotel?.rating || 3, rating: null, ratingLabel: null,
      location: h.hotel?.address?.lines?.join(', ') || h.hotel?.cityCode || '',
      amenities: h.hotel?.amenities?.slice(0, 6) || ['Wi-Fi'],
      pricePerNight: price, currency: offer?.price?.currency || 'USD',
      image: images[idx % images.length], brand: null, city: h.hotel?.cityCode || ''
    };
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', demo: DEMO_MODE, ts: new Date().toISOString() });
});

// Airport autocomplete
app.get('/api/airports', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  if (DEMO_MODE) {
    const DEMO_AIRPORTS = [
      // ── Metro area groups (show first when searching city name) ──────────
      { iata: 'NYC', name: 'New York - All Airports (JFK, LGA, EWR)', city: 'New York', country: 'US', metro: true },
      { iata: 'LAX-ALL', name: 'Los Angeles - All Airports (LAX, BUR, LGB)', city: 'Los Angeles', country: 'US', metro: true },
      { iata: 'CHI', name: 'Chicago - All Airports (ORD, MDW)', city: 'Chicago', country: 'US', metro: true },
      { iata: 'WAS', name: 'Washington DC - All Airports (DCA, IAD, BWI)', city: 'Washington DC', country: 'US', metro: true },
      { iata: 'MIA-ALL', name: 'Miami Area - All Airports (MIA, FLL)', city: 'Miami', country: 'US', metro: true },
      { iata: 'SFB', name: 'San Francisco Bay Area - All Airports (SFO, OAK, SJC)', city: 'San Francisco', country: 'US', metro: true },
      { iata: 'LON', name: 'London - All Airports (LHR, LGW, STN, LCY)', city: 'London', country: 'GB', metro: true },
      { iata: 'PAR', name: 'Paris - All Airports (CDG, ORY)', city: 'Paris', country: 'FR', metro: true },
      { iata: 'TYO', name: 'Tokyo - All Airports (NRT, HND)', city: 'Tokyo', country: 'JP', metro: true },
      { iata: 'ROM', name: 'Rome - All Airports (FCO, CIA)', city: 'Rome', country: 'IT', metro: true },
      // ── Individual airports ───────────────────────────────────────────────
      { iata: 'JFK', name: 'John F. Kennedy International', city: 'New York', country: 'US' },
      { iata: 'LGA', name: 'LaGuardia Airport', city: 'New York', country: 'US' },
      { iata: 'EWR', name: 'Newark Liberty International', city: 'Newark / New York', country: 'US' },
      { iata: 'LAX', name: 'Los Angeles International', city: 'Los Angeles', country: 'US' },
      { iata: 'BUR', name: 'Hollywood Burbank Airport', city: 'Los Angeles', country: 'US' },
      { iata: 'ORD', name: "O'Hare International Airport", city: 'Chicago', country: 'US' },
      { iata: 'MDW', name: 'Chicago Midway International', city: 'Chicago', country: 'US' },
      { iata: 'MIA', name: 'Miami International Airport', city: 'Miami', country: 'US' },
      { iata: 'FLL', name: 'Fort Lauderdale-Hollywood International', city: 'Miami / Fort Lauderdale', country: 'US' },
      { iata: 'SFO', name: 'San Francisco International', city: 'San Francisco', country: 'US' },
      { iata: 'OAK', name: 'Oakland International Airport', city: 'San Francisco / Oakland', country: 'US' },
      { iata: 'BOS', name: 'Boston Logan International', city: 'Boston', country: 'US' },
      { iata: 'ATL', name: 'Hartsfield-Jackson Atlanta International', city: 'Atlanta', country: 'US' },
      { iata: 'DFW', name: 'Dallas/Fort Worth International', city: 'Dallas', country: 'US' },
      { iata: 'DAL', name: 'Dallas Love Field', city: 'Dallas', country: 'US' },
      { iata: 'SEA', name: 'Seattle-Tacoma International', city: 'Seattle', country: 'US' },
      { iata: 'DCA', name: 'Ronald Reagan Washington National', city: 'Washington DC', country: 'US' },
      { iata: 'IAD', name: 'Washington Dulles International', city: 'Washington DC', country: 'US' },
      { iata: 'BWI', name: 'Baltimore/Washington International', city: 'Baltimore / Washington DC', country: 'US' },
      { iata: 'IAH', name: 'George Bush Intercontinental', city: 'Houston', country: 'US' },
      { iata: 'HOU', name: 'William P. Hobby Airport', city: 'Houston', country: 'US' },
      { iata: 'PHX', name: 'Phoenix Sky Harbor International', city: 'Phoenix', country: 'US' },
      { iata: 'DEN', name: 'Denver International Airport', city: 'Denver', country: 'US' },
      { iata: 'LAS', name: 'Harry Reid International Airport', city: 'Las Vegas', country: 'US' },
      { iata: 'MCO', name: 'Orlando International Airport', city: 'Orlando', country: 'US' },
      { iata: 'MSP', name: 'Minneapolis-Saint Paul International', city: 'Minneapolis', country: 'US' },
      { iata: 'DTW', name: 'Detroit Metropolitan Wayne County', city: 'Detroit', country: 'US' },
      { iata: 'PHL', name: 'Philadelphia International Airport', city: 'Philadelphia', country: 'US' },
      { iata: 'CLT', name: 'Charlotte Douglas International', city: 'Charlotte', country: 'US' },
      { iata: 'CUN', name: 'Cancún International Airport', city: 'Cancún', country: 'MX' },
      { iata: 'LHR', name: 'London Heathrow Airport', city: 'London', country: 'GB' },
      { iata: 'LGW', name: 'London Gatwick Airport', city: 'London', country: 'GB' },
      { iata: 'CDG', name: 'Charles de Gaulle Airport', city: 'Paris', country: 'FR' },
      { iata: 'ORY', name: 'Paris Orly Airport', city: 'Paris', country: 'FR' },
      { iata: 'NRT', name: 'Tokyo Narita International', city: 'Tokyo', country: 'JP' },
      { iata: 'HND', name: 'Tokyo Haneda Airport', city: 'Tokyo', country: 'JP' },
      { iata: 'DXB', name: 'Dubai International Airport', city: 'Dubai', country: 'AE' },
      { iata: 'AUH', name: 'Abu Dhabi International Airport', city: 'Abu Dhabi', country: 'AE' },
      { iata: 'FCO', name: 'Leonardo da Vinci–Fiumicino Airport', city: 'Rome', country: 'IT' },
      { iata: 'MXP', name: 'Milan Malpensa International', city: 'Milan', country: 'IT' },
      { iata: 'BCN', name: 'Barcelona El Prat Airport', city: 'Barcelona', country: 'ES' },
      { iata: 'MAD', name: 'Adolfo Suárez Madrid–Barajas Airport', city: 'Madrid', country: 'ES' },
      { iata: 'AMS', name: 'Amsterdam Schiphol Airport', city: 'Amsterdam', country: 'NL' },
      { iata: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'DE' },
      { iata: 'MUC', name: 'Munich Airport', city: 'Munich', country: 'DE' },
      { iata: 'ZRH', name: 'Zurich Airport', city: 'Zurich', country: 'CH' },
      { iata: 'SIN', name: 'Singapore Changi Airport', city: 'Singapore', country: 'SG' },
      { iata: 'HKG', name: 'Hong Kong International Airport', city: 'Hong Kong', country: 'HK' },
      { iata: 'ICN', name: 'Incheon International Airport', city: 'Seoul', country: 'KR' },
      { iata: 'SYD', name: 'Sydney Kingsford Smith Airport', city: 'Sydney', country: 'AU' },
      { iata: 'MEL', name: 'Melbourne Airport', city: 'Melbourne', country: 'AU' },
      { iata: 'DPS', name: 'Ngurah Rai International Airport', city: 'Bali', country: 'ID' },
      { iata: 'BKK', name: 'Suvarnabhumi Airport', city: 'Bangkok', country: 'TH' },
      { iata: 'DEL', name: 'Indira Gandhi International Airport', city: 'New Delhi', country: 'IN' },
      { iata: 'BOM', name: 'Chhatrapati Shivaji Maharaj International', city: 'Mumbai', country: 'IN' },
      { iata: 'GRU', name: 'São Paulo/Guarulhos International', city: 'São Paulo', country: 'BR' },
      { iata: 'GIG', name: 'Rio de Janeiro–Galeão International', city: 'Rio de Janeiro', country: 'BR' },
      { iata: 'YYZ', name: 'Toronto Pearson International', city: 'Toronto', country: 'CA' },
      { iata: 'YVR', name: 'Vancouver International Airport', city: 'Vancouver', country: 'CA' },
      { iata: 'MEX', name: 'Mexico City International Airport', city: 'Mexico City', country: 'MX' },
      { iata: 'BOG', name: 'El Dorado International Airport', city: 'Bogotá', country: 'CO' },
      { iata: 'LIM', name: 'Jorge Chávez International Airport', city: 'Lima', country: 'PE' },
      { iata: 'EZE', name: 'Ministro Pistarini International', city: 'Buenos Aires', country: 'AR' },
      { iata: 'CAI', name: 'Cairo International Airport', city: 'Cairo', country: 'EG' },
      { iata: 'JNB', name: 'O.R. Tambo International Airport', city: 'Johannesburg', country: 'ZA' },
      { iata: 'NBO', name: 'Jomo Kenyatta International Airport', city: 'Nairobi', country: 'KE' },
      { iata: 'CPT', name: 'Cape Town International Airport', city: 'Cape Town', country: 'ZA' },
      { iata: 'DOH', name: 'Hamad International Airport', city: 'Doha', country: 'QA' },
      { iata: 'KUL', name: 'Kuala Lumpur International Airport', city: 'Kuala Lumpur', country: 'MY' },
      { iata: 'MNL', name: 'Ninoy Aquino International Airport', city: 'Manila', country: 'PH' },
      { iata: 'VIE', name: 'Vienna International Airport', city: 'Vienna', country: 'AT' },
      { iata: 'CPH', name: 'Copenhagen Airport', city: 'Copenhagen', country: 'DK' },
      { iata: 'ARN', name: 'Stockholm Arlanda Airport', city: 'Stockholm', country: 'SE' },
      { iata: 'HEL', name: 'Helsinki-Vantaa Airport', city: 'Helsinki', country: 'FI' },
      { iata: 'OSL', name: 'Oslo Gardermoen Airport', city: 'Oslo', country: 'NO' },
      { iata: 'LIS', name: 'Lisbon Humberto Delgado Airport', city: 'Lisbon', country: 'PT' },
      { iata: 'ATH', name: 'Athens Eleftherios Venizelos Airport', city: 'Athens', country: 'GR' },
      { iata: 'IST', name: 'Istanbul Airport', city: 'Istanbul', country: 'TR' },
      { iata: 'TLV', name: 'Ben Gurion International Airport', city: 'Tel Aviv', country: 'IL' },
      // ── US Regional Airports ─────────────────────────────────────────
      { iata: 'ILM', name: 'Wilmington International Airport', city: 'Wilmington', country: 'US' },
      { iata: 'RDU', name: 'Raleigh-Durham International Airport', city: 'Raleigh / Durham', country: 'US' },
      { iata: 'CLT', name: 'Charlotte Douglas International', city: 'Charlotte', country: 'US' },
      { iata: 'GSO', name: 'Piedmont Triad International Airport', city: 'Greensboro', country: 'US' },
      { iata: 'AVL', name: 'Asheville Regional Airport', city: 'Asheville', country: 'US' },
      { iata: 'CRW', name: 'Yeager Airport', city: 'Charleston', country: 'US' },
      { iata: 'CHS', name: 'Charleston International Airport', city: 'Charleston SC', country: 'US' },
      { iata: 'SAV', name: 'Savannah/Hilton Head International', city: 'Savannah', country: 'US' },
      { iata: 'JAX', name: 'Jacksonville International Airport', city: 'Jacksonville', country: 'US' },
      { iata: 'TPA', name: 'Tampa International Airport', city: 'Tampa', country: 'US' },
      { iata: 'SRQ', name: 'Sarasota Bradenton International', city: 'Sarasota', country: 'US' },
      { iata: 'RSW', name: 'Southwest Florida International Airport', city: 'Fort Myers', country: 'US' },
      { iata: 'PBI', name: 'Palm Beach International Airport', city: 'West Palm Beach', country: 'US' },
      { iata: 'PNS', name: 'Pensacola International Airport', city: 'Pensacola', country: 'US' },
      { iata: 'MOB', name: 'Mobile Regional Airport', city: 'Mobile', country: 'US' },
      { iata: 'MSY', name: 'Louis Armstrong New Orleans International', city: 'New Orleans', country: 'US' },
      { iata: 'BTR', name: 'Baton Rouge Metropolitan Airport', city: 'Baton Rouge', country: 'US' },
      { iata: 'LIT', name: 'Bill and Hillary Clinton National Airport', city: 'Little Rock', country: 'US' },
      { iata: 'MEM', name: 'Memphis International Airport', city: 'Memphis', country: 'US' },
      { iata: 'BNA', name: 'Nashville International Airport', city: 'Nashville', country: 'US' },
      { iata: 'SDF', name: 'Louisville Muhammad Ali International', city: 'Louisville', country: 'US' },
      { iata: 'CVG', name: 'Cincinnati/Northern Kentucky International', city: 'Cincinnati', country: 'US' },
      { iata: 'CMH', name: 'John Glenn Columbus International', city: 'Columbus', country: 'US' },
      { iata: 'CLE', name: 'Cleveland Hopkins International Airport', city: 'Cleveland', country: 'US' },
      { iata: 'PIT', name: 'Pittsburgh International Airport', city: 'Pittsburgh', country: 'US' },
      { iata: 'BUF', name: 'Buffalo Niagara International Airport', city: 'Buffalo', country: 'US' },
      { iata: 'ALB', name: 'Albany International Airport', city: 'Albany', country: 'US' },
      { iata: 'SYR', name: 'Syracuse Hancock International Airport', city: 'Syracuse', country: 'US' },
      { iata: 'ROC', name: 'Greater Rochester International Airport', city: 'Rochester', country: 'US' },
      { iata: 'HPN', name: 'Westchester County Airport', city: 'White Plains / New York', country: 'US' },
      { iata: 'ISP', name: 'Long Island MacArthur Airport', city: 'Long Island / New York', country: 'US' },
      { iata: 'SWF', name: 'New York Stewart International Airport', city: 'Newburgh / New York', country: 'US' },
      { iata: 'ACY', name: 'Atlantic City International Airport', city: 'Atlantic City', country: 'US' },
      { iata: 'ABE', name: 'Lehigh Valley International Airport', city: 'Allentown', country: 'US' },
      { iata: 'RIC', name: 'Richmond International Airport', city: 'Richmond', country: 'US' },
      { iata: 'ORF', name: 'Norfolk International Airport', city: 'Norfolk', country: 'US' },
      { iata: 'CHO', name: 'Charlottesville–Albemarle Airport', city: 'Charlottesville', country: 'US' },
      { iata: 'ROA', name: 'Roanoke–Blacksburg Regional Airport', city: 'Roanoke', country: 'US' },
      { iata: 'MHT', name: 'Manchester-Boston Regional Airport', city: 'Manchester', country: 'US' },
      { iata: 'PVD', name: 'T.F. Green Providence Airport', city: 'Providence', country: 'US' },
      { iata: 'PWM', name: 'Portland International Jetport', city: 'Portland ME', country: 'US' },
      { iata: 'BTV', name: 'Burlington International Airport', city: 'Burlington VT', country: 'US' },
      { iata: 'BGR', name: 'Bangor International Airport', city: 'Bangor', country: 'US' },
      { iata: 'GRR', name: 'Gerald R. Ford International Airport', city: 'Grand Rapids', country: 'US' },
      { iata: 'FNT', name: 'Bishop International Airport', city: 'Flint', country: 'US' },
      { iata: 'LAN', name: 'Capital Region International Airport', city: 'Lansing', country: 'US' },
      { iata: 'MKE', name: 'Milwaukee Mitchell International Airport', city: 'Milwaukee', country: 'US' },
      { iata: 'MSN', name: 'Dane County Regional Airport', city: 'Madison', country: 'US' },
      { iata: 'CID', name: 'Eastern Iowa Airport', city: 'Cedar Rapids', country: 'US' },
      { iata: 'DSM', name: 'Des Moines International Airport', city: 'Des Moines', country: 'US' },
      { iata: 'OMA', name: 'Eppley Airfield', city: 'Omaha', country: 'US' },
      { iata: 'ICT', name: 'Wichita Dwight D. Eisenhower National', city: 'Wichita', country: 'US' },
      { iata: 'MCI', name: 'Kansas City International Airport', city: 'Kansas City', country: 'US' },
      { iata: 'STL', name: 'St. Louis Lambert International Airport', city: 'St. Louis', country: 'US' },
      { iata: 'SPI', name: 'Abraham Lincoln Capital Airport', city: 'Springfield IL', country: 'US' },
      { iata: 'IND', name: 'Indianapolis International Airport', city: 'Indianapolis', country: 'US' },
      { iata: 'FSD', name: 'Sioux Falls Regional Airport', city: 'Sioux Falls', country: 'US' },
      { iata: 'FAR', name: 'Hector International Airport', city: 'Fargo', country: 'US' },
      { iata: 'BIS', name: 'Bismarck Municipal Airport', city: 'Bismarck', country: 'US' },
      { iata: 'GFK', name: 'Grand Forks International Airport', city: 'Grand Forks', country: 'US' },
      { iata: 'BZN', name: 'Bozeman Yellowstone International', city: 'Bozeman', country: 'US' },
      { iata: 'BIL', name: 'Billings Logan International Airport', city: 'Billings', country: 'US' },
      { iata: 'GEG', name: 'Spokane International Airport', city: 'Spokane', country: 'US' },
      { iata: 'BOI', name: 'Boise Airport', city: 'Boise', country: 'US' },
      { iata: 'SLC', name: 'Salt Lake City International Airport', city: 'Salt Lake City', country: 'US' },
      { iata: 'ABQ', name: 'Albuquerque International Sunport', city: 'Albuquerque', country: 'US' },
      { iata: 'ELP', name: 'El Paso International Airport', city: 'El Paso', country: 'US' },
      { iata: 'SAT', name: 'San Antonio International Airport', city: 'San Antonio', country: 'US' },
      { iata: 'AUS', name: 'Austin-Bergstrom International Airport', city: 'Austin', country: 'US' },
      { iata: 'TUS', name: 'Tucson International Airport', city: 'Tucson', country: 'US' },
      { iata: 'RNO', name: 'Reno-Tahoe International Airport', city: 'Reno', country: 'US' },
      { iata: 'SMF', name: 'Sacramento International Airport', city: 'Sacramento', country: 'US' },
      { iata: 'SAN', name: 'San Diego International Airport', city: 'San Diego', country: 'US' },
      { iata: 'SNA', name: 'John Wayne Airport', city: 'Orange County / Los Angeles', country: 'US' },
      { iata: 'PSP', name: 'Palm Springs International Airport', city: 'Palm Springs', country: 'US' },
      { iata: 'SBA', name: 'Santa Barbara Airport', city: 'Santa Barbara', country: 'US' },
      { iata: 'SJC', name: 'Norman Y. Mineta San Jose International', city: 'San Jose', country: 'US' },
      { iata: 'OAK', name: 'Oakland International Airport', city: 'Oakland / San Francisco', country: 'US' },
      { iata: 'FAT', name: 'Fresno Yosemite International Airport', city: 'Fresno', country: 'US' },
      { iata: 'RDD', name: 'Redding Municipal Airport', city: 'Redding', country: 'US' },
      { iata: 'ACV', name: 'California Redwood Coast Humboldt County Airport', city: 'Eureka / Humboldt', country: 'US' },
      { iata: 'MRY', name: 'Monterey Regional Airport', city: 'Monterey', country: 'US' },
      { iata: 'KOA', name: 'Ellison Onizuka Kona International', city: 'Kona, Hawaii', country: 'US' },
      { iata: 'OGG', name: 'Kahului Airport', city: 'Maui, Hawaii', country: 'US' },
      { iata: 'HNL', name: 'Daniel K. Inouye International Airport', city: 'Honolulu, Hawaii', country: 'US' },
      { iata: 'JNU', name: 'Juneau International Airport', city: 'Juneau, Alaska', country: 'US' },
      { iata: 'ANC', name: 'Ted Stevens Anchorage International', city: 'Anchorage, Alaska', country: 'US' },
      { iata: 'FAI', name: 'Fairbanks International Airport', city: 'Fairbanks, Alaska', country: 'US' },
    ];
    const ql = q.toLowerCase();
    const filtered = DEMO_AIRPORTS.filter(a =>
      a.iata.toLowerCase().includes(ql) ||
      a.name.toLowerCase().includes(ql) ||
      a.city.toLowerCase().includes(ql) ||
      a.country.toLowerCase().includes(ql)
    ).sort((a, b) => {
      // Metro groups first
      if (a.metro && !b.metro) return -1;
      if (!a.metro && b.metro) return 1;
      return 0;
    });
    return res.json(filtered.slice(0, 10));
  }

  try {
    const response = await amadeus.referenceData.locations.get({ keyword: q, subType: 'AIRPORT,CITY' });
    const results  = (response.data || []).map(loc => ({
      iata: loc.iataCode, name: loc.name,
      city: loc.address?.cityName || '', country: loc.address?.countryCode || ''
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
      // Override airport codes to match the actual search query
      from: origin.toUpperCase(),
      to: destination.toUpperCase(),
      departure: { ...f.departure, iata: origin.toUpperCase(), date: departure },
      arrival:   { ...f.arrival,   iata: destination.toUpperCase(), date: departure }
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
      ? Math.max(1, (new Date(checkout) - new Date(checkin)) / 86400000) : 2;
    const hotels = MOCK_HOTELS.map(h => ({ ...h, nights, totalPrice: h.pricePerNight * nights }));
    return res.json({ hotels, demo: true });
  }

  try {
    const cityCode = city.toUpperCase().slice(0, 3);
    const hotelList = await amadeus.referenceData.locations.hotels.byCity.get({ cityCode });
    const hotelIds  = (hotelList.data || []).slice(0, 20).map(h => h.hotelId);
    if (!hotelIds.length) return res.json({ hotels: [], demo: false });

    const offerParams = { hotelIds: hotelIds.join(','), adults: parseInt(adults) };
    if (checkin)  offerParams.checkInDate  = checkin;
    if (checkout) offerParams.checkOutDate = checkout;

    const offersResp = await amadeus.shopping.hotelOffersSearch.get(offerParams);
    const nights     = checkin && checkout
      ? Math.max(1, (new Date(checkout) - new Date(checkin)) / 86400000) : 1;
    const hotels = parseAmadeusHotels(offersResp.data || []).map(h => ({
      ...h, nights, totalPrice: h.pricePerNight ? h.pricePerNight * nights : null
    }));
    res.json({ hotels, demo: false });
  } catch (err) {
    console.error('Hotel search error:', err.description || err.message);
    res.json({ hotels: [], error: 'Hotel search unavailable. Please try again.', demo: false });
  }
});

// Bundles search
app.get('/api/bundles', async (req, res) => {
  const { origin, destination, depart, checkin, checkout, guests = 2 } = req.query;

  if (DEMO_MODE) {
    const nights = checkin && checkout
      ? Math.max(1, (new Date(checkout) - new Date(checkin)) / 86400000) : 3;

    let bundles = buildMockBundles();

    // Recalculate nights/prices with requested nights
    bundles = bundles.map(b => {
      const hotelTotal      = b.hotel.pricePerNight * nights;
      const individualTotal = b.flightPrice + hotelTotal;
      const discountPct     = 0.12 + (parseInt(b.id.split('-')[1]) % 3) * 0.04;
      const bundlePrice     = Math.round(individualTotal * (1 - discountPct));
      const savings         = individualTotal - bundlePrice;
      return { ...b, nights, hotelTotal, individualTotal, bundlePrice, savings };
    });

    if (depart) {
      bundles = bundles.map(b => ({
        ...b,
        flight: {
          ...b.flight,
          departure: { ...b.flight.departure, date: depart },
          arrival:   { ...b.flight.arrival,   date: depart }
        }
      }));
    }

    return res.json({ bundles, demo: true });
  }

  // Live mode: would combine flight + hotel search
  res.json({ bundles: [], error: 'Bundle search requires live API mode.', demo: false });
});

// Car Rentals search
app.get('/api/cars', (req, res) => {
  const { pickupDate, dropoffDate } = req.query;
  let days = 3;
  if (pickupDate && dropoffDate) {
    const d1 = new Date(pickupDate), d2 = new Date(dropoffDate);
    if (!isNaN(d1) && !isNaN(d2) && d2 > d1) {
      days = Math.max(1, Math.round((d2 - d1) / 86400000));
    }
  }
  const cars = MOCK_CARS.map(c => ({
    ...c,
    days,
    totalPrice: c.pricePerDay * days
  }));
  res.json({ cars, demo: true, days });
});

// ─── Price Watchdog ───────────────────────────────────────────────────────────
const WATCHLIST_FILE = path.join(__dirname, 'watchlist.json');

function loadWatchlist() {
  try { return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8')); } catch(e) { return []; }
}
function saveWatchlist(list) {
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2));
}

app.post('/api/watchlist', requireAuth, (req, res) => {
  const { email, type, origin, destination, departure, returnDate, targetPrice, adults, hotelName, city, checkin, checkout } = req.body;
  if (!email || !targetPrice) return res.status(400).json({ error: 'email and targetPrice required' });
  const list = loadWatchlist();
  const item = {
    id: Date.now().toString(),
    email, type: type || 'flight', targetPrice: parseFloat(targetPrice),
    origin, destination, departure, returnDate, adults,
    hotelName, city, checkin, checkout,
    createdAt: new Date().toISOString(),
    active: true,
    lastChecked: null
  };
  list.push(item);
  saveWatchlist(list);
  res.json({ ok: true, id: item.id, message: `Watching! We'll email ${email} if price drops below $${targetPrice}` });
});

app.get('/api/watchlist', requireAuth, (req, res) => {
  res.json(loadWatchlist());
});

app.delete('/api/watchlist/:id', requireAuth, (req, res) => {
  const list = loadWatchlist().filter(item => item.id !== req.params.id);
  saveWatchlist(list);
  res.json({ ok: true });
});

// ─── Price Check (manual trigger — checks if any watched route is below target) ──
app.get('/api/watchlist/check', requireAuth, (req, res) => {
  const list = loadWatchlist().filter(w => w.active);
  const results = list.map(w => {
    // Demo mode: check against all mock flights (airport codes are overridden at search time,
    // but alerts store the user's airport. Use the full price range generically.)
    const allPrices = MOCK_FLIGHTS.map(f => f.price);
    const bestPrice = allPrices.length ? Math.min(...allPrices) : null;
    const triggered = bestPrice !== null && w.targetPrice >= bestPrice;
    // Update lastChecked
    w.lastChecked = new Date().toISOString();
    return { ...w, bestPrice, triggered,
      note: triggered
        ? `🔔 Price dropped to $${bestPrice} — below your $${w.targetPrice} target!`
        : `Best price found: $${bestPrice}. Target: $${w.targetPrice}.` };
  });
  // Persist updated lastChecked timestamps
  const all = loadWatchlist();
  const updated = all.map(item => {
    const r = results.find(x => x.id === item.id);
    return r ? { ...item, lastChecked: r.lastChecked } : item;
  });
  saveWatchlist(updated);
  res.json({ results, checkedAt: new Date().toISOString() });
});

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Voyage Travel Dashboard v2 running on port ${PORT}`);
  console.log(`   Mode: ${DEMO_MODE ? '⚡ DEMO (no Amadeus key)' : '✅ LIVE (Amadeus connected)'}`);
  console.log(`   Features: Flights | Hotels | Bundles | Price Comparison`);
});
