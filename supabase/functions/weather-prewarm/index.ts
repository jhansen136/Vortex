import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Weather Pre-warm Job ───────────────────────────────────────────────────────
// Runs once per hour at :05 past the hour, right after HRRR model data lands
// on Open-Meteo (~:55-:00). Fetches fresh weather for every unique user
// location and writes to the weather_cache table.
//
// This separates weather fetching from alert checking entirely:
//   - Alert engine runs every minute, always hits cache (zero Open-Meteo calls)
//   - This job owns all Open-Meteo calls: exactly N unique locations per hour
//
// Schedule: 5 * * * * (cron-job.org or similar external trigger)
// Deploy:   npx supabase functions deploy weather-prewarm --no-verify-jwt

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET          = Deno.env.get('CRON_SECRET')!;

const FALLBACK_LAT = 36.08;
const FALLBACK_LON = -94.20;

// Risk score constants — must stay in sync with alert-engine and index.html
const SRH_CAPE_FACTOR = 0.13;
const SRH_WIND_FACTOR = 1.8;
const SHEAR_SCALE     = 1.5;
const SHEAR_BASE      = 0.3;
const RISK_CAPE_MAX   = 35;  const RISK_CAPE_DIV   = 100;
const RISK_SRH_MAX    = 30;  const RISK_SRH_DIV    = 20;
const RISK_SHEAR_MAX  = 15;  const RISK_SHEAR_DIV  = 2;
const RISK_LIFT_MAX   = 10;  const RISK_LIFT_SCALE = 1.6;
const RISK_DEW_HI = 6; const RISK_DEW_MID = 4; const RISK_DEW_LO = 2;
const RISK_HUM_HI = 4; const RISK_HUM_LO  = 2;

function dewpoint(tC: number, h: number): number {
  const a = 17.27, b = 237.7, al = (a * tC) / (b + tC) + Math.log(h / 100);
  return (b * al) / (a - al);
}

function calcRisk(cape: number, srh: number, sh: number, h: number, dF: number, lift: number): number {
  const capePts = Math.min(cape / RISK_CAPE_DIV, RISK_CAPE_MAX);
  const srhPts  = Math.min(srh  / RISK_SRH_DIV,  RISK_SRH_MAX);
  const shPts   = Math.min((sh || 0) / RISK_SHEAR_DIV, RISK_SHEAR_MAX);
  const liftPts = Math.min(Math.max(-lift * RISK_LIFT_SCALE, 0), RISK_LIFT_MAX);
  const dewPts  = dF >= 65 ? RISK_DEW_HI : dF >= 60 ? RISK_DEW_MID : dF >= 55 ? RISK_DEW_LO : 0;
  const humPts  = h  >= 70 ? RISK_HUM_HI : h  >= 55 ? RISK_HUM_LO  : 0;
  return Math.min(Math.round(capePts + srhPts + shPts + liftPts + dewPts + humPts), 100);
}

async function fetchWeather(lat: number, lon: number) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure` +
    `&hourly=cape,lifted_index,wind_speed_80m` +
    `&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=UTC&forecast_days=1`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const cur  = json.current;
  const nowISO = new Date().toISOString().slice(0, 13);
  const hi  = Math.max(0, (json.hourly?.time || []).findIndex((t: string) => t.slice(0, 13) >= nowISO));
  const tF   = Math.round(cur.temperature_2m);
  const h    = cur.relative_humidity_2m;
  const w    = Math.round(cur.wind_speed_10m);
  const w80  = Math.round(json.hourly?.wind_speed_80m?.[hi] ?? w * 1.25);
  const cape = Math.round(json.hourly?.cape?.[hi] ?? 0);
  const lift = parseFloat((json.hourly?.lifted_index?.[hi] ?? 0).toFixed(1));
  const dF   = Math.round(dewpoint((tF - 32) * 5 / 9, h) * 9 / 5 + 32);
  const sh   = Math.round(Math.max(w80 - w, 0) * SHEAR_SCALE + w * SHEAR_BASE);
  const srh  = Math.round(cape * SRH_CAPE_FACTOR + w * SRH_WIND_FACTOR);
  const risk        = calcRisk(cape, srh, sh, h, dF, lift);
  const pressure_mb = parseFloat((cur.surface_pressure ?? 0).toFixed(2));
  return { tF, h, w, cape, srh, sh, lift, dF, risk, pressure_mb };
}

serve(async (req) => {
  // Verify cron secret
  const url = new URL(req.url);
  const headerAuth = req.headers.get('authorization') === `Bearer ${CRON_SECRET}`;
  const queryAuth  = url.searchParams.get('secret') === CRON_SECRET;
  if (!headerAuth && !queryAuth) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results: { locations: number; fetched: number; skipped: number; errors: string[] } = {
    locations: 0,
    fetched:   0,
    skipped:   0,
    errors:    [],
  };

  try {
    const now = new Date().toISOString();

    // Load all active Pro/trial users
    const { data: users, error: usersErr } = await supa
      .from('profiles')
      .select('id, home_lat, home_lng, subscription_status, trial_ends_at')
      .eq('disabled', false)
      .in('subscription_status', ['pro', 'trial']);

    if (usersErr) throw new Error(`profiles: ${usersErr.message}`);

    const activeUsers = (users || []).filter((u: any) =>
      u.subscription_status === 'pro' ||
      (u.subscription_status === 'trial' && u.trial_ends_at && u.trial_ends_at > now)
    );

    if (!activeUsers.length) {
      return new Response(JSON.stringify({ ok: true, ...results }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ids = activeUsers.map((u: any) => u.id);

    // Load alert-enabled pinned cities for these users
    const { data: alertCities } = await supa
      .from('user_cities')
      .select('alert_lat, alert_lng, lat, lng')
      .eq('alert_enabled', true)
      .in('user_id', ids);

    // Build deduplicated location set (same rounding as alert-engine)
    const homeLocKeys = activeUsers.map((u: any) => {
      const lat = u.home_lat ?? FALLBACK_LAT;
      const lon = u.home_lng ?? FALLBACK_LON;
      return `${lat.toFixed(2)},${lon.toFixed(2)}`;
    });
    const cityLocKeys = (alertCities || []).flatMap((c: any) => {
      const lat = c.alert_lat ?? c.lat;
      const lon = c.alert_lng ?? c.lng;
      if (!lat || !lon) return [];
      return [`${lat.toFixed(2)},${lon.toFixed(2)}`];
    });
    const uniqueLocations = [...new Set([...homeLocKeys, ...cityLocKeys])];
    results.locations = uniqueLocations.length;

    const fetchedAt = new Date().toISOString();

    // Fetch all locations in parallel, upsert to weather_cache
    await Promise.all(
      uniqueLocations.map(async (locKey: string) => {
        const [lat, lon] = locKey.split(',').map(Number);
        try {
          const wx = await fetchWeather(lat, lon);
          const { error: upsertErr } = await supa.from('weather_cache').upsert({
            location_key: locKey,
            data:         wx,
            fetched_at:   fetchedAt,
          });
          if (upsertErr) {
            results.errors.push(`upsert:${locKey}: ${upsertErr.message}`);
          } else {
            results.fetched++;
          }
        } catch (e: any) {
          results.errors.push(`fetch:${locKey}: ${e.message}`);
        }
      })
    );

    // Clean up stale cache entries older than 2 hours (shouldn't happen, but tidy)
    const cutoff2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await supa.from('weather_cache').delete().lt('fetched_at', cutoff2h);

  } catch (e: any) {
    results.errors.push(e.message);
    return new Response(JSON.stringify({ ok: false, ...results }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
