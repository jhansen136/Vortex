import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET          = Deno.env.get('CRON_SECRET')!;
const TWILIO_SID           = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const TWILIO_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN')  || '';
const TWILIO_FROM          = Deno.env.get('TWILIO_FROM_NUMBER') || '';
// Optional: URL to NWS EAS audio file — set via: npx supabase secrets set TWILIO_ALERT_AUDIO_URL=https://...
const TWILIO_AUDIO_URL     = Deno.env.get('TWILIO_ALERT_AUDIO_URL') || '';

// NW Arkansas fallback (used for users who haven't set a home location yet)
const FALLBACK_LAT = 36.08;
const FALLBACK_LON = -94.20;
// UGC zone IDs for NW Arkansas counties (Benton, Washington, Madison, Carroll, Boone)
const FALLBACK_UGC = ['ARC007', 'ARC143', 'ARC087', 'ARC015', 'ARC009'];

// NWS event types to monitor
const NWS_EVENTS = [
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
  'Flood Warning',
  'Winter Storm Warning',
  'Blizzard Warning',
  'Ice Storm Warning',
  'High Wind Warning',
  'Extreme Wind Warning',
];

// Push cooldown — suppress repeated threshold / pressure pushes within 30 min
const THRESHOLD_COOLDOWN_MS = 30 * 60 * 1000;

// Call cooldown — suppress repeated proximity calls within 3 hours
const CALL_COOLDOWN_MS = 3 * 60 * 60 * 1000;

// Daily call cap per user
const DAILY_CALL_CAP = 5;

// Minimum pressure drop (mb in 30 min) to trigger a pressure push
const PRESSURE_DROP_THRESHOLD = 2.0;

// Risk score constants — must stay in sync with client-side values in index.html
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
    `&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=UTC&forecast_days=1`
  );
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

// ── Twilio voice call ──────────────────────────────────────────────────────────
// Plays the NWS EAS audio (if TWILIO_ALERT_AUDIO_URL is set) then a TTS message.
// When you have the NWS recording: npx supabase secrets set TWILIO_ALERT_AUDIO_URL=https://...
async function makeCall(phone: string, type: 'warning' | 'flood' | 'proximity' | 'pressure', locationName?: string): Promise<void> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return;

  const audioTag = TWILIO_AUDIO_URL
    ? `<Play loop="1">${TWILIO_AUDIO_URL}</Play>`
    : '';

  const loc = locationName ? `near ${locationName}` : 'for your home area';
  const tts = type === 'warning'
    ? `This is an emergency alert from Vortex Storm Intelligence. A tornado warning is active ${loc}. Open the Vortex app immediately.`
    : type === 'flood'
    ? `This is an emergency alert from Vortex Storm Intelligence. A flash flood warning is active ${loc}. Move to higher ground immediately.`
    : type === 'proximity'
    ? `This is an urgent alert from Vortex Storm Intelligence. A severe weather system is now within your proximity alert radius ${loc}. Take cover immediately and open the Vortex app.`
    : `This is a Vortex weather alert. Rapid pressure drop detected ${loc}. A severe storm may be approaching. Open the Vortex app for current conditions.`;

  // Message repeated twice — second repetition helps iOS DND repeated-calls bypass
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${audioTag}
  <Say voice="alice">${tts}</Say>
  <Pause length="2"/>
  <Say voice="alice">${tts}</Say>
