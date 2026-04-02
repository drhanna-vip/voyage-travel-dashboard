'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3030;

// ─── Mode Detection ───────────────────────────────────────────────────────────
const AMADEUS_MODE      = !!(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET);
const AVIATIONSTACK_KEY = process.env.AVIATIONSTACK_KEY || null;
// Aviationstack free tier signup: https://aviationstack.com/signup/free
// Free tier: 100 requests/month, no credit card required
// Set AVIATIONSTACK_KEY env var on Render to activate real flight data
const DEMO_MODE         = !AMADEUS_MODE && !AVIATIONSTACK_KEY;

// ─── Security & Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

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
if (AMADEUS_MODE) {
  const Amadeus = require('amadeus');
  amadeus = new Amadeus({
    clientId:     process.env.AMADEUS_CLIENT_ID,
    clientSecret: process.env.AMADEUS_CLIENT_SECRET
  });
}

// ─── Airline Metadata ─────────────────────────────────────────────────────────
const AIRLINE_MAP = {
  AA: { name: 'American Airlines',   website: 'aa.com' },
  DL: { name: 'Delta Air Lines',     website: 'delta.com' },
  UA: { name: 'United Airlines',     website: 'united.com' },
  B6: { name: 'JetBlue Airways',     website: 'jetblue.com' },
  WN: { name: 'Southwest Airlines',  website: 'southwest.com' },
  AS: { name: 'Alaska Airlines',     website: 'alaskaair.com' },
  F9: { name: 'Frontier Airlines',   website: 'flyfrontier.com' },
  NK: { name: 'Spirit Airlines',     website: 'spirit.com' },
  LH: { name: 'Lufthansa',           website: 'lufthansa.com' },
  BA: { name: 'British Airways',     website: 'britishairways.com' },
  AF: { name: 'Air France',          website: 'airfrance.com' },
  EK: { name: 'Emirates',            website: 'emirates.com' },
  QR: { name: 'Qatar Airways',       website: 'qatarairways.com' },
  SQ: { name: 'Singapore Airlines',  website: 'singaporeair.com' },
  VS: { name: 'Virgin Atlantic',     website: 'virginatlantic.com' },
  IB: { name: 'Iberia',              website: 'iberia.com' },
  KL: { name: 'KLM',                 website: 'klm.com' },
  AC: { name: 'Air Canada',          website: 'aircanada.com' },
  AZ: { name: 'ITA Airways',         website: 'ita-airways.com' },
  TK: { name: 'Turkish Airlines',    website: 'turkishairlines.com' }
};

// ─── Route Distance Table (miles) ────────────────────────────────────────────
// Used for dynamic pricing — base price scales with distance
const ROUTE_DISTANCES = {
  'JFK-LAX': 2475, 'LAX-JFK': 2475,
  'JFK-MIA': 1090, 'MIA-JFK': 1090,
  'JFK-ORD': 740,  'ORD-JFK': 740,
  'JFK-LHR': 3459, 'LHR-JFK': 3459,
  'JFK-CDG': 3627, 'CDG-JFK': 3627,
  'JFK-SFO': 2586, 'SFO-JFK': 2586,
  'JFK-BOS': 187,  'BOS-JFK': 187,
  'JFK-DFW': 1391, 'DFW-JFK': 1391,
  'JFK-SEA': 2852, 'SEA-JFK': 2852,
  'JFK-DEN': 1626, 'DEN-JFK': 1626,
  'JFK-LAS': 2248, 'LAS-JFK': 2248,
  'JFK-ATL': 760,  'ATL-JFK': 760,
  'JFK-NRT': 6740, 'NRT-JFK': 6740,
  'JFK-DXB': 6836, 'DXB-JFK': 6836,
  'LAX-SFO': 337,  'SFO-LAX': 337,
  'LAX-ORD': 1745, 'ORD-LAX': 1745,
  'LAX-MIA': 2757, 'MIA-LAX': 2757,
  'LAX-SEA': 954,  'SEA-LAX': 954,
  'LAX-DEN': 862,  'DEN-LAX': 862,
  'LAX-DFW': 1235, 'DFW-LAX': 1235,
  'LAX-LHR': 5456, 'LHR-LAX': 5456,
  'LAX-NRT': 5451, 'NRT-LAX': 5451,
  'ORD-MIA': 1197, 'MIA-ORD': 1197,
  'BOS-MIA': 1258, 'MIA-BOS': 1258,
  'ATL-LAX': 1946, 'LAX-ATL': 1946,
  'LHR-CDG': 216,  'CDG-LHR': 216,
  'LHR-DXB': 3407, 'DXB-LHR': 3407,
  'CDG-NRT': 6053, 'NRT-CDG': 6053,
};

