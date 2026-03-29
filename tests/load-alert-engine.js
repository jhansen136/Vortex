/**
 * VORTEX — Alert Engine Load Test
 *
 * Tests the alert-engine edge function under simulated cron load.
 * Measures execution time and error rate at increasing user counts.
 *
 * Usage:
 *   CRON_SECRET=your_secret k6 run tests/load-alert-engine.js
 *
 * What it tests:
 *   - Alert-engine invocation time (should stay under 30s even at 100+ users)
 *   - Error rate under concurrent triggers
 *   - Response consistency
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const SUPABASE_URL  = 'https://dajqwkniduebplujkxht.supabase.co';
const SUPABASE_ANON = 'sb_publishable_GJ3cf0S5z8RxdBVu0gksbA_jlvX-hrI';
const CRON_SECRET   = __ENV.CRON_SECRET;

const alertEngineDuration = new Trend('alert_engine_duration', true);
const alertEngineErrors   = new Rate('alert_engine_errors');

export const options = {
  scenarios: {
    // Scenario 1: Single invocation baseline (what happens today)
    baseline: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      tags: { scenario: 'baseline' },
    },
    // Scenario 2: Simulate cron firing every minute with some overlap
    // (e.g. if QStash retries or fires slightly early)
    overlap: {
      executor: 'constant-vus',
      vus: 3,
      duration: '30s',
      startTime: '35s',
      tags: { scenario: 'overlap' },
    },
  },
  thresholds: {
    // Alert engine should respond within 30 seconds
    'alert_engine_duration': ['p(95)<30000'],
    // Less than 5% error rate
    'alert_engine_errors': ['rate<0.05'],
    // HTTP errors under 5%
    'http_req_failed': ['rate<0.05'],
  },
};

export default function () {
  // Function deployed with --no-verify-jwt; CRON_SECRET verified inside the function.
  // Pass via both header and query param to match either auth path.
  // dryrun=1 short-circuits all external calls (Open-Meteo, NWS, Twilio) and DB writes.
  // Never run load tests without this — it will exhaust API rate limits against real users.
  const url = `${SUPABASE_URL}/functions/v1/alert-engine?secret=${CRON_SECRET}&dryrun=1`;

  const res = http.post(url, null, {
    headers: {
      'Authorization': `Bearer ${CRON_SECRET}`,
      'Content-Type':  'application/json',
    },
    timeout: '60s',
  });

  const ok = check(res, {
    'status is 200':         (r) => r.status === 200,
    'response has ok:true':  (r) => {
      try { return JSON.parse(r.body).ok === true; } catch { return false; }
    },
    'no errors in response': (r) => {
      try { return JSON.parse(r.body).errors?.length === 0; } catch { return false; }
    },
    'responded under 30s':   (r) => r.timings.duration < 30000,
  });

  alertEngineDuration.add(res.timings.duration);
  alertEngineErrors.add(!ok);

  if (!ok) {
    console.log(`[FAIL] Status: ${res.status} | Body: ${res.body?.slice(0, 200)}`);
  } else {
    try {
      const body = JSON.parse(res.body);
      console.log(`[OK] ${res.timings.duration.toFixed(0)}ms | notified:${body.notified} called:${body.called} errors:${body.errors?.length}`);
    } catch {}
  }

  // Simulate cron interval — don't hammer continuously
  sleep(10);
}