</Response>`;

  const creds = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To:    phone,
        From:  TWILIO_FROM,
        Twiml: twiml,
      }).toString(),
    }
  );
}

// ── Geo helpers for polygon proximity ─────────────────────────────────────────
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Returns distance (miles) from point to nearest vertex of a polygon ring.
// Returns 0 if the point is inside the polygon (ray-casting).
function distToPolygonRingMiles(lat: number, lon: number, ring: number[][]): number {
  // Ray-casting point-in-polygon
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // [lon, lat]
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  if (inside) return 0;
  // Outside — return min distance to any edge (not just vertices).
  // Projecting onto the segment catches cases where the user is near
  // the middle of an edge but far from both endpoints.
  let minDist = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [aLon, aLat] = ring[j];
    const [bLon, bLat] = ring[i];
    // Parameterise closest point on segment AB to P using dot product.
    // Work in a flat local coordinate space (degrees); accurate enough at these scales.
    const dx = bLon - aLon, dy = bLat - aLat;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((lon - aLon) * dx + (lat - aLat) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cLon = aLon + t * dx, cLat = aLat + t * dy;
    minDist = Math.min(minDist, haversineMiles(lat, lon, cLat, cLon));
  }
  return minDist;
}

// Extract the outermost ring(s) from a GeoJSON geometry and return min distance
function distToGeometryMiles(lat: number, lon: number, geometry: any): number {
  if (!geometry) return Infinity;
  let minDist = Infinity;
  if (geometry.type === 'Polygon') {
    minDist = distToPolygonRingMiles(lat, lon, geometry.coordinates[0]);
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      minDist = Math.min(minDist, distToPolygonRingMiles(lat, lon, poly[0]));
    }
  }
  return minDist;
}

// Bearing (degrees 0-360) from point A to point B
function bearingBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y   = Math.sin(Δλ) * Math.cos(φ2);
  const x   = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Returns true if the storm in `alert` is moving toward (userLat, userLon).
// Uses bearing from eventMotionDescription vs. bearing from storm to user.
// If bearing data is missing, returns true (conservative — assume approaching).
function isStormApproaching(userLat: number, userLon: number, alert: any): boolean {
  const gps = parseStormGPS(alert);
  if (!gps) return true; // no GPS — can't tell, assume approaching
  const emd: string = (alert.properties?.parameters?.eventMotionDescription || [])[0] || '';
  const degMatch = emd.match(/(\d+)\s*DEG/i);
  if (!degMatch) return true; // no bearing — assume approaching
  // NWS MOT bearing is the direction FROM which the storm is moving (wind convention).
  // Add 180° to convert to the direction the storm is heading (TO bearing).
  const stormBearing  = (parseInt(degMatch[1]) + 180) % 360;
  const bearingToUser = bearingBetween(gps.lat, gps.lon, userLat, userLon);
  const diff = Math.abs(((stormBearing - bearingToUser) + 360) % 360);
  const angleDiff = diff > 180 ? 360 - diff : diff;
  return angleDiff < 90; // within 90° → storm heading into user's half of map
}

// Pre-filter allAlerts to tornado/flood warnings whose polygon centroid is
// within (radiusMiles + buffer) of the given point. Fast bounding-box check
// so we don't run haversine against every alert in the country.
function alertsNearPoint(lat: number, lon: number, radiusMiles: number, alerts: any[]): any[] {
  const buffer   = 15; // extra miles beyond proximity radius for bounding box
  const latDelta = (radiusMiles + buffer) / 69;
  const lonDelta = (radiusMiles + buffer) / (69 * Math.cos(lat * Math.PI / 180));
  return alerts.filter((f: any) => {
    const event = f.properties?.event || '';
    if (event !== 'Tornado Warning') return false;
    if (!f.geometry) return false;
    const geo  = f.geometry;
    const ring: number[][] = geo.type === 'Polygon'
      ? geo.coordinates[0]
      : geo.type === 'MultiPolygon' ? geo.coordinates[0][0] : [];
    if (!ring.length) return false;
    const cLon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
    const cLat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
    return Math.abs(cLat - lat) <= latDelta && Math.abs(cLon - lon) <= lonDelta;
  });
}

// Parse storm GPS coordinates from NWS eventMotionDescription parameter.
// Format: "TIMESTAMP...DEGdeg...KTkt...lat,lon"
// Returns { lat, lon } if found, null otherwise.
function parseStormGPS(alert: any): { lat: number; lon: number } | null {
  const emd: string = (alert.properties?.parameters?.eventMotionDescription || [])[0] || '';
  const matches = [...emd.matchAll(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const lat = parseFloat(last[1]);
  const lon = parseFloat(last[2]);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

// Distance from a point to an NWS alert.
// Uses storm GPS (eventMotionDescription) when available — this is the actual
// storm location. Falls back to polygon edge distance when GPS is not present.
function distToAlertMiles(userLat: number, userLon: number, alert: any): { dist: number; method: 'gps' | 'polygon' } {
  const gps = parseStormGPS(alert);
  if (gps) {
    return { dist: haversineMiles(userLat, userLon, gps.lat, gps.lon), method: 'gps' };
  }
  return { dist: distToGeometryMiles(userLat, userLon, alert.geometry), method: 'polygon' };
}

serve(async (req) => {
  // Verify cron secret — check Authorization header or ?secret= query param
  const url = new URL(req.url);
  const headerAuth = req.headers.get('authorization') === `Bearer ${CRON_SECRET}`;
  const queryAuth  = url.searchParams.get('secret') === CRON_SECRET;
  if (!headerAuth && !queryAuth) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Load test dry-run mode — ?dryrun=1 skips all external API calls and DB writes.
  // Use this for load testing so Open-Meteo / Twilio / NWS are never hit.
  if (url.searchParams.get('dryrun') === '1') {
    return new Response(JSON.stringify({ ok: true, dryrun: true, notified: 0, called: 0, errors: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results: { notified: number; called: number; errors: string[] } = { notified: 0, called: 0, errors: [] };

  try {
    // ── 1. Fetch all active NWS tornado + flood warnings (CONUS) ─────────────
    const eventParam = NWS_EVENTS.map(e => encodeURIComponent(e)).join(',');
    const nwsRes = await fetch(
      `https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=${eventParam}`,
      {
        headers: { 'User-Agent': 'VORTEX Storm Intelligence (support@vortexintel.app)' },
        signal: AbortSignal.timeout(12000),
      }
    );
    if (!nwsRes.ok) throw new Error(`NWS API error: ${nwsRes.status}`);
    const nwsJson   = await nwsRes.json();
    const allAlerts = nwsJson.features || [];

    // ── 2. Load Pro/trial users only — free users don't get background alerts ─
    const now = new Date().toISOString();
    const { data: allUsers, error: usersErr } = await supa
      .from('profiles')
      .select('id, display_name, home_lat, home_lng, home_fips, home_label, phone, last_threshold_call_at, subscription_status, trial_ends_at')
      .eq('disabled', false)
      .in('subscription_status', ['pro', 'trial']);
    // Filter out expired trials server-side
    const users = (allUsers || []).filter((u: any) =>
      u.subscription_status === 'pro' ||
      (u.subscription_status === 'trial' && u.trial_ends_at && u.trial_ends_at > now)
    );

    if (usersErr || !users?.length) {
      return new Response(JSON.stringify({ ok: true, users: 0 }), { status: 200 });
    }

    const ids = users.map((u: any) => u.id);
    const cutoff45m = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const [{ data: thresholds }, { data: integrations }, { data: preferences }, { data: alertCities }, { data: recentPressure }] = await Promise.all([
      supa.from('thresholds').select('*').in('user_id', ids),
      supa.from('integrations').select('*').in('user_id', ids),
      supa.from('preferences').select('*').in('user_id', ids),
      supa.from('user_cities').select('id, user_id, name, lat, lng, alert_lat, alert_lng, alert_fips').eq('alert_enabled', true).in('user_id', ids),
      supa.from('pressure_readings').select('user_id, recorded_at, pressure_mb').in('user_id', ids).gte('recorded_at', cutoff45m).order('recorded_at', { ascending: false }),
    ]);

    // ── 3. Load recent sent_alerts (last 48h for deduplication) ──────────────
    const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: recentSent } = await supa
      .from('sent_alerts')
      .select('user_id, alert_key, sent_at')
      .gte('sent_at', cutoff48h);

    // ── 4. Weather cache — persistent in Supabase, 60-min TTL ────────────────
    // Primary refresh is handled by the weather-prewarm job (runs at :05/hr).
    // This engine should always hit cache. The TTL + fallback fetch here are a
    // safety net for new users added after the last prewarm run, or if prewarm
    // fails. Open-Meteo updates hourly so a 60-min TTL has no accuracy impact.
    const WEATHER_TTL_MS = 60 * 60 * 1000;
    const wxCache = new Map<string, any>();

    async function getWeather(lat: number, lon: number) {
      const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      if (wxCache.has(key)) return wxCache.get(key);

      // Check Supabase persistent cache
      const { data: cached } = await supa
        .from('weather_cache')
        .select('data, fetched_at')
        .eq('location_key', key)
        .maybeSingle();

      if (cached && (Date.now() - new Date(cached.fetched_at).getTime()) < WEATHER_TTL_MS) {
        wxCache.set(key, cached.data);
        return cached.data;
      }

      // Cache miss or stale — fetch from Open-Meteo
      const wx = await fetchWeather(lat, lon);
      wxCache.set(key, wx);

      // Upsert back to Supabase (fire and forget)
      supa.from('weather_cache')
        .upsert({ location_key: key, data: wx, fetched_at: new Date().toISOString() })
        .then(() => {}, () => {});

      return wx;
    }

    // Pre-fetch all unique user locations in parallel before the user loop.
    // Includes home locations and alert-enabled city locations.
    const homeLocKeys = users.map((u: any) => {
      const lat = u.home_lat ?? FALLBACK_LAT;
      const lon = u.home_lng ?? FALLBACK_LON;
      return `${lat.toFixed(2)},${lon.toFixed(2)}`;
    });
    const cityLocKeys = (alertCities || []).map((c: any) => {
      const lat = c.alert_lat ?? c.lat;
      const lon = c.alert_lng ?? c.lng;
      return `${lat.toFixed(2)},${lon.toFixed(2)}`;
    });
    const uniqueLocations = [...new Set([...homeLocKeys, ...cityLocKeys])];
    await Promise.all(
      uniqueLocations.map((locKey: string) => {
        const [la, lo] = locKey.split(',').map(Number);
        return getWeather(la, lo).catch(() => {});
      })
    );

    // ── 5. Process each user ──────────────────────────────────────────────────
    const newAlerts: { user_id: string; alert_key: string }[] = [];
    const historyAlerts: { user_id: string; event: string; area: string; alert_key: string; notified_push: boolean; notified_call: boolean; }[] = [];
    const profileUpdates: { id: string; last_threshold_call_at: string }[] = [];
    const pressureInserts: { user_id: string; pressure_mb: number; recorded_at: string }[] = [];

    for (const user of users) {
      const th   = (thresholds   || []).find((t: any) => t.user_id === user.id);
      const intg = (integrations || []).find((i: any) => i.user_id === user.id);
      const pref = (preferences  || []).find((p: any) => p.user_id === user.id);

      const homeLat  = user.home_lat  ?? FALLBACK_LAT;
      const homeLon  = user.home_lng  ?? FALLBACK_LON;
      const homeFips = user.home_fips ?? null;
      const phone    = (user.phone || '').trim();

      // UGC zone IDs (e.g. "ARC143") — matched against geocode.UGC in NWS alerts.
      // home_fips stores the zone ID from the NWS county URL path (set on home location save).
      // Falls back to NW Arkansas counties for users who haven't set a home location.
      const userUGC: string[] = homeFips ? [homeFips] : FALLBACK_UGC;

      const userAlerts = allAlerts.filter((f: any) => {
        const ugc: string[] = f.properties?.geocode?.UGC || [];
        return ugc.some((code: string) => userUGC.includes(code));
      });

      const userSent     = (recentSent || []).filter((a: any) => a.user_id === user.id);
      const hasSent      = (key: string) => userSent.some((a: any) => a.alert_key === key);
      const sentRecently = (key: string) => userSent.some((a: any) =>
        a.alert_key === key && new Date(a.sent_at).getTime() > Date.now() - THRESHOLD_COOLDOWN_MS
      );
      // True if a call for this NWS alert ID is already queued in this run.
      // Prevents double-calling when a warning is both in the user's county and within proximity radius.
      const callAlreadyQueued = (alertId: string) => toSend.some(a => a.call && a.key === `nws:${alertId}`);

      // 3-hour cooldown check for threshold calls
      const lastCallAt      = user.last_threshold_call_at ? new Date(user.last_threshold_call_at).getTime() : 0;
      const thresholdCallOk = (Date.now() - lastCallAt) > CALL_COOLDOWN_MS;

      // Daily call cap — count call: prefixed keys sent in the last 24 hours
      const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
      let dailyCallCount = userSent.filter((a: any) =>
        a.alert_key.startsWith('call:') && new Date(a.sent_at).getTime() > cutoff24h
      ).length;

      type AlertItem = {
        key: string; title: string; body: string;
        priority: string; tags: string;
        event?: string; area?: string;
        call?: boolean; callType?: 'warning' | 'threshold' | 'flood' | 'proximity';
        callLocation?: string;
      };
      const toSend: AlertItem[] = [];

      // ── NWS alerts ───────────────────────────────────────────────────────────
      // Trigger logic:
      //   Tornado Warning          → push (max) + call (if call_tornado_enabled)
      //   Tornado Watch            → push only (if push_tornado_watch_enabled)
      //   Severe Thunderstorm Warn → push only (if push_tstorm_enabled)
      //   Flash Flood Warning      → push (if push_flood_enabled) + call (if call_flood_enabled)
      //   Flood Warning            → push only (if push_flood_enabled)
      //   Winter Storm / Blizzard / Ice Storm → push only (if push_winter_enabled)
      //   High Wind / Extreme Wind → push only (if push_wind_enabled)
      for (const alert of userAlerts) {
        const key          = `nws:${alert.properties.id}`;
        const event        = alert.properties.event;
        const isTornado    = event === 'Tornado Warning';
        const isTorWatch   = event === 'Tornado Watch';
        const isTstorm     = event === 'Severe Thunderstorm Warning';
        const isFlashFlood = event === 'Flash Flood Warning';
        const isFlood      = event === 'Flood Warning';
        const isWinter     = ['Winter Storm Warning', 'Blizzard Warning', 'Ice Storm Warning'].includes(event);
        const isWind       = ['High Wind Warning', 'Extreme Wind Warning'].includes(event);

        if (hasSent(key)) continue;

        // Preference gates
        if (isTorWatch   && pref?.push_tornado_watch_enabled === false) continue;
        if (isTstorm     && pref?.push_tstorm_enabled        === false) continue;
        if ((isFlashFlood || isFlood) && pref?.push_flood_enabled  === false) continue;
        if (isWinter     && pref?.push_winter_enabled        === false) continue;
        if (isWind       && pref?.push_wind_enabled          === false) continue;

        const priority = (isTornado || isFlashFlood) ? 'max'
                       : (isTorWatch || isTstorm)    ? 'high'
                       : 'default';
        const tags     = isTornado                   ? 'rotating_light,sos'
                       : (isFlashFlood || isFlood)   ? 'rain,warning'
                       : (isWinter)                  ? 'snowflake,warning'
                       : (isWind)                    ? 'wind_face,warning'
                       : 'warning';

        const homeLabel = user.home_label || 'your home location';
        toSend.push({
          key,
          title:    `⚠️ ${event}`,
          body:     `${event} is active near ${homeLabel}. Open VORTEX for details.`,
          priority,
          tags,
          event,
          area:     alert.properties.areaDesc || '',
          call:     (isTornado    && !!phone && (pref?.call_tornado_enabled !== false)) ||
                    (isFlashFlood && !!phone && (pref?.call_flood_enabled === true)),
          callType: isFlashFlood ? 'flood' : 'warning',
        });
      }

      // ── Risk Score threshold push (pre-warning signal, no call) ─────────────
      // Triggers when Risk Score ≥ user's configured threshold and no NWS warning
      // is already active for their location (avoid double-alerting).
      const hasActiveWarning = userAlerts.some((f: any) =>
        ['Tornado Warning', 'Flash Flood Warning'].includes(f.properties?.event)
      );
      if (th && !hasActiveWarning) {
        try {
          const wx = await getWeather(homeLat, homeLon);
          const riskLimit = th.risk_score ?? 65;
          const riskKey   = `threshold:risk:${Math.floor(Date.now() / THRESHOLD_COOLDOWN_MS)}`;
          if (wx.risk >= riskLimit && !sentRecently(riskKey)) {
            const tier = wx.risk >= 90 ? 'EXTREME' : wx.risk >= 75 ? 'HIGH' : 'ELEVATED';
            toSend.push({
              key:      riskKey,
              title:    `VORTEX: Risk Score ${tier} — ${wx.risk}/100`,
              body:     `Storm Risk Score is ${wx.risk}/100 at your home location — conditions are dangerous. No active warning yet. Monitor closely.`,
              priority: wx.risk >= 75 ? 'high' : 'default',
              tags:     'warning,chart_increasing',
              event:    'Risk Score Alert',
              area:     'Your Location',
              call:     false,
            });
          }

          // ── Pressure tendency push ─────────────────────────────────────────
          // Trigger when pressure drops ≥ 2mb in the last 30 min.
          const userPressureReadings = (recentPressure || [])
            .filter((r: any) => r.user_id === user.id)
            .sort((a: any, b: any) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());

          // Store new reading for next run (only when valid — 0 means surface_pressure was absent)
          if (wx.pressure_mb > 0) {
            pressureInserts.push({ user_id: user.id, pressure_mb: wx.pressure_mb, recorded_at: new Date().toISOString() });
          }

          // Compare current to reading ~25-35 min ago
          const old30m = userPressureReadings.find((r: any) => {
            const age = Date.now() - new Date(r.recorded_at).getTime();
            return age >= 25 * 60 * 1000 && age <= 35 * 60 * 1000;
          });
          if (old30m && wx.pressure_mb > 0 && old30m.pressure_mb > 0 && (pref?.push_pressure_drop_enabled ?? true)) {
            const drop = old30m.pressure_mb - wx.pressure_mb;
            const pressKey = `pressure:drop:${Math.floor(Date.now() / THRESHOLD_COOLDOWN_MS)}`;
            if (drop >= PRESSURE_DROP_THRESHOLD && !sentRecently(pressKey)) {
              toSend.push({
                key:      pressKey,
                title:    `VORTEX: Rapid Pressure Drop`,
                body:     `Barometric pressure has dropped ${drop.toFixed(1)} mb in 30 minutes at your home location. A severe storm may be approaching.`,
                priority: 'high',
                tags:     'warning,cloud_with_rain',
                event:    'Pressure Drop Alert',
                area:     'Your Location',
                call:     false,
              });
            }
          }
        } catch (e: any) {
          results.errors.push(`weather:${user.id}: ${e.message}`);
        }
      }

      // ── Proximity alert call ──────────────────────────────────────────────────
      // Checks ALL active tornado/flood warnings within the user's proximity
      // radius, not just those in their county. May be the first and only call
      // a user receives (e.g. cross-county tornado). Also gates on approaching.
      if (!!phone && (pref?.call_threshold_enabled === true) && thresholdCallOk && th) {
        const proximityMiles  = th.proximity_miles ?? 5;
        const nearbyAlerts    = alertsNearPoint(homeLat, homeLon, proximityMiles, allAlerts);
        for (const alert of nearbyAlerts) {
          const event        = alert.properties?.event;
          const isTornado    = event === 'Tornado Warning';
          const isFlashFlood = event === 'Flash Flood Warning';
          if (!alert.geometry) continue;

          // Respect per-type call preferences for proximity calls too
          if (isFlashFlood && pref?.call_flood_enabled !== true) continue;

          const proxKey = `proximity:${alert.properties.id}`;
          if (hasSent(proxKey)) continue;

          // Skip if a call for this alert is already queued via county match — prevent double-call
          if (callAlreadyQueued(alert.properties.id)) continue;

          const { dist, method } = distToAlertMiles(homeLat, homeLon, alert);
          if (dist > proximityMiles) continue;

          // Only call if storm is heading toward the user
          if (!isStormApproaching(homeLat, homeLon, alert)) continue;

          const distDesc = method === 'gps'
            ? `The tornado is ${dist < 1 ? 'less than 1' : Math.round(dist)} mile${dist < 2 ? '' : 's'} from your home and approaching`
            : `A ${event.toLowerCase()} is within ${proximityMiles} miles of your home and approaching`;
          toSend.push({
            key:      proxKey,
            title:    `⚠️ ${event} — APPROACHING YOUR LOCATION`,
            body:     `${distDesc}. Take cover immediately.`,
            priority: 'max',
            tags:     isTornado ? 'rotating_light,sos' : 'rain,warning',
            event,
            area:     'Your Location',
            call:     true,
            callType: 'proximity',
          });
        }
      }

      // ── Alert-enabled pinned cities ───────────────────────────────────────────
      const userAlertCities = (alertCities || []).filter((c: any) => c.user_id === user.id);
      for (const city of userAlertCities) {
        const cityLat  = city.alert_lat ?? city.lat;
        const cityLon  = city.alert_lng ?? city.lng;
        if (!cityLat || !cityLon) continue; // skip cities with no coordinates
        const cityUGC = city.alert_fips ? [city.alert_fips] : [];

        // NWS alerts matching this city's county (by UGC zone ID e.g. "ARC143")
        const cityNwsAlerts = cityUGC.length ? allAlerts.filter((f: any) => {
          const ugc: string[] = f.properties?.geocode?.UGC || [];
          return ugc.some((code: string) => cityUGC.includes(code));
        }) : [];
        if (cityNwsAlerts.length) {
          for (const alert of cityNwsAlerts) {
            const key          = `nws:${alert.properties.id}:city:${city.id}`;
            const event        = alert.properties.event;
            const isTornado    = event === 'Tornado Warning';
            const isFlashFlood = event === 'Flash Flood Warning';
            const isTorWatch   = event === 'Tornado Watch';
            const isTstorm     = event === 'Severe Thunderstorm Warning';
            const isFlood      = event === 'Flood Warning';
            const isWinter     = ['Winter Storm Warning', 'Blizzard Warning', 'Ice Storm Warning'].includes(event);
            const isWind       = ['High Wind Warning', 'Extreme Wind Warning'].includes(event);

            if (hasSent(key)) continue;
            if (isTorWatch   && pref?.push_tornado_watch_enabled === false) continue;
            if (isTstorm     && pref?.push_tstorm_enabled        === false) continue;
            if ((isFlashFlood || isFlood) && pref?.push_flood_enabled === false) continue;
            if (isWinter     && pref?.push_winter_enabled        === false) continue;
            if (isWind       && pref?.push_wind_enabled          === false) continue;

            const priority = (isTornado || isFlashFlood) ? 'max' : (isTorWatch || isTstorm) ? 'high' : 'default';
            const tags     = isTornado ? 'rotating_light,sos' : (isFlashFlood || isFlood) ? 'rain,warning' : isWinter ? 'snowflake,warning' : isWind ? 'wind_face,warning' : 'warning';

            toSend.push({
              key,
              title:    `⚠️ ${event} — ${city.name}`,
              body:     `${event} is active near ${city.name}. Open VORTEX for details.`,
              priority, tags,
              event,
              area:     city.name,
              call:     (isTornado    && !!phone && (pref?.call_tornado_enabled !== false)) ||
                        (isFlashFlood && !!phone && (pref?.call_flood_enabled === true)),
              callType: isFlashFlood ? 'flood' : 'warning',
              callLocation: city.name,
            });
          }
        }

        // Risk Score threshold push for this city (no call — push only for cities)
        const cityHasActiveWarning = cityNwsAlerts?.some((f: any) =>
          ['Tornado Warning', 'Flash Flood Warning'].includes(f.properties?.event)
        );
        if (th && !cityHasActiveWarning) {
          try {
            const wx        = await getWeather(cityLat, cityLon);
            const riskLimit = th.risk_score ?? 65;
            const riskKey   = `threshold:risk:city:${city.id}:${Math.floor(Date.now() / THRESHOLD_COOLDOWN_MS)}`;
            if (wx.risk >= riskLimit && !sentRecently(riskKey)) {
              const tier = wx.risk >= 90 ? 'EXTREME' : wx.risk >= 75 ? 'HIGH' : 'ELEVATED';
              toSend.push({
                key:      riskKey,
                title:    `VORTEX: Risk Score ${tier} — ${city.name}`,
                body:     `Storm Risk Score is ${wx.risk}/100 near ${city.name}. No active warning yet. Monitor closely.`,
                priority: wx.risk >= 75 ? 'high' : 'default',
                tags:     'warning,chart_increasing',
                event:    'Risk Score Alert',
                area:     city.name,
                call:     false,
              });
            }
          } catch (e: any) {
            results.errors.push(`weather:city:${city.id}: ${e.message}`);
          }
        }

        // Proximity check for this city — all nearby warnings, approaching only
        if (!!phone && (pref?.call_threshold_enabled === true) && thresholdCallOk && th) {
          const proximityMiles   = th.proximity_miles ?? 5;
          const cityNearbyAlerts = alertsNearPoint(cityLat, cityLon, proximityMiles, allAlerts);
          for (const alert of cityNearbyAlerts) {
            const event        = alert.properties?.event;
            const isTornado    = event === 'Tornado Warning';
            const isFlashFlood = event === 'Flash Flood Warning';
            if (!alert.geometry) continue;

            // Respect per-type call preferences for proximity calls too
            if (isFlashFlood && pref?.call_flood_enabled !== true) continue;

            const proxKey = `proximity:${alert.properties.id}:city:${city.id}`;
            if (hasSent(proxKey)) continue;

            // Skip if a call for this alert is already queued via county match — prevent double-call
            if (toSend.some(a => a.call && a.key === `nws:${alert.properties.id}:city:${city.id}`)) continue;

            const { dist: cityDist, method: cityMethod } = distToAlertMiles(cityLat, cityLon, alert);
            if (cityDist > proximityMiles) continue;

            // Only call if storm is heading toward the city
            if (!isStormApproaching(cityLat, cityLon, alert)) continue;

            const cityDistDesc = cityMethod === 'gps'
              ? `The tornado is ${cityDist < 1 ? 'less than 1' : Math.round(cityDist)} mile${cityDist < 2 ? '' : 's'} from ${city.name} and approaching`
              : `A ${event.toLowerCase()} is within ${proximityMiles} miles of ${city.name} and approaching`;
            toSend.push({
              key:          proxKey,
              title:        `⚠️ ${event} — APPROACHING ${city.name.toUpperCase()}`,
              body:         `${cityDistDesc}. Take cover immediately.`,
              priority:     'max',
              tags:         isTornado ? 'rotating_light,sos' : 'rain,warning',
              event,
              area:         city.name,
              call:         true,
              callType:     'proximity',
              callLocation: city.name,
            });
          }
        }
      }

      // ── Send notifications ────────────────────────────────────────────────────
      let calledForThreshold = false;
      for (const alert of toSend) {
        let pushSent = false;
        let callSent = false;

        // ntfy.sh push notification
        if (pref?.push_enabled && intg?.ntfy_url?.startsWith('https://ntfy.sh/')) {
          try {
            await fetch(intg.ntfy_url, {
              method: 'POST',
              headers: {
                'Title':        alert.title,
                'Priority':     alert.priority,
                'Tags':         alert.tags,
                'Content-Type': 'text/plain',
              },
              body: alert.body,
            });
            pushSent = true;
          } catch (e: any) {
            results.errors.push(`ntfy:${user.id}: ${e.message}`);
          }
        }

        // Twilio phone call (warning call or proximity alert call)
        if (alert.call && phone) {
          const todayKey = `call:cap:${new Date().toISOString().slice(0, 10)}`;
          if (dailyCallCount >= DAILY_CALL_CAP) {
            // Cap hit — always log to alert history; also push via ntfy if configured (once per day)
            if (!hasSent(todayKey)) {
              let capPushSent = false;
              if (pref?.push_enabled && intg?.ntfy_url?.startsWith('https://ntfy.sh/')) {
                try {
                  await fetch(intg.ntfy_url, {
                    method: 'POST',
                    headers: {
                      'Title':        'VORTEX: Daily Call Limit Reached',
                      'Priority':     'default',
                      'Tags':         'phone,warning',
                      'Content-Type': 'text/plain',
                    },
                    body: `You've reached the 5-call daily limit. Push notifications will continue for the rest of the day. Calls reset at midnight.`,
                  });
                  capPushSent = true;
                } catch (e: any) {
                  results.errors.push(`cap-notify:${user.id}: ${e.message}`);
                }
              }
              historyAlerts.push({
                user_id:       user.id,
                event:         'Daily Call Limit Reached',
                area:          'Your Account',
                alert_key:     todayKey,
                notified_push: capPushSent,
                notified_call: false,
              });
              newAlerts.push({ user_id: user.id, alert_key: todayKey });
            }
          } else {
            try {
              await makeCall(phone, alert.callType!, alert.callLocation);
              results.called++;
              dailyCallCount++;
              callSent = true;
              newAlerts.push({ user_id: user.id, alert_key: `call:${alert.key}` });
              if (alert.callType === 'proximity') calledForThreshold = true;
            } catch (e: any) {
              results.errors.push(`call:${user.id}: ${e.message}`);
            }
          }
        }

        newAlerts.push({ user_id: user.id, alert_key: alert.key });
        historyAlerts.push({
          user_id:       user.id,
          event:         alert.event || alert.title,
          area:          alert.area  || '',
          alert_key:     alert.key,
          notified_push: pushSent,
          notified_call: callSent,
        });
        results.notified++;
      }

      // Stamp last_threshold_call_at to enforce 3-hour cooldown
      if (calledForThreshold) {
        profileUpdates.push({ id: user.id, last_threshold_call_at: new Date().toISOString() });
      }
    }

    // ── 7. Persist new sent_alerts ────────────────────────────────────────────
    if (newAlerts.length) {
      await supa.from('sent_alerts').insert(newAlerts);
    }

    // ── 7b. Persist alert_history ─────────────────────────────────────────────
    if (historyAlerts.length) {
      await supa.from('alert_history').insert(historyAlerts);
    }
    // Clean up history older than 30 days
    const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supa.from('alert_history').delete().lt('sent_at', cutoff30d);

    // ── 8. Update last_threshold_call_at for users who were called ────────────
    // Run in parallel — no reason to serialize these independent updates
    await Promise.all(profileUpdates.map(u =>
      supa.from('profiles')
        .update({ last_threshold_call_at: u.last_threshold_call_at })
        .eq('id', u.id)
    ));

    // ── 9. Write pressure readings + clean up old ones ────────────────────────
    if (pressureInserts.length) {
      await supa.from('pressure_readings').insert(pressureInserts);
    }
    // Keep only last hour of pressure readings (only need 30-min window)
    const cutoff1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await supa.from('pressure_readings').delete().lt('recorded_at', cutoff1h);

    // ── 10. Clean up sent_alerts older than 48h ───────────────────────────────
    await supa.from('sent_alerts').delete().lt('sent_at', cutoff48h);

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
