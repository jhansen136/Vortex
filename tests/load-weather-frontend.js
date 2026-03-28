/**
 * VORTEX — Frontend Weather Fetch Load Test
 *
 * Simulates concurrent users loading the map and fetching city weather
 * from Open-Meteo. Tests rate limit behavior and response times.
 *
 * Usage:
 *   k6 run tests/load-weather-frontend.js
 *   k6 run --vus 50 --duration 60s tests/load-weather-frontend.js
 *
 * What it tests:
 *   - Open-Meteo batch requests under concurrent user load
 *   - Response time at 10 / 25 / 50 concurrent users
 *   - Whether Open-Meteo starts rate limiting (429s)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const weatherDuration  = new Trend('weather_fetch_duration', true);
const weatherErrors    = new Rate('weather_fetch_errors');
const rateLimitHits    = new Counter('rate_limit_hits');

// Tier 1 cities — same set the frontend loads at zoom-out
// Batched in groups of 10 like the real app (BATCH_SIZE)
const CITY_BATCHES = [
  // Batch 1
  [
    { la: 32.78, lo: -96.80  }, // Dallas
    { la: 29.76, lo: -95.37  }, // Houston
    { la: 39.10, lo: -94.58  }, // Kansas City
    { la: 41.88, lo: -87.63  }, // Chicago
    { la: 44.98, lo: -93.27  }, // Minneapolis
    { la: 41.60, lo: -93.61  }, // Des Moines
    { la: 35.47, lo: -97.52  }, // Oklahoma City
    { la: 39.74, lo: -104.98 }, // Denver
    { la: 38.63, lo: -90.20  }, // St. Louis
    { la: 35.15, lo: -90.05  }, // Memphis
  ],
  // Batch 2
  [
    { la: 36.17, lo: -86.78  }, // Nashville
    { la: 33.75, lo: -84.39  }, // Atlanta
    { la: 39.77, lo: -86.16  }, // Indianapolis
    { la: 40.76, lo: -111.89 }, // Salt Lake City
    { la: 47.61, lo: -122.33 }, // Seattle
    { la: 45.52, lo: -122.68 }, // Portland
    { la: 34.05, lo: -118.24 }, // Los Angeles
    { la: 37.77, lo: -122.42 }, // San Francisco
    { la: 33.45, lo: -112.07 }, // Phoenix
    { la: 36.17, lo: -115.14 }, // Las Vegas
  ],
];

const OM_PARAMS =
  'current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
  '&hourly=cape,lifted_index,wind_speed_80m' +
  '&wind_speed_unit=mph&temperature_unit=fahrenheit&forecast_days=1&timezone=auto';

export const options = {
  stages: [
    { duration: '30s', target: 10  }, // ramp to 10 users
    { duration: '60s', target: 10  }, // hold at 10
    { duration: '30s', target: 25  }, // ramp to 25
    { duration: '60s', target: 25  }, // hold at 25
    { duration: '30s', target: 50  }, // ramp to 50
    { duration: '60s', target: 50  }, // hold at 50
    { duration: '30s', target: 0   }, // ramp down
  ],
  thresholds: {
    // Weather fetches should complete in under 5 seconds
    'weather_fetch_duration': ['p(95)<5000'],
    // Less than 2% errors
    'weather_fetch_errors': ['rate<0.02'],
    // No rate limit hits
    'rate_limit_hits': ['count<1'],
  },
};

export default function () {
  // Each simulated user loads 1-2 batches (what the map does at zoom-out)
  const batchIdx = Math.floor(Math.random() * CITY_BATCHES.length);
  const batch    = CITY_BATCHES[batchIdx];

  const lats = batch.map(c => c.la).join(',');
  const lons = batch.map(c => c.lo).join(',');
  const url  = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&${OM_PARAMS}`;

  const res = http.get(url, { timeout: '15s' });

  if (res.status === 429) {
    rateLimitHits.add(1);
    console.log(`[RATE LIMITED] VU ${__VU} hit 429 after ${res.timings.duration.toFixed(0)}ms`);
  }

  const ok = check(res, {
    'status 200':           (r) => r.status === 200,
    'returns array/object': (r) => {
      try { const b = JSON.parse(r.body); return Array.isArray(b) || typeof b === 'object'; }
      catch { return false; }
    },
    'under 5s':             (r) => r.timings.duration < 5000,
    'not rate limited':     (r) => r.status !== 429,
  });

  weatherDuration.add(res.timings.duration);
  weatherErrors.add(!ok);

  if (!ok && res.status !== 429) {
    console.log(`[FAIL] VU:${__VU} Status:${res.status} ${res.timings.duration.toFixed(0)}ms`);
  }

  // Simulate user browsing — they don't hammer refresh continuously
  sleep(Math.random() * 3 + 2); // 2-5s between fetches
}