// ─── Airport Database (25+ airports) ─────────────────────────────────────────
const AIRPORTS_DB = [
  // US — East
  { iata: 'JFK', name: 'John F. Kennedy International Airport',        city: 'New York',       country: 'US', tz: 'America/New_York' },
  { iata: 'LGA', name: 'LaGuardia Airport',                            city: 'New York',       country: 'US', tz: 'America/New_York' },
  { iata: 'EWR', name: 'Newark Liberty International Airport',         city: 'Newark',         country: 'US', tz: 'America/New_York' },
  { iata: 'BOS', name: 'Boston Logan International Airport',           city: 'Boston',         country: 'US', tz: 'America/New_York' },
  { iata: 'MIA', name: 'Miami International Airport',                  city: 'Miami',          country: 'US', tz: 'America/New_York' },
  { iata: 'FLL', name: 'Fort Lauderdale–Hollywood International',      city: 'Fort Lauderdale',country: 'US', tz: 'America/New_York' },
  { iata: 'MCO', name: 'Orlando International Airport',                city: 'Orlando',        country: 'US', tz: 'America/New_York' },
  { iata: 'ATL', name: 'Hartsfield-Jackson Atlanta International',     city: 'Atlanta',        country: 'US', tz: 'America/New_York' },
  { iata: 'DCA', name: 'Ronald Reagan Washington National Airport',    city: 'Washington DC',  country: 'US', tz: 'America/New_York' },
  { iata: 'IAD', name: 'Washington Dulles International Airport',      city: 'Washington DC',  country: 'US', tz: 'America/New_York' },
  { iata: 'PHL', name: 'Philadelphia International Airport',           city: 'Philadelphia',   country: 'US', tz: 'America/New_York' },
  // US — Midwest
  { iata: 'ORD', name: "O'Hare International Airport",                 city: 'Chicago',        country: 'US', tz: 'America/Chicago' },
  { iata: 'MDW', name: 'Chicago Midway International Airport',         city: 'Chicago',        country: 'US', tz: 'America/Chicago' },
  { iata: 'DTW', name: 'Detroit Metropolitan Wayne County Airport',    city: 'Detroit',        country: 'US', tz: 'America/Detroit' },
  { iata: 'MSP', name: 'Minneapolis-Saint Paul International Airport', city: 'Minneapolis',    country: 'US', tz: 'America/Chicago' },
  // US — South & Central
  { iata: 'DFW', name: 'Dallas/Fort Worth International Airport',      city: 'Dallas',         country: 'US', tz: 'America/Chicago' },
  { iata: 'IAH', name: 'George Bush Intercontinental Airport',         city: 'Houston',        country: 'US', tz: 'America/Chicago' },
  { iata: 'PHX', name: 'Phoenix Sky Harbor International Airport',     city: 'Phoenix',        country: 'US', tz: 'America/Phoenix' },
  // US — Mountain & West
  { iata: 'DEN', name: 'Denver International Airport',                 city: 'Denver',         country: 'US', tz: 'America/Denver' },
  { iata: 'LAS', name: 'Harry Reid International Airport',             city: 'Las Vegas',      country: 'US', tz: 'America/Los_Angeles' },
  { iata: 'SLC', name: 'Salt Lake City International Airport',         city: 'Salt Lake City', country: 'US', tz: 'America/Denver' },
  // US — West Coast
  { iata: 'LAX', name: 'Los Angeles International Airport',            city: 'Los Angeles',    country: 'US', tz: 'America/Los_Angeles' },
  { iata: 'SFO', name: 'San Francisco International Airport',          city: 'San Francisco',  country: 'US', tz: 'America/Los_Angeles' },
  { iata: 'SJC', name: 'Norman Y. Mineta San José International',      city: 'San Jose',       country: 'US', tz: 'America/Los_Angeles' },
  { iata: 'SEA', name: 'Seattle-Tacoma International Airport',         city: 'Seattle',        country: 'US', tz: 'America/Los_Angeles' },
  { iata: 'PDX', name: 'Portland International Airport',               city: 'Portland',       country: 'US', tz: 'America/Los_Angeles' },
  // Europe
  { iata: 'LHR', name: 'London Heathrow Airport',                      city: 'London',         country: 'GB', tz: 'Europe/London' },
  { iata: 'LGW', name: 'London Gatwick Airport',                       city: 'London',         country: 'GB', tz: 'Europe/London' },
  { iata: 'CDG', name: 'Charles de Gaulle Airport',                    city: 'Paris',          country: 'FR', tz: 'Europe/Paris' },
  { iata: 'AMS', name: 'Amsterdam Airport Schiphol',                   city: 'Amsterdam',      country: 'NL', tz: 'Europe/Amsterdam' },
  { iata: 'FRA', name: 'Frankfurt Airport',                            city: 'Frankfurt',      country: 'DE', tz: 'Europe/Berlin' },
  { iata: 'MAD', name: 'Adolfo Suárez Madrid–Barajas Airport',         city: 'Madrid',         country: 'ES', tz: 'Europe/Madrid' },
  { iata: 'FCO', name: 'Leonardo da Vinci–Fiumicino Airport',          city: 'Rome',           country: 'IT', tz: 'Europe/Rome' },
  { iata: 'BCN', name: 'Josep Tarradellas Barcelona–El Prat Airport',  city: 'Barcelona',      country: 'ES', tz: 'Europe/Madrid' },
  // Middle East & Asia
  { iata: 'DXB', name: 'Dubai International Airport',                  city: 'Dubai',          country: 'AE', tz: 'Asia/Dubai' },
  { iata: 'DOH', name: 'Hamad International Airport',                  city: 'Doha',           country: 'QA', tz: 'Asia/Qatar' },
  { iata: 'NRT', name: 'Narita International Airport',                 city: 'Tokyo',          country: 'JP', tz: 'Asia/Tokyo' },
  { iata: 'HND', name: 'Tokyo Haneda Airport',                         city: 'Tokyo',          country: 'JP', tz: 'Asia/Tokyo' },
  { iata: 'SIN', name: 'Singapore Changi Airport',                     city: 'Singapore',      country: 'SG', tz: 'Asia/Singapore' },
  { iata: 'HKG', name: 'Hong Kong International Airport',              city: 'Hong Kong',      country: 'HK', tz: 'Asia/Hong_Kong' },
  { iata: 'ICN', name: 'Incheon International Airport',                city: 'Seoul',          country: 'KR', tz: 'Asia/Seoul' },
  { iata: 'BKK', name: 'Suvarnabhumi Airport',                         city: 'Bangkok',        country: 'TH', tz: 'Asia/Bangkok' },
  // Other
  { iata: 'YYZ', name: 'Toronto Pearson International Airport',        city: 'Toronto',        country: 'CA', tz: 'America/Toronto' },
  { iata: 'MEX', name: 'Mexico City International Airport',            city: 'Mexico City',    country: 'MX', tz: 'America/Mexico_City' },
  { iata: 'GRU', name: 'São Paulo–Guarulhos International Airport',    city: 'São Paulo',      country: 'BR', tz: 'America/Sao_Paulo' },
  { iata: 'SYD', name: 'Sydney Kingsford Smith Airport',               city: 'Sydney',         country: 'AU', tz: 'Australia/Sydney' },
];

// ─── Dynamic Price Engine ─────────────────────────────────────────────────────
const CLASS_MULTIPLIERS = {
  ECONOMY:         1.0,
  PREMIUM_ECONOMY: 2.2,
  BUSINESS:        4.5,
  FIRST:           8.0
};

/**
 * Estimate base economy price from route distance.
 * Uses a tiered model: short-haul is expensive per mile, long-haul gets efficient.
 */
function estimateBasePrice(originIata, destIata) {
  const key = `${originIata}-${destIata}`;
  let miles = ROUTE_DISTANCES[key];
  if (!miles) {
    // Fall back to rough random if unknown route
    miles = 800 + Math.floor(Math.random() * 3000);
  }
  let pricePerMile;
  if (miles < 500)       pricePerMile = 0.28;  // Short haul — high cost/mile
  else if (miles < 1500) pricePerMile = 0.18;
  else if (miles < 3000) pricePerMile = 0.13;
  else if (miles < 6000) pricePerMile = 0.09;
  else                   pricePerMile = 0.07;  // Ultra long-haul
  return Math.round(miles * pricePerMile);
}

