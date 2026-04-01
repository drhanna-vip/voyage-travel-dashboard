# ✈️ Voyage — Premium Travel Dashboard

A world-class, executive-grade travel search dashboard powered by the **Amadeus GDS** — the same underlying data used by Expedia, Orbitz, Delta, United, Marriott, and Hilton.

---

## ⚡ What This Is

Voyage is a full-stack travel search engine SPA featuring:
- **Real-time flight search** across all major airlines via Amadeus API
- **Hotel search** with live offers
- **Premium UI** — Google Flights × Four Seasons aesthetic
- **Deep links** to Google Flights, Expedia, Kayak, Orbitz, and direct airline booking
- **Demo mode** — works beautifully with no API key (pre-loaded mock data)
- **Fully responsive** — mobile, tablet, desktop

---

## 🚀 Quick Start (Local)

```bash
cd /root/clawd/travel-dashboard
npm install
node server.js
# → http://localhost:3030
```

Works immediately in **demo mode** (no API key required).

---

## 🔑 Get Your Amadeus API Key (Free, 2 minutes)

1. Go to **[developers.amadeus.com](https://developers.amadeus.com)**
2. Click **Sign Up** (free)
3. Create a new app — select **Self-Service** tier
4. Copy your **Client ID** and **Client Secret**
5. Free tier includes: Flight Offers Search + Hotel List + Hotel Offers ✅

---

## 🌐 Deploy to Render

### Option A: One-click via render.yaml (recommended)

1. Push this repo to GitHub (see Git Setup below)
2. Go to **[render.com](https://render.com)** → New → Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — click **Deploy**
5. In Render dashboard → Environment → add:
   - `AMADEUS_CLIENT_ID` = your key
   - `AMADEUS_CLIENT_SECRET` = your secret
6. Redeploy → Live with real data 🎉

### Option B: Manual

- **Build command:** `npm install`
- **Start command:** `node server.js`
- **Environment:** Node.js

---

## 🔧 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AMADEUS_CLIENT_ID` | Optional* | Amadeus API client ID |
| `AMADEUS_CLIENT_SECRET` | Optional* | Amadeus API client secret |
| `PORT` | No | Server port (default: 3030) |

*Without these, app runs in demo mode with mock data.

---

## 🔗 How Deep Links Work

Every flight result shows "Book on:" buttons that open directly to the right search on each platform — pre-filled with your exact origin, destination, dates, passengers, and cabin class:

- **Google Flights** — `/travel/flights?q=flights+from+JFK+to+LAX+2026-05-01`
- **Expedia** — `/Flights-Search?trip=roundtrip&leg1=from:JFK,to:LAX,departure:2026-05-01...`
- **Kayak** — `/flights/JFK-LAX/2026-05-01/2026-05-08/1adults`
- **Orbitz** — same format as Expedia
- **Direct Airline** — AA→aa.com, DL→delta.com, UA→united.com, etc.

Hotels link directly to Booking.com, Expedia, Hotels.com, and brand sites (Marriott, Hilton, Hyatt, IHG).

---

## 📁 File Structure

```
travel-dashboard/
├── server.js          # Express backend + Amadeus integration
├── package.json
├── render.yaml        # Render deployment config
├── .gitignore
├── README.md
└── public/
    └── index.html     # Full premium SPA
```

---

## 🏗 Tech Stack

- **Backend:** Node.js + Express 4
- **Travel Data:** Amadeus GDS (same data as Expedia, Orbitz, Delta, Marriott)
- **Security:** Helmet + CORS + express-rate-limit (100 req/15min)
- **Frontend:** Pure HTML/CSS/JS — no framework, no build step
- **Fonts:** Playfair Display + Inter (Google Fonts)
- **Images:** Unsplash (hero rotation) + Clearbit (airline logos)

---

Built for **Dr. George Hanna / VIP Medical Group** — executive-grade travel search.
