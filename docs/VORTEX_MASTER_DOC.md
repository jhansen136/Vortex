# VORTEX — Master Product & Technical Reference
**Last updated: April 2026**

---

## Table of Contents
1. [What is VORTEX](#1-what-is-vortex)
2. [Origin Story](#2-origin-story)
3. [Who It's For](#3-who-its-for)
4. [Platform & Availability](#4-platform--availability)
5. [Pricing & Plans](#5-pricing--plans)
6. [Features Overview](#6-features-overview)
7. [The Alert System](#7-the-alert-system)
8. [The Risk Score](#8-the-risk-score)
9. [Data Sources](#9-data-sources)
10. [Data Refresh Rates](#10-data-refresh-rates)
11. [The Alert Engine — Technical Detail](#11-the-alert-engine--technical-detail)
12. [The Weather Pre-Warm Job](#12-the-weather-pre-warm-job)
13. [Infrastructure & Architecture](#13-infrastructure--architecture)
14. [Integrations](#14-integrations)
15. [User Settings & Customization](#15-user-settings--customization)
16. [Roadmap](#16-roadmap)
17. [Support](#17-support)

---

## 1. What is VORTEX

VORTEX (vortexintel.app) is a storm intelligence platform that delivers life-safety weather alerts via phone call, push notification, and smart home integration. It is built for people who cannot afford to miss a tornado warning — campers, families, travelers, and anyone sleeping in severe weather country.

The defining feature is the **phone call alert**: when a tornado warning is issued for your location, VORTEX calls your phone. Not a push notification. An actual phone call — the kind that wakes you up at 3am when your phone is face down and Do Not Disturb is on.

Beyond calls, VORTEX provides:
- A live weather intelligence map with radar, risk overlays, wildfire tracking, and earthquake data
- A real-time 0–100 Storm Risk Score calculated from raw atmospheric data
- Background alerting for all NWS warning types, running every minute even when the app is closed
- Proximity alerts that fire when a storm is within miles of you — even if the warning is in a neighboring county

VORTEX is a Progressive Web App (PWA) — it runs in the browser, can be installed to the iPhone or Android home screen, and requires no App Store download.

---

## 2. Origin Story

VORTEX was built by Jordan Hansen, a software engineer based in Fayetteville, Arkansas.

A tornado struck a campground in Rogers, Arkansas while Jordan's family was sleeping in a camper. There was no warning — no phone alert, no sirens. They got lucky.

After the incident, Jordan researched what existed and found that every existing weather alert system relied on push notifications — the same notifications that get silenced, buried, or missed while asleep. No app called your phone.

So he built one.

VORTEX launched publicly in April 2026. The company entity is **Vortex Intel LLC**.

---

## 3. Who It's For

**Primary audience:**
- Families in tornado alley who want a backup alert that will wake them up regardless of phone state
- Campers and RV travelers who move through unfamiliar warning zones
- Anyone who has had a near-miss or knows someone who has

**Secondary audience:**
- Storm chasers and weather hobbyists who want deeper atmospheric data than consumer apps provide
- Small businesses in severe weather regions (farms, outdoor events, contractors)

**Geographic coverage:** United States only. All alerting is based on National Weather Service data, which covers the continental US.

---

## 4. Platform & Availability

VORTEX is a **Progressive Web App (PWA)**. It runs in any modern browser and can be installed directly to the home screen without going through an app store.

**To install on iPhone:**
1. Open vortexintel.app in Safari
2. Tap the Share button
3. Tap "Add to Home Screen"

**To install on Android:**
1. Open vortexintel.app in Chrome
2. Tap the three-dot menu
3. Tap "Add to Home Screen" or "Install App"

Once installed, VORTEX behaves like a native app — full screen, home screen icon, offline-capable shell.

**No App Store required.** This is intentional — it allows faster iteration, no review delays, and no 30% platform fee.

---

## 5. Pricing & Plans

| Plan | Price | Details |
|---|---|---|
| Free | $0 | Map access, manual weather lookup, no background alerts |
| Pro — Monthly | $4.99/month | Full access: calls, push alerts, background engine, all features |
| Pro — Annual | $39.99/year | Same as monthly — saves ~33% ($3.33/mo effective) |
| Free Trial | 14 days | Full Pro access, no charge until trial ends, cancel anytime |

**Free plan limitations:**
- No phone call alerts
- No push notifications
- No background alert engine (engine skips free users entirely)
- No Philips Hue integration
- Map and manual weather lookup are available

**Pro plan includes everything:**
- Tornado warning phone calls
- Flash flood warning phone calls (opt-in)
- Proximity alert calls
- All NWS push notifications
- Risk Score push alerts (pre-warning signal)
- Pressure drop push alerts (default on, user-configurable)
- Philips Hue integration (beta)
- Multi-city alert monitoring
- Background alerting runs 24/7 regardless of app state

**Billing is handled via Stripe.** Users can manage, upgrade, downgrade, or cancel directly from the app's Settings panel via the Stripe Customer Portal. Cancellation takes effect immediately — Pro reverts to Free in real time via Stripe webhook.

---

## 6. Features Overview

### Live Weather Map
The VORTEX map is the primary interface. It displays:
- **NEXRAD radar** — live composite radar updated every 2 minutes, sourced from Iowa State University's IEM tile service
- **Temperature overlay** — surface temperature across the US
- **Wind overlay** — current surface wind speed
- **Risk Score overlay** — color-coded risk intensity by region
- **Active NWS alerts** — warning polygons rendered on the map as they are issued
- **Wildfire layer** — active fire perimeters from NASA FIRMS and USFS
- **Earthquake layer** — recent seismic events from USGS

### Home Location & Pinned Cities
Users set a **home location** — the primary location used for all background alerting. Users can also **pin additional cities** and enable per-city alerts. The alert engine checks all alert-enabled locations on every run.

If a pinned city is the same as the home location, it is deduplicated — no double-alerting.

### Weather Detail Panel
Tapping any location opens a weather detail panel showing:
- Current temperature, humidity, wind speed, wind gusts
- CAPE (Convective Available Potential Energy)
- Storm Relative Helicity (SRH)
- Wind shear (surface to 80m)
- Lifted Index
- Dewpoint
- Surface pressure
- Calculated Risk Score (0–100)

### Philips Hue Integration (Beta)
VORTEX can trigger Philips Hue smart lights on alert events. Integration is configured in Settings. Currently in beta — behavior and color patterns are being finalized.

---

## 7. The Alert System

### Overview
VORTEX has two alert delivery methods: **phone calls** for life-safety events, and **push notifications** for watches, warnings, and atmospheric signals. All alerting runs server-side, every minute, even when the app is closed.

Background alerting is a **Pro-only feature**. Free users are skipped entirely by the alert engine. Expired trials are also skipped — the engine validates trial expiry in real time on every run.

---

### Phone Calls

Phone calls are made via Twilio. The call plays an alert tone (when configured) followed by a text-to-speech voice message read twice — the second repetition helps bypass iOS Do Not Disturb repeated-call logic.

**Tornado Warning Call**
Triggered when the NWS issues a Tornado Warning that includes the user's home location or an alert-enabled pinned city (matched by FIPS county code). Call fires once per active warning event. If the warning is updated or extended, no second call is placed.

Voice message: *"This is an emergency alert from Vortex Storm Intelligence. A tornado warning is active near [location]. Open the Vortex app immediately."*

**Flash Flood Warning Call**
Same trigger logic as the tornado warning call, but for Flash Flood Warnings. Disabled by default — user must opt in via Settings.

Voice message: *"This is an emergency alert from Vortex Storm Intelligence. A flash flood warning is active near [location]. Move to higher ground immediately."*

**Proximity Alert Call**
The proximity alert is VORTEX's most distinctive feature. It scans **all active tornado and flash flood warnings within the user's configured radius** — regardless of county lines. A tornado in a neighboring county, 3 miles away and heading toward you, triggers this call even if your county is not under a warning.

Two conditions must both be true before the call fires:
1. **Distance** — the storm (using NWS GPS coordinates when available, or warning polygon edge as fallback) is within the user's proximity radius (configurable: 1, 3, 5, or 10 miles — default 5)
2. **Direction** — the storm's heading is within 90° of the bearing toward the user. Storms moving away or parallel are suppressed.

When GPS data is available from NWS, the call states the actual distance: *"The tornado is 3 miles from your home and approaching."*

When only polygon data is available: *"A tornado warning is within 5 miles of your home and approaching."*

Voice message: *"This is an urgent alert from Vortex Storm Intelligence. A severe weather system is now within your proximity alert radius near [location]. Take cover immediately and open the Vortex app."*

**Daily Call Cap: 5 calls per day.** Once the cap is reached, VORTEX sends a push notification instead of calling for any additional events that day. The cap resets at midnight.

**Call cooldown:** 3 hours between proximity calls per user. NWS warning calls are deduplicated per warning event ID (not time-based).

---

### Push Notifications

Push notifications are delivered via **ntfy.sh**. Users install the ntfy app on their phone, create a private channel, and paste the channel URL into VORTEX Settings. Each alert type can be toggled on or off independently.

**NWS Warning Pushes**

| Alert Type | Default | Priority |
|---|---|---|
| Tornado Warning | ON | Max |
| Tornado Watch | ON | High |
| Severe Thunderstorm Warning | ON | High |
| Flash Flood Warning | ON | Max |
| Flood Warning | ON | Default |
| Winter Storm / Blizzard / Ice Storm Warning | ON | Default |
| High Wind / Extreme Wind Warning | ON | Default |

NWS pushes are deduplicated by NWS alert ID — the same active warning will not push more than once. Deduplication window is 48 hours.

**Risk Score Push (Pre-Warning Signal)**
Sent when the atmospheric Risk Score at the user's home location meets or exceeds their configured threshold (range: 65–100, default 65) and no active tornado or flash flood warning is already in place (to avoid double-alerting). This is VORTEX's early warning signal — conditions are dangerous before the NWS has issued anything.

Cooldown: 30 minutes per trigger.

Push format: `VORTEX: Risk Score [TIER] — [score]/100` with body explaining conditions.

Tiers: ELEVATED (65–74) / HIGH (75–89) / EXTREME (90–100)

**Pressure Drop Push**
Sent when barometric pressure drops ≥ 2.0 mb in a 30-minute window at the user's location. A rapid pressure drop is a real-time signal that a severe storm is actively approaching. The engine stores pressure readings every minute per user and compares against the reading 25–35 minutes prior.

Cooldown: 30 minutes per trigger.

Push format: `VORTEX: Rapid Pressure Drop` with the exact drop amount in mb.

Default: **ON**. Can be toggled off in Settings under Push Notifications.

---

### Cooldown & Deduplication Summary

| Alert Type | Cooldown | Daily Cap |
|---|---|---|
| Tornado Warning call | Once per NWS alert ID | 5 calls/day total |
| Flash Flood Warning call | Once per NWS alert ID | Counts toward 5/day |
| Proximity alert call | Once per NWS alert ID + 3-hour cooldown | Counts toward 5/day |
| NWS warning push | Once per NWS alert ID (48h window) | None |
| Risk Score push | 30 minutes | None |
| Pressure drop push | 30 minutes | None |

---

## 8. The Risk Score

The Risk Score (0–100) is VORTEX's composite atmospheric danger index. It is calculated every minute by the alert engine and displayed live in the app. It reflects how dangerous current conditions are at a specific location — even before any NWS warning is issued.

### Factors & Weights

| Factor | Max Points | What It Measures |
|---|---|---|
| CAPE | 35 | Convective Available Potential Energy — the energy available for thunderstorm development. Higher = more explosive storm potential. |
| Storm Helicity (SRH) | 30 | Rotational potential in the low-level atmosphere. High SRH is the primary ingredient for tornadogenesis. |
| Wind Shear | 15 | Change in wind speed/direction between surface (10m) and 80m altitude. Strong shear organizes storms and promotes rotation. |
| Lifted Index | 10 | How easily air parcels rise when lifted. Negative values = unstable atmosphere. |
| Dewpoint | 6 | Moisture at the surface. High dewpoint (≥65°F) provides the fuel storms need to sustain intensity. |
| Humidity | 4 | Surface relative humidity. Contributes to storm sustaining potential. |

**Maximum possible score: 100**

### Score Ranges

| Range | Classification | Meaning |
|---|---|---|
| 0–49 | Normal | No significant threat |
| 50–64 | Elevated | Conditions worth monitoring |
| 65–74 | High | Dangerous environment developing |
| 75–89 | High+ | Major severe weather possible |
| 90–100 | Extreme | Life-threatening conditions |

### Technical Notes on the Risk Score

- SRH is not directly available from Open-Meteo. VORTEX **calculates a proxy SRH** from CAPE and surface wind speed using the formula: `srh = (cape × 0.13) + (wind_mph × 1.8)`. This approximates low-level rotational energy in environments with known CAPE and wind.
- Wind shear is calculated as the difference between 80m wind speed and 10m wind speed, scaled by 1.5, plus a base shear contribution from surface wind.
- The Risk Score is **identical** on the client (app) and the server (alert engine and pre-warm job). The same constants and formula are used in all three places, kept in sync intentionally.
- The Risk Score reflects **forecast model conditions**, not instantaneous sensor readings. Open-Meteo updates hourly from the HRRR model. During fast-moving events, NWS warning alerts are the more reliable real-time signal.
- Although the engine recalculates the Risk Score every minute, the underlying weather inputs (CAPE, wind shear, lifted index, etc.) only change when the model updates — approximately once per hour. From a user's perspective, the score is effectively **hourly**. The 30-second recalculation interval exists so the displayed value stays fresh if the cache is updated mid-session, not because the inputs change that frequently.
- Push threshold is user-configurable from 65–100. Scores below 65 cannot be set as a trigger threshold to reduce false-alarm fatigue.

---

## 9. Data Sources

| Data | Source | Notes |
|---|---|---|
| NWS Warnings & Watches | api.weather.gov | Official National Weather Service API. Covers all warning types. Polygon geometry and storm motion data included. |
| Atmospheric Data (CAPE, wind, humidity, pressure, etc.) | Open-Meteo | Free tier: 10,000 API calls/day. HRRR model, updated ~hourly. |
| Radar | NEXRAD via Iowa Environmental Mesonet (Iowa State) | Composite reflectivity tiles. Updated every ~2 minutes. |
| Earthquakes | USGS Earthquake Hazards Program | Recent seismic events, updated every 5 minutes. |
| Wildfires | NASA FIRMS / USFS | Active fire perimeters. Updated every 5 minutes in the app. |

### Notes on NWS Data Quality
- NWS provides **GPS storm coordinates** via the `eventMotionDescription` parameter when a storm is being actively tracked. VORTEX uses these when available for precise proximity calculations.
- When GPS is not available, VORTEX falls back to the **warning polygon geometry** for distance calculation using a ray-casting point-in-polygon algorithm.
- Storm heading is parsed from the `eventMotionDescription` bearing field (e.g., "270 DEG"). If no bearing is available, VORTEX conservatively assumes the storm is approaching.

### Notes on Open-Meteo Data Quality
- Open-Meteo provides **model forecast data**, not real-time sensor data. CAPE, lifted index, and 80m wind speed are hourly forecast values from the HRRR model.
- The HRRR model runs approximately every hour. Data typically lands on Open-Meteo at ~:55–:00 past the hour.
- VORTEX's weather pre-warm job runs at **:05 past each hour** to capture freshly updated model data with a small buffer.
- Surface conditions (temperature, humidity, wind speed, pressure) are current observations and update more frequently.

---

## 10. Data Refresh Rates

### Source Refresh Rates (how often the underlying data changes)

| Data | Source Update Frequency |
|---|---|
| NWS warnings | Continuously — new alerts issued in real time as NWS forecasters act |
| Open-Meteo atmospheric (CAPE, lifted index, 80m wind) | Hourly — HRRR model cycle |
| Open-Meteo surface conditions (temp, humidity, wind, pressure) | Every few minutes (current observations) |
| NEXRAD radar | Every 2–6 minutes depending on radar site and tilt |
| USGS earthquakes | Near real-time (seconds to minutes post-event) |
| NASA wildfires | Varies — satellite passes every few hours |

### App Refresh Rates (how often VORTEX fetches new data)

| Data | App Fetch Interval |
|---|---|
| NWS warnings (map polygons) | Every 1 minute |
| Weather conditions | Every 10 minutes |
| Risk Score (displayed in app) | Every 30 seconds (recalculated from cached weather data — but inputs only change hourly, so the score is effectively hourly) |
| Radar tiles | Every 2 minutes |
| Earthquakes | Every 5 minutes |
| Wildfires | Every 5 minutes |

### Background Engine Rates (server-side, regardless of app state)

| Function | Frequency |
|---|---|
| Alert engine | Every 1 minute (checks NWS + risk scores for all Pro users) |
| Weather pre-warm job | Every hour at :05 (fetches Open-Meteo for all unique user locations) |
| Weather cache TTL | 60 minutes (pre-warm owns refresh; alert engine always reads from cache) |

---

## 11. The Alert Engine — Technical Detail

The alert engine is a Supabase Edge Function (`alert-engine`) triggered every minute by QStash (Upstash's message queue / scheduler). It is the core of VORTEX's server-side intelligence.

### What happens on each run:

**Step 1 — Fetch all active NWS alerts (CONUS)**
A single API call to `api.weather.gov/alerts/active` fetches all current tornado warnings, tornado watches, severe thunderstorm warnings, flash flood warnings, flood warnings, winter storm warnings, blizzard warnings, ice storm warnings, high wind warnings, and extreme wind warnings across the continental US.

**Step 2 — Load active Pro/trial users**
The engine loads all non-disabled users with `subscription_status` of `pro` or `trial`. Expired trials are filtered out in real time (server compares `trial_ends_at` to current timestamp). Free users are never processed.

**Step 3 — Load user data in parallel**
For all active users, the engine fetches in parallel:
- Alert thresholds (risk score threshold, proximity radius)
- Integrations (ntfy URL, Hue config, phone number)
- Preferences (which alert types are enabled per user)
- Alert-enabled pinned cities
- Recent pressure readings (last 45 minutes, for pressure drop detection)

**Step 4 — Load sent_alerts (deduplication)**
The engine fetches all alerts sent to all users in the last 48 hours. This is used to suppress duplicate notifications — the same NWS alert ID will never trigger twice per user.

**Step 5 — Weather cache lookup**
For every unique user location (home + alert cities), the engine reads from the Supabase `weather_cache` table. If a cached entry is < 60 minutes old, it is used directly. If stale or missing (e.g., new user added after the last pre-warm run), the engine falls back to a live Open-Meteo fetch and writes the result back to cache.

**Step 6 — Process each user**
For each user, the engine evaluates:

- **NWS warning alerts**: Matches alerts to the user's county FIPS code. For each matching alert not already sent, checks user preferences and queues a push notification and/or call.
- **Risk Score threshold**: If no active tornado/flood warning, calculates the risk score from cached weather data. If it meets or exceeds the user's threshold and is not in cooldown, queues a push.
- **Pressure drop**: Compares current pressure to the reading 25–35 minutes prior. If drop ≥ 2.0 mb and not in cooldown, queues a push.
- **Proximity alert**: For all tornado/flood warnings within the user's radius, checks actual distance (using GPS or polygon) and storm heading. If within range and approaching, queues a call.
- **Alert-enabled pinned cities**: Repeats the NWS alert check for each of the user's alert-enabled cities.

**Step 7 — Batch write**
All new alerts, history entries, profile updates, and pressure readings are written to Supabase in a single batched operation at the end of the run. Notifications and calls are fired before the batch write.

### Authentication
The alert engine is protected by a `CRON_SECRET` environment variable stored in Supabase secrets. QStash passes this as a Bearer token on every request. The function validates the secret before doing any work.

### Fallback Location
If a user has not set a home location, the engine uses a fallback in NW Arkansas (lat 36.08, lon -94.20) — the region where VORTEX was built and tested.

---

## 12. The Weather Pre-Warm Job

The pre-warm job is a separate Supabase Edge Function (`weather-prewarm`) that runs once per hour at **:05 past the hour**, triggered by QStash.

**Purpose:** Completely separates weather data fetching from alert checking. The alert engine runs every minute but should never need to hit Open-Meteo — the pre-warm job owns all Open-Meteo calls.

**What it does:**
1. Loads all active Pro/trial users and their alert-enabled cities
2. Deduplicates all locations to a grid precision of 0.01° (~0.7 miles)
3. Fetches Open-Meteo in parallel for all unique locations
4. Upserts results to the `weather_cache` table in Supabase
5. Cleans up cache entries older than 2 hours

**Result:** Exactly N API calls to Open-Meteo per hour, where N = number of unique user locations rounded to ~0.7mi grid. This makes Open-Meteo usage predictable and stays well within the free tier (10,000 calls/day).

**Safety net:** If a new user signs up after the last pre-warm run, the alert engine will fall back to a live Open-Meteo fetch for that user on its next run and warm the cache. The pre-warm job will pick them up on the following hour.

---

## 13. Infrastructure & Architecture

### Hosting
| Component | Service |
|---|---|
| Frontend (HTML/CSS/JS) | Vercel — global CDN, automatic deployments from GitHub |
| Backend (API, auth, DB) | Supabase — hosted PostgreSQL + Edge Functions on Deno |
| Edge Functions | Supabase Edge Runtime (Deno v2) — us-east-2 |
| Cron scheduling | QStash (Upstash) — external HTTP trigger for Supabase edge functions |

### Database (Supabase PostgreSQL)
Key tables:
- `profiles` — user account data, home location, subscription status, Stripe customer ID
- `thresholds` — per-user alert settings (risk threshold, proximity radius)
- `preferences` — per-user toggle states (which alert types are on/off)
- `integrations` — per-user ntfy URL, phone number, Hue config
- `user_cities` — pinned cities with alert-enabled flag
- `sent_alerts` — deduplication log (user_id, alert_key, sent_at)
- `weather_cache` — cached Open-Meteo data keyed by `lat.toFixed(2),lon.toFixed(2)`
- `pressure_readings` — per-user barometric pressure history (last 45 min retained)

### Edge Functions
| Function | Purpose | Auth |
|---|---|---|
| `alert-engine` | Core alerting — runs every minute | CRON_SECRET |
| `weather-prewarm` | Hourly Open-Meteo cache refresh | CRON_SECRET |
| `stripe-webhook` | Handles Stripe subscription events | Stripe webhook signature |
| `stripe-portal` | Creates Stripe billing portal session | User JWT |
| `send-welcome` | Sends welcome email via Resend on trial start | Internal |
| `send-invite` | Sends invite emails | Internal |
| `test-call` | Triggers a test Twilio call for a user | User JWT |

### Code Repository
Single-repo structure. Frontend is a single `index.html` (plus `help.html`, `admin.html`, `landing.html`) with all JS inline. Edge functions are in `supabase/functions/`. Deployed via GitHub → Vercel (frontend) and Supabase CLI (functions).

---

## 14. Integrations

### Twilio — Phone Calls
VORTEX uses Twilio's Programmable Voice API to place outbound calls. Each call plays a TwiML script:
1. Optional: NWS EAS audio tone (if configured via `TWILIO_ALERT_AUDIO_URL`)
2. Text-to-speech voice message (Twilio "alice" voice)
3. 2-second pause
4. Voice message repeated — repetition helps break through iOS Do Not Disturb when the "Emergency Bypass" or repeated-call bypass is active

### ntfy.sh — Push Notifications
ntfy is an open-source notification service. VORTEX uses it for push delivery because:
- No Apple/Google developer account required for push infrastructure
- Users control their own channel — no central subscriber management
- Works on iOS and Android
- Free tier is sufficient for current scale

Users must install the ntfy app and configure their channel URL in VORTEX Settings.

### Stripe — Billing
All subscription management is handled by Stripe:
- Payment Links for Monthly ($4.99) and Annual ($39.99) plans
- Webhook triggers subscription activation, cancellation, and trial events
- Customer Portal allows users to manage payment methods, cancel, or upgrade
- Stripe handles trial abuse prevention ("Don't offer free trials to returning customers" setting on Payment Links)

### Resend — Transactional Email
All transactional email (welcome email, password reset, email confirmation) is sent via Resend using the `noreply@vortexintel.app` address. Resend provides DKIM authentication for vortexintel.app, ensuring inbox delivery.

### Philips Hue — Smart Light Integration (Beta)
VORTEX can trigger Philips Hue smart lights on alert events. Configuration is done in Settings. Currently in beta — color patterns and behavior are being finalized and tested.

---

## 15. User Settings & Customization

### Alert Locations
- **Home location** — set via map tap or city search. Used for all background alerting by default.
- **Pinned cities** — unlimited cities can be pinned to the map. Each can have alerts enabled independently.
- **Alert-enabled cities** — up to **3 locations** (in addition to home) can have background alerting enabled. The engine monitors all alert-enabled cities on every run. Disabling one frees a slot for another.

### Phone Call Settings (Pro only)
- Phone number (required for calls)
- Tornado warning calls: ON/OFF (default ON)
- Flash flood warning calls: ON/OFF (default OFF)
- Proximity alert calls: ON/OFF (default ON)
- Proximity radius: 1 / 3 / 5 / 10 miles (default 5)

### Push Notification Settings (Pro only)
- ntfy channel URL (required for push)
- Per-type toggles:
  - Tornado Watch
  - Severe Thunderstorm Warning
  - Flash Flood / Flood Warning
  - Winter Storm / Blizzard / Ice Storm Warning
  - High Wind / Extreme Wind Warning
  - Rapid Pressure Drop (default ON)
- Risk Score push: ON/OFF + threshold slider (65–100)

### Risk Score Threshold
Configurable from 65–100. Scores below 65 cannot be set as a trigger to limit false alarms. Default: 65.

---

## 16. Roadmap

### Near-Term (Active Development)

### Future (Planned)

**Real-Time Tornado Tracking & Path Prediction**
The most significant planned enhancement. Rather than relying solely on NWS warning polygons (which are updated infrequently and lag actual storm position), VORTEX will integrate a commercial real-time storm tracking API to:
- Get live tornado GPS position updated in real time (not delayed like NWS)
- Project the storm's path forward based on current heading and speed
- Calculate whether the user's location is in the projected path
- Trigger a phone call **only when the user is in direct path**, dramatically improving alert precision

This feature is gated on subscriber volume — the commercial API cost is only justified above a certain user threshold. It will be introduced as a premium feature once scale supports it.

**Additional Roadmap Items Under Consideration**
- Hue light patterns finalized and out of beta
- Watch/warning history log in the app
- Household sharing (multiple phones on one subscription)
- B2B / multi-location plans for businesses

---

## 17. Support

**Email:** support@vortexintel.app

**In-app:** Settings → Help & FAQ (vortexintel.app/help.html)

**Company:** Vortex Intel LLC

**Website:** vortexintel.app

---

*This document reflects VORTEX as of April 2026. It is intended as the authoritative internal reference for product, technical, and business details.*