/**
 * Apply date-based demand surge (weekends, holidays cost more).
 */
function dateSurgeMultiplier(dateStr) {
  if (!dateStr) return 1.0;
  const d = new Date(dateStr);
  const dow = d.getDay();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  let surge = 1.0;
  if (dow === 5 || dow === 0) surge *= 1.15;  // Fri/Sun
  if (dow === 6) surge *= 1.12;               // Saturday
  // Summer (Jun-Aug) and holiday (Dec) peaks
  if (month >= 6 && month <= 8) surge *= 1.20;
  if (month === 12) surge *= 1.25;
  // Specific holiday windows — approximate
  if (month === 11 && day >= 22 && day <= 30) surge *= 1.30; // Thanksgiving
  if (month === 3 && day >= 14 && day <= 21) surge *= 1.10; // Spring break
  return surge;
}

/** Add a small random jitter so prices look real (±8%). */
function jitter(price, seed) {
  const rnd = ((seed * 9301 + 49297) % 233280) / 233280;
  return Math.round(price * (0.92 + rnd * 0.16));
}

// ─── Mock Flight Templates ────────────────────────────────────────────────────
// These define the SCHEDULE; prices are computed dynamically at query time.
const FLIGHT_TEMPLATES = [
  // ── JFK → LAX ────────────────────────────────────────────────────────────
  { id: 't-1',  origin: 'JFK', dest: 'LAX', airline: 'DL', fn: 'DL302',  dep: '06:00', arr: '09:30', dur: '5h 30m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 4,  bags: 'Carry-on included. Checked bag $30.',              amenities: ['Power outlets','IFE','Wi-Fi'], co2: '142 kg CO₂' },
  { id: 't-2',  origin: 'JFK', dest: 'LAX', airline: 'AA', fn: 'AA102',  dep: '08:00', arr: '11:45', dur: '5h 45m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 7,  bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets','IFE'],        co2: '148 kg CO₂' },
  { id: 't-3',  origin: 'JFK', dest: 'LAX', airline: 'UA', fn: 'UA175',  dep: '10:00', arr: '14:20', dur: '6h 20m', stops: 1, stop_airports: ['ORD'], class: 'ECONOMY',    seats: 12, bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets'],              co2: '162 kg CO₂' },
  { id: 't-4',  origin: 'JFK', dest: 'LAX', airline: 'B6', fn: 'B6623',  dep: '12:00', arr: '15:45', dur: '5h 45m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 3,  bags: 'First bag free. Carry-on included.',               amenities: ['Free Wi-Fi','Power outlets','IFE','Snacks'], co2: '148 kg CO₂' },
  { id: 't-5',  origin: 'JFK', dest: 'LAX', airline: 'DL', fn: 'DL1968', dep: '18:00', arr: '21:30', dur: '5h 30m', stops: 0, stop_airports: [], class: 'PREMIUM_ECONOMY', seats: 2,  bags: '2 checked bags included.',                         amenities: ['Premium seat','Power outlets','IFE','Meal'], co2: '142 kg CO₂' },
  { id: 't-6',  origin: 'JFK', dest: 'LAX', airline: 'AA', fn: 'AA268',  dep: '21:00', arr: '00:35', dur: '5h 35m', stops: 0, stop_airports: [], class: 'BUSINESS',        seats: 5,  bags: '3 checked bags. Priority boarding.',               amenities: ['Lie-flat seat','Premium meal','Lounge access','Wi-Fi','Amenity kit'], co2: '148 kg CO₂' },

  // ── JFK → MIA ────────────────────────────────────────────────────────────
  { id: 't-7',  origin: 'JFK', dest: 'MIA', airline: 'AA', fn: 'AA189',  dep: '07:00', arr: '10:10', dur: '3h 10m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 9,  bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets','IFE'],        co2: '72 kg CO₂'  },
  { id: 't-8',  origin: 'JFK', dest: 'MIA', airline: 'DL', fn: 'DL426',  dep: '10:30', arr: '13:50', dur: '3h 20m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 6,  bags: 'Carry-on included. Checked bag $30.',              amenities: ['Power outlets','IFE'],        co2: '75 kg CO₂'  },
  { id: 't-9',  origin: 'JFK', dest: 'MIA', airline: 'B6', fn: 'B6523',  dep: '16:00', arr: '19:15', dur: '3h 15m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 14, bags: 'First bag free. Carry-on included.',               amenities: ['Free Wi-Fi','IFE','Snacks'], co2: '72 kg CO₂'  },

  // ── JFK → ORD ────────────────────────────────────────────────────────────
  { id: 't-10', origin: 'JFK', dest: 'ORD', airline: 'AA', fn: 'AA731',  dep: '06:30', arr: '08:20', dur: '1h 50m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 11, bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets'],              co2: '48 kg CO₂'  },
  { id: 't-11', origin: 'JFK', dest: 'ORD', airline: 'UA', fn: 'UA411',  dep: '14:00', arr: '15:55', dur: '1h 55m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 8,  bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets','IFE'],        co2: '48 kg CO₂'  },

  // ── JFK → LHR ────────────────────────────────────────────────────────────
  { id: 't-12', origin: 'JFK', dest: 'LHR', airline: 'BA', fn: 'BA178',  dep: '19:00', arr: '07:00', dur: '7h 00m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 8,  bags: 'Carry-on included. Checked bag included.',         amenities: ['IFE','Meal','Power outlets'], co2: '390 kg CO₂' },
  { id: 't-13', origin: 'JFK', dest: 'LHR', airline: 'VS', fn: 'VS3',   dep: '22:30', arr: '10:25', dur: '6h 55m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 5,  bags: 'Carry-on included. Checked bag included.',         amenities: ['IFE','Meal','Power outlets'], co2: '385 kg CO₂' },
  { id: 't-14', origin: 'JFK', dest: 'LHR', airline: 'AA', fn: 'AA100',  dep: '21:00', arr: '09:05', dur: '7h 05m', stops: 0, stop_airports: [], class: 'BUSINESS',        seats: 3,  bags: '3 checked bags. Lounge access.',                   amenities: ['Lie-flat seat','Premium meal','Lounge access','Wi-Fi','Amenity kit'], co2: '390 kg CO₂' },

  // ── JFK → CDG ────────────────────────────────────────────────────────────
  { id: 't-15', origin: 'JFK', dest: 'CDG', airline: 'AF', fn: 'AF23',   dep: '18:30', arr: '08:15', dur: '7h 45m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 10, bags: 'Carry-on + 1 checked bag included.',              amenities: ['IFE','Meal','Power outlets'], co2: '415 kg CO₂' },
  { id: 't-16', origin: 'JFK', dest: 'CDG', airline: 'DL', fn: 'DL404',  dep: '17:40', arr: '07:30', dur: '7h 50m', stops: 0, stop_airports: [], class: 'PREMIUM_ECONOMY', seats: 4,  bags: '2 checked bags included. Meal service.',           amenities: ['Premium seat','IFE','Meal','Power outlets'], co2: '415 kg CO₂' },

  // ── JFK → NRT ────────────────────────────────────────────────────────────
  { id: 't-17', origin: 'JFK', dest: 'NRT', airline: 'JL', fn: 'JL6',    dep: '14:00', arr: '16:15', dur: '13h 15m',stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 6,  bags: 'Carry-on + 2 checked bags included.',             amenities: ['IFE','Meal','Power outlets'], co2: '780 kg CO₂' },
  { id: 't-18', origin: 'JFK', dest: 'NRT', airline: 'AA', fn: 'AA169',  dep: '11:30', arr: '14:45', dur: '14h 15m',stops: 1, stop_airports: ['LAX'], class: 'ECONOMY',    seats: 9,  bags: 'Carry-on included. Checked bag $35.',             amenities: ['IFE','Meal'],                co2: '810 kg CO₂' },

  // ── LAX → SFO ────────────────────────────────────────────────────────────
  { id: 't-19', origin: 'LAX', dest: 'SFO', airline: 'AS', fn: 'AS1207', dep: '08:00', arr: '09:20', dur: '1h 20m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 15, bags: 'Carry-on included. Checked bag $30.',              amenities: ['Power outlets'],              co2: '32 kg CO₂'  },
  { id: 't-20', origin: 'LAX', dest: 'SFO', airline: 'WN', fn: 'WN2844', dep: '12:30', arr: '13:55', dur: '1h 25m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 20, bags: '2 bags fly free.',                                 amenities: [],                            co2: '30 kg CO₂'  },

  // ── LAX → ORD ────────────────────────────────────────────────────────────
  { id: 't-21', origin: 'LAX', dest: 'ORD', airline: 'UA', fn: 'UA232',  dep: '07:45', arr: '13:55', dur: '4h 10m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 7,  bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets','IFE'],        co2: '195 kg CO₂' },
  { id: 't-22', origin: 'LAX', dest: 'ORD', airline: 'AA', fn: 'AA2149', dep: '15:00', arr: '21:15', dur: '4h 15m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 5,  bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets'],              co2: '192 kg CO₂' },

  // ── ORD → MIA ────────────────────────────────────────────────────────────
  { id: 't-23', origin: 'ORD', dest: 'MIA', airline: 'AA', fn: 'AA1225', dep: '09:30', arr: '14:00', dur: '2h 30m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 10, bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets','IFE'],        co2: '88 kg CO₂'  },
  { id: 't-24', origin: 'ORD', dest: 'MIA', airline: 'UA', fn: 'UA1632', dep: '13:15', arr: '17:50', dur: '2h 35m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 8,  bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets'],              co2: '90 kg CO₂'  },

  // ── ATL → LAX ────────────────────────────────────────────────────────────
  { id: 't-25', origin: 'ATL', dest: 'LAX', airline: 'DL', fn: 'DL1601', dep: '09:00', arr: '11:15', dur: '5h 15m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 6,  bags: 'Carry-on included. Checked bag $30.',              amenities: ['Power outlets','IFE'],        co2: '185 kg CO₂' },
  { id: 't-26', origin: 'ATL', dest: 'LAX', airline: 'AA', fn: 'AA1351', dep: '14:30', arr: '16:55', dur: '5h 25m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 9,  bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets','IFE'],        co2: '188 kg CO₂' },

  // ── DFW → JFK ────────────────────────────────────────────────────────────
  { id: 't-27', origin: 'DFW', dest: 'JFK', airline: 'AA', fn: 'AA1355', dep: '07:00', arr: '11:40', dur: '3h 40m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 11, bags: 'Carry-on included. Checked bag $35.',              amenities: ['Power outlets','IFE'],        co2: '118 kg CO₂' },
  { id: 't-28', origin: 'DFW', dest: 'JFK', airline: 'DL', fn: 'DL2041', dep: '13:30', arr: '18:20', dur: '3h 50m', stops: 1, stop_airports: ['ATL'], class: 'ECONOMY',    seats: 7,  bags: 'Carry-on included. Checked bag $30.',              amenities: ['Power outlets'],              co2: '128 kg CO₂' },

  // ── SEA → JFK ────────────────────────────────────────────────────────────
  { id: 't-29', origin: 'SEA', dest: 'JFK', airline: 'DL', fn: 'DL1851', dep: '06:00', arr: '14:15', dur: '5h 15m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 8,  bags: 'Carry-on included. Checked bag $30.',              amenities: ['Power outlets','IFE'],        co2: '235 kg CO₂' },
  { id: 't-30', origin: 'SEA', dest: 'JFK', airline: 'AS', fn: 'AS32',   dep: '10:30', arr: '18:55', dur: '5h 25m', stops: 0, stop_airports: [], class: 'ECONOMY',         seats: 5,  bags: '2 checked bags included.',                         amenities: ['Power outlets','IFE','Snacks'], co2: '232 kg CO₂' },
];

// ─── Mock Hotels Database ─────────────────────────────────────────────────────
// Covers NYC, LA, Chicago, Miami, London, Paris + more
const HOTELS_DB = [
  // ── New York ───────────────────────────────────────────────────────────────
  { id: 'h-1',  city: 'NYC', name: 'The Peninsula New York',          stars: 5, rating: 9.5, ratingLabel: 'Exceptional',  location: '700 5th Ave, Midtown Manhattan',        amenities: ['Spa','Pool','Restaurant','Gym','Wi-Fi','Concierge'],              basePrice: 595, currency: 'USD', image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600&q=80' },
  { id: 'h-2',  city: 'NYC', name: 'Park Hyatt New York',             stars: 5, rating: 9.6, ratingLabel: 'Exceptional',  location: '153 W 57th St, Midtown',               amenities: ['Spa','Pool','Restaurant','Gym','Wi-Fi','Butler Service'],         basePrice: 895, currency: 'USD', image: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80' },
  { id: 'h-3',  city: 'NYC', name: 'The Plaza Hotel',                 stars: 5, rating: 9.3, ratingLabel: 'Exceptional',  location: 'Fifth Avenue at Central Park South',   amenities: ['Spa','Restaurant','Gym','Wi-Fi','Concierge','Valet'],             basePrice: 750, currency: 'USD', image: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=600&q=80' },
  { id: 'h-4',  city: 'NYC', name: 'Kimpton Hotel Eventi',            stars: 4, rating: 9.1, ratingLabel: 'Excellent',    location: '851 Avenue of the Americas, Chelsea',  amenities: ['Restaurant','Gym','Wi-Fi','Bar','Business Center'],               basePrice: 289, currency: 'USD', image: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600&q=80' },
  { id: 'h-5',  city: 'NYC', name: 'citizenM New York Times Square',  stars: 4, rating: 8.9, ratingLabel: 'Excellent',    location: '218 W 50th St, Times Square',          amenities: ['Rooftop Bar','Wi-Fi','Gym','Restaurant'],                         basePrice: 249, currency: 'USD', image: 'https://images.unsplash.com/photo-1549294413-26f195200c16?w=600&q=80' },
  { id: 'h-6',  city: 'NYC', name: 'Arlo SoHo',                       stars: 3, rating: 8.7, ratingLabel: 'Very Good',    location: '231 Hudson St, SoHo',                  amenities: ['Rooftop Bar','Wi-Fi','Restaurant','Gym'],                         basePrice: 199, currency: 'USD', image: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=600&q=80' },

  // ── Los Angeles ────────────────────────────────────────────────────────────
  { id: 'h-7',  city: 'LAX', name: 'Hotel Bel-Air',                   stars: 5, rating: 9.7, ratingLabel: 'Exceptional',  location: '701 Stone Canyon Rd, Bel-Air',         amenities: ['Spa','Pool','Restaurant','Gym','Wi-Fi','Concierge','Valet'],      basePrice: 1100,currency: 'USD', image: 'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=600&q=80' },
  { id: 'h-8',  city: 'LAX', name: 'The Beverly Hilton',              stars: 4, rating: 8.8, ratingLabel: 'Excellent',    location: '9876 Wilshire Blvd, Beverly Hills',    amenities: ['Pool','Restaurant','Gym','Wi-Fi','Bar','Spa'],                    basePrice: 395, currency: 'USD', image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=80' },
  { id: 'h-9',  city: 'LAX', name: 'Freehand Los Angeles',            stars: 4, rating: 8.6, ratingLabel: 'Very Good',    location: '416 W 8th St, Downtown LA',            amenities: ['Pool','Bar','Wi-Fi','Restaurant','Gym'],                          basePrice: 229, currency: 'USD', image: 'https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=600&q=80' },

  // ── Chicago ────────────────────────────────────────────────────────────────
  { id: 'h-10', city: 'ORD', name: 'Four Seasons Hotel Chicago',      stars: 5, rating: 9.4, ratingLabel: 'Exceptional',  location: '120 E Delaware Pl, Magnificent Mile',  amenities: ['Spa','Pool','Restaurant','Gym','Wi-Fi','Concierge'],              basePrice: 549, currency: 'USD', image: 'https://images.unsplash.com/photo-1610641818989-c2051b5e2cfd?w=600&q=80' },
  { id: 'h-11', city: 'ORD', name: 'Kimpton Gray Hotel',              stars: 4, rating: 9.0, ratingLabel: 'Excellent',    location: '122 W Monroe St, The Loop',            amenities: ['Restaurant','Bar','Gym','Wi-Fi','Business Center'],               basePrice: 279, currency: 'USD', image: 'https://images.unsplash.com/photo-1590073242678-70ee3fc28f8e?w=600&q=80' },

  // ── Miami ──────────────────────────────────────────────────────────────────
  { id: 'h-12', city: 'MIA', name: 'Faena Hotel Miami Beach',         stars: 5, rating: 9.5, ratingLabel: 'Exceptional',  location: '3201 Collins Ave, Miami Beach',        amenities: ['Spa','Pool','Restaurant','Gym','Wi-Fi','Cabaret','Butler'],       basePrice: 795, currency: 'USD', image: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=600&q=80' },
  { id: 'h-13', city: 'MIA', name: 'The Setai Miami Beach',           stars: 5, rating: 9.6, ratingLabel: 'Exceptional',  location: '2001 Collins Ave, South Beach',        amenities: ['Spa','3 Pools','Restaurant','Gym','Wi-Fi','Concierge'],           basePrice: 680, currency: 'USD', image: 'https://images.unsplash.com/photo-1615460549969-36fa19521a4f?w=600&q=80' },
  { id: 'h-14', city: 'MIA', name: 'Bayside Boutique Miami',          stars: 3, rating: 8.5, ratingLabel: 'Very Good',    location: '401 Biscayne Blvd, Downtown Miami',    amenities: ['Pool','Wi-Fi','Restaurant','Bar'],                                basePrice: 175, currency: 'USD', image: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=600&q=80' },

  // ── London ─────────────────────────────────────────────────────────────────
  { id: 'h-15', city: 'LHR', name: 'The Savoy',                       stars: 5, rating: 9.5, ratingLabel: 'Exceptional',  location: 'The Strand, City of Westminster',      amenities: ['Spa','Pool','Restaurant','Gym','Wi-Fi','Butler','Concierge'],     basePrice: 920, currency: 'USD', image: 'https://images.unsplash.com/photo-1543968996-ee822b8176ba?w=600&q=80' },
  { id: 'h-16', city: 'LHR', name: 'Claridge\'s',                     stars: 5, rating: 9.6, ratingLabel: 'Exceptional',  location: 'Brook St, Mayfair, London',            amenities: ['Spa','Restaurant','Bar','Wi-Fi','Butler','Concierge'],            basePrice: 1050,currency: 'USD', image: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=600&q=80' },
  { id: 'h-17', city: 'LHR', name: 'citizenM London Shoreditch',      stars: 4, rating: 8.8, ratingLabel: 'Excellent',    location: 'Holywell Lane, Shoreditch',            amenities: ['Rooftop Bar','Wi-Fi','Gym','Restaurant'],                         basePrice: 210, currency: 'USD', image: 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=600&q=80' },

  // ── Paris ──────────────────────────────────────────────────────────────────
  { id: 'h-18', city: 'CDG', name: 'Le Meurice',                      stars: 5, rating: 9.7, ratingLabel: 'Exceptional',  location: '228 Rue de Rivoli, 1st Arrondissement',amenities: ['Spa','Restaurant (2 Michelin stars)','Bar','Wi-Fi','Concierge'], basePrice: 1200,currency: 'USD', image: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80' },
  { id: 'h-19', city: 'CDG', name: 'Hotel des Grands Boulevards',     stars: 4, rating: 9.1, ratingLabel: 'Excellent',    location: '17 Bd Poissonnière, 2nd Arrondissement',amenities: ['Restaurant','Bar','Wi-Fi','Rooftop Terrace'],                    basePrice: 295, currency: 'USD', image: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600&q=80' },

  // ── Tokyo ──────────────────────────────────────────────────────────────────
  { id: 'h-20', city: 'NRT', name: 'The Peninsula Tokyo',             stars: 5, rating: 9.6, ratingLabel: 'Exceptional',  location: '1-8-1 Yurakucho, Chiyoda-ku, Tokyo',  amenities: ['Spa','Pool','Restaurant','Gym','Wi-Fi','Concierge'],              basePrice: 780, currency: 'USD', image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600&q=80' },

  // ── Dubai ──────────────────────────────────────────────────────────────────
  { id: 'h-21', city: 'DXB', name: 'Burj Al Arab Jumeirah',           stars: 5, rating: 9.9, ratingLabel: 'Exceptional',  location: 'Jumeirah Beach Road, Dubai',           amenities: ['Private Beach','6 Pools','9 Restaurants','Spa','Helipad','Butler'],basePrice: 2500,currency: 'USD', image: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=600&q=80' },
  { id: 'h-22', city: 'DXB', name: 'Address Downtown Dubai',         stars: 5, rating: 9.3, ratingLabel: 'Exceptional',  location: 'Downtown Dubai, near Burj Khalifa',   amenities: ['Pool','Spa','Restaurant','Gym','Wi-Fi','Concierge'],              basePrice: 420, currency: 'USD', image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=80' },
];

// ─── City Mapping ─────────────────────────────────────────────────────────────
// Maps city search terms to hotel city codes
const CITY_TO_HOTEL_CODE = {
  // New York
  'new york': 'NYC', 'nyc': 'NYC', 'jfk': 'NYC', 'lga': 'NYC', 'ewr': 'NYC', 'manhattan': 'NYC',
  // Los Angeles
  'los angeles': 'LAX', 'la': 'LAX', 'lax': 'LAX', 'beverly hills': 'LAX', 'santa monica': 'LAX',
  // Chicago
  'chicago': 'ORD', 'ord': 'ORD',
  // Miami
  'miami': 'MIA', 'mia': 'MIA', 'miami beach': 'MIA', 'south beach': 'MIA',
  // London
  'london': 'LHR', 'lhr': 'LHR', 'lgw': 'LHR',
  // Paris
  'paris': 'CDG', 'cdg': 'CDG',
  // Tokyo
  'tokyo': 'NRT', 'nrt': 'NRT',
  // Dubai
  'dubai': 'DXB', 'dxb': 'DXB',
};

// ─── Aviationstack Integration ────────────────────────────────────────────────
// Free tier: 100 req/month, no credit card. Signup: https://aviationstack.com/signup/free
// Supports real-time flight status (not price data — combine with enhanced demo for prices)
async function fetchAviationstackFlights(origin, destination, departure) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      access_key: AVIATIONSTACK_KEY,
      dep_iata:   origin,
      arr_iata:   destination,
      limit:      10
    });
    // Note: Free tier is HTTP only (not HTTPS)
    const url = `http://api.aviationstack.com/v1/flights?${params.toString()}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function parseAviationstackFlights(data, origin, destination, departure, travelClass) {
  if (!data || !data.data || !Array.isArray(data.data)) return [];
  return data.data
    .filter(f => f.departure && f.arrival)
    .slice(0, 10)
    .map((f, idx) => {
      const airlineCode = f.airline?.iata || 'XX';
      const airlineInfo = AIRLINE_MAP[airlineCode] || { name: f.airline?.name || airlineCode, website: `${airlineCode.toLowerCase()}.com` };
      const depTime = f.departure.estimated ? f.departure.estimated.slice(11, 16) : (f.departure.scheduled ? f.departure.scheduled.slice(11, 16) : '??:??');
      const arrTime = f.arrival.estimated   ? f.arrival.estimated.slice(11, 16)   : (f.arrival.scheduled   ? f.arrival.scheduled.slice(11, 16)   : '??:??');

      // Estimate price from distance + class
      const basePrice = estimateBasePrice(origin, destination);
      const classMultiplier = CLASS_MULTIPLIERS[travelClass.toUpperCase()] || 1.0;
      const price = jitter(Math.round(basePrice * classMultiplier * dateSurgeMultiplier(departure)), idx * 17 + 31);

      return {
        id: f.flight?.iata || `as-${idx}`,
        airline: {
          code:    airlineCode,
          name:    airlineInfo.name,
          website: airlineInfo.website,
          logo:    `https://logo.clearbit.com/${airlineInfo.website}`
        },
        flightNumber: f.flight?.iata || `${airlineCode}${idx + 1}`,
        departure:    { iata: origin,      time: depTime, date: departure },
        arrival:      { iata: destination, time: arrTime, date: departure },
        duration:     '—',
        stops:        0,
        stopAirports: [],
        price,
        currency: 'USD',
        class:    travelClass.toUpperCase(),
        seatsLeft: Math.floor(Math.random() * 12) + 1,
        baggage:  'See airline for baggage policy.',
        amenities: [],
        co2: null,
        source: 'aviationstack'
      };
    });
}

// ─── Enhanced Demo Flight Generator ──────────────────────────────────────────
function getDemoFlights(origin, destination, departure, travelClass = 'ECONOMY', adults = 1) {
  origin      = (origin || '').toUpperCase();
  destination = (destination || '').toUpperCase();
  travelClass = (travelClass || 'ECONOMY').toUpperCase();

  // Try to find pre-defined templates for this route
  let templates = FLIGHT_TEMPLATES.filter(t => t.origin === origin && t.dest === destination);

  // If nothing found, try reverse (for bidirectional routes where we only defined one direction)
  if (!templates.length) {
    const reverse = FLIGHT_TEMPLATES.filter(t => t.origin === destination && t.dest === origin);
    if (reverse.length) {
      // Mirror them: swap dep/arr times, keep duration
      templates = reverse.map(t => ({
        ...t,
        id:     t.id + '-r',
        origin: destination,
        dest:   origin,
        dep:    t.arr,
        arr:    t.dep
      }));
    }
  }

  // If still nothing, generate 5 synthetic flights for the route
  if (!templates.length) {
    const airlines  = ['AA', 'DL', 'UA', 'B6', 'AS'];
    const departures = ['06:30', '09:00', '12:30', '15:45', '19:00'];
    templates = airlines.map((al, i) => ({
      id:            `gen-${origin}-${destination}-${i}`,
      origin, dest:  destination,
      airline:       al,
      fn:            `${al}${1000 + i * 111}`,
      dep:           departures[i],
      arr:           '—',
      dur:           '—',
      stops:         i === 2 ? 1 : 0,
      stop_airports: i === 2 ? ['ORD'] : [],
      class:         i === 4 ? 'BUSINESS' : 'ECONOMY',
      seats:         Math.floor(Math.random() * 15) + 1,
      bags:          'See airline for baggage policy.',
      amenities:     i === 4 ? ['Lie-flat seat', 'Premium meal', 'Wi-Fi'] : ['Power outlets'],
      co2:           null
    }));
  }

  // Filter by travel class — prefer matching; if none, return all
  const classFiltered = templates.filter(t =>
    travelClass === 'ECONOMY' || t.class === travelClass
  );
  const finalTemplates = classFiltered.length ? classFiltered : templates;

  // Build dynamic price for each template
  const basePriceEconomy = estimateBasePrice(origin, destination);
  const surgeMult        = dateSurgeMultiplier(departure);

  return finalTemplates.map((t, idx) => {
    const classForPrice    = t.class || travelClass;
    const classMultiplier  = CLASS_MULTIPLIERS[classForPrice] || 1.0;
    const price            = jitter(Math.round(basePriceEconomy * classMultiplier * surgeMult), idx * 13 + 7) * adults;
    const airlineInfo      = AIRLINE_MAP[t.airline] || { name: t.airline, website: `${t.airline.toLowerCase()}.com` };

    return {
      id:          t.id,
      airline: {
        code:    t.airline,
        name:    airlineInfo.name,
        website: airlineInfo.website,
        logo:    `https://logo.clearbit.com/${airlineInfo.website}`
      },
      flightNumber: t.fn,
      departure:    { iata: origin,      time: t.dep, date: departure },
      arrival:      { iata: destination, time: t.arr, date: departure },
      duration:     t.dur,
      stops:        t.stops,
      stopAirports: t.stop_airports,
      price:        Math.max(price, 49),
      currency:     'USD',
      class:        classForPrice,
      seatsLeft:    t.seats,
      baggage:      t.bags,
      amenities:    t.amenities,
      co2:          t.co2
    };
  });
}

// ─── Enhanced Demo Hotel Generator ───────────────────────────────────────────
function getDemoHotels(city, checkin, checkout, adults = 2) {
  const nights = (checkin && checkout)
    ? Math.max(1, Math.round((new Date(checkout) - new Date(checkin)) / 86400000))
    : 2;

  // Normalize city lookup
  const cityLower = (city || '').toLowerCase().trim();
  let code = CITY_TO_HOTEL_CODE[cityLower];

  // Fallback: try matching against IATA in AIRPORTS_DB
  if (!code) {
    const airport = AIRPORTS_DB.find(a =>
      a.iata.toLowerCase() === cityLower ||
      a.city.toLowerCase() === cityLower ||
      a.city.toLowerCase().includes(cityLower)
    );
    if (airport) {
      // Map airport to hotel code
      code = Object.keys(CITY_TO_HOTEL_CODE).reduce((found, k) => {
        if (CITY_TO_HOTEL_CODE[k] && (k === airport.iata.toLowerCase() || k === airport.city.toLowerCase())) return CITY_TO_HOTEL_CODE[k];
        return found;
      }, null);
    }
  }

  // Filter hotels by city code; if none found, return a generic cross-city selection
  const cityHotels = code
    ? HOTELS_DB.filter(h => h.city === code)
    : HOTELS_DB.slice(0, 6);

  // Apply date-based surge to hotel prices
  const surgeMult = checkin ? dateSurgeMultiplier(checkin) : 1.0;

  return cityHotels.map(h => {
    const pricePerNight = jitter(Math.round(h.basePrice * surgeMult), h.id.charCodeAt(3) * 7);
    return {
      id:           h.id,
      name:         h.name,
      stars:        h.stars,
      rating:       h.rating,
      ratingLabel:  h.ratingLabel,
      location:     h.location,
      amenities:    h.amenities,
      pricePerNight,
      totalPrice:   pricePerNight * nights,
      nights,
      currency:     h.currency,
      image:        h.image,
      brand:        null
    };
  });
}

// ─── Amadeus Parsers ──────────────────────────────────────────────────────────
function parseAmadeusFlights(offers, searchParams) {
  return offers.map((offer, idx) => {
    const itinerary = offer.itineraries[0];
    const segment   = itinerary.segments[0];
    const lastSeg   = itinerary.segments[itinerary.segments.length - 1];
    const airlineCode = segment.carrierCode;
    const airlineInfo = AIRLINE_MAP[airlineCode] || { name: airlineCode, website: `${airlineCode.toLowerCase()}.com` };

    const depTime = segment.departure.at.split('T')[1].slice(0, 5);
    const arrTime = lastSeg.arrival.at.split('T')[1].slice(0, 5);
    const depDate = segment.departure.at.split('T')[0];
    const arrDate = lastSeg.arrival.at.split('T')[0];

    const stops = itinerary.segments.length - 1;
    const stopAirports = itinerary.segments.slice(0, -1).map(s => s.arrival.iataCode);

    const durationRaw = itinerary.duration || 'PT0H0M';
    const durMatch = durationRaw.match(/PT(\d+H)?(\d+M)?/);
    const hours   = durMatch && durMatch[1] ? parseInt(durMatch[1]) : 0;
    const minutes = durMatch && durMatch[2] ? parseInt(durMatch[2]) : 0;
    const duration = `${hours}h ${minutes}m`;

    const price       = parseFloat(offer.price.total);
    const travelClass = offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || searchParams.class || 'ECONOMY';

    return {
      id: offer.id || `flight-${idx}`,
      airline: {
        code:    airlineCode,
        name:    airlineInfo.name,
        website: airlineInfo.website,
        logo:    `https://logo.clearbit.com/${airlineInfo.website}`
      },
      flightNumber: `${airlineCode}${segment.number}`,
      departure:    { iata: segment.departure.iataCode, time: depTime, date: depDate },
      arrival:      { iata: lastSeg.arrival.iataCode,   time: arrTime, date: arrDate },
      duration, stops, stopAirports, price,
      currency:     offer.price.currency || 'USD',
      class:        travelClass,
      seatsLeft:    offer.numberOfBookableSeats || null,
      baggage:      'See airline for baggage policy.',
      amenities:    [],
      co2:          null
    };
  });
}

function parseAmadeusHotels(hotels, nights) {
  const FALLBACK_IMAGES = [
    'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600&q=80',
    'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600&q=80',
    'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=600&q=80',
    'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=600&q=80',
    'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80',
    'https://images.unsplash.com/photo-1549294413-26f195200c16?w=600&q=80'
  ];
  return hotels.map((h, idx) => {
    const offer = h.offers?.[0];
    const price = offer ? parseFloat(offer.price.total) : null;
    return {
      id:           h.hotel?.hotelId || `hotel-${idx}`,
      name:         h.hotel?.name || 'Hotel',
      stars:        h.hotel?.rating || 3,
      rating:       null,
      ratingLabel:  null,
      location:     h.hotel?.address?.lines?.join(', ') || h.hotel?.cityCode || '',
      amenities:    h.hotel?.amenities?.slice(0, 6) || ['Wi-Fi'],
      pricePerNight: price,
      totalPrice:   price ? price * nights : null,
      nights,
      currency:     offer?.price?.currency || 'USD',
      image:        FALLBACK_IMAGES[idx % FALLBACK_IMAGES.length],
      brand:        null
    };
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Health check — expose mode info
app.get('/health', (req, res) => {
  const mode = AMADEUS_MODE ? 'amadeus' : AVIATIONSTACK_KEY ? 'aviationstack' : 'demo';
  res.json({
    status: 'ok',
    mode,
    demo:   mode === 'demo',
    ts:     new Date().toISOString(),
    // Signup links for live API keys:
    apiInfo: mode === 'demo' ? {
      aviationstack: 'https://aviationstack.com/signup/free  (free tier, no credit card)',
      amadeus:       'https://developers.amadeus.com/register (free sandbox + production)'
    } : undefined
  });
});

// Airport autocomplete
app.get('/api/airports', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  // Always try local DB first (instant, no API call needed)
  const filtered = AIRPORTS_DB.filter(a =>
    a.iata.toLowerCase().includes(q.toLowerCase()) ||
    a.name.toLowerCase().includes(q.toLowerCase()) ||
    a.city.toLowerCase().includes(q.toLowerCase())
  ).slice(0, 8);

  // If we have enough local results or we're in demo mode, return them
  if (filtered.length >= 3 || DEMO_MODE || !AMADEUS_MODE) {
    return res.json(filtered.slice(0, 8));
  }

  // Fall back to Amadeus for live data
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
    res.json(filtered); // Fallback to local results
  }
});

// Flight search
app.get('/api/flights', async (req, res) => {
  const {
    origin,
    destination,
    departure,
    return: returnDate,
    adults     = 1,
    class: travelClass = 'ECONOMY'
  } = req.query;

  if (!origin || !destination || !departure) {
    return res.json({ flights: [], error: 'Missing required parameters: origin, destination, departure' });
  }

  // ── Amadeus (production) ────────────────────────────────────────────────
  if (AMADEUS_MODE) {
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
      return res.json({ flights, demo: false, source: 'amadeus' });
    } catch (err) {
      console.error('Amadeus flight error:', err.description || err.message);
      // Fall through to demo on error
    }
  }

  // ── Aviationstack (free real-time) ──────────────────────────────────────
  if (AVIATIONSTACK_KEY) {
    try {
      const data    = await fetchAviationstackFlights(origin, destination, departure);
      const flights = parseAviationstackFlights(data, origin, destination, departure, travelClass);
      if (flights.length > 0) {
        return res.json({ flights, demo: false, source: 'aviationstack' });
      }
    } catch (err) {
      console.error('Aviationstack error:', err.message);
      // Fall through to enhanced demo
    }
  }

  // ── Enhanced Demo Mode ──────────────────────────────────────────────────
  const flights = getDemoFlights(origin, destination, departure, travelClass, parseInt(adults));
  return res.json({ flights, demo: true, source: 'demo' });
});

// Hotel search
app.get('/api/hotels', async (req, res) => {
  const { city, checkin, checkout, adults = 2 } = req.query;
  if (!city) return res.json({ hotels: [], error: 'Missing city parameter' });

  const nights = (checkin && checkout)
    ? Math.max(1, Math.round((new Date(checkout) - new Date(checkin)) / 86400000))
    : 2;

  // ── Amadeus (production) ────────────────────────────────────────────────
  if (AMADEUS_MODE) {
    try {
      const cityCode = city.toUpperCase().slice(0, 3);
      const hotelList = await amadeus.referenceData.locations.hotels.byCity.get({ cityCode });
      const hotelIds  = (hotelList.data || []).slice(0, 20).map(h => h.hotelId);

      if (hotelIds.length) {
        const offerParams = { hotelIds: hotelIds.join(','), adults: parseInt(adults) };
        if (checkin)  offerParams.checkInDate  = checkin;
        if (checkout) offerParams.checkOutDate = checkout;

        const offersResp = await amadeus.shopping.hotelOffersSearch.get(offerParams);
        const hotels     = parseAmadeusHotels(offersResp.data || [], nights);
        return res.json({ hotels, demo: false, source: 'amadeus' });
      }
    } catch (err) {
      console.error('Amadeus hotel error:', err.description || err.message);
      // Fall through to demo
    }
  }

  // ── Enhanced Demo Mode ──────────────────────────────────────────────────
  const hotels = getDemoHotels(city, checkin, checkout, parseInt(adults));
  return res.json({ hotels, demo: true, source: 'demo' });
});

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const mode = AMADEUS_MODE ? '✅ LIVE — Amadeus' : AVIATIONSTACK_KEY ? '✅ LIVE — Aviationstack' : '⚡ DEMO (enhanced)';
  console.log(`🚀 Voyage Travel Dashboard — port ${PORT}`);
  console.log(`   Mode: ${mode}`);
  if (!AMADEUS_MODE && !AVIATIONSTACK_KEY) {
    console.log(`   💡 Activate real flights: set AVIATIONSTACK_KEY env var`);
    console.log(`      Signup (free, no CC): https://aviationstack.com/signup/free`);
  }
  console.log(`   Routes loaded: ${FLIGHT_TEMPLATES.length} templates | ${AIRPORTS_DB.length} airports | ${HOTELS_DB.length} hotels`);
});
