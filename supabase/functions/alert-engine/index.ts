import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET          = Deno.env.get('CRON_SECRET')!;

// NW Arkansas fallback (used for users who haven't set a home location yet)
const FALLBACK_LAT  = 36.08;
const FALLBACK_LON  = -94.20;
const FALLBACK_SAME = ['005007', '005143', '005087', '005015', '005009'];

// NWS event types to monitor
const NWS_EVENTS = ['Tornado Warning', 'Flash Flood Warning', 'Flood Warning'];

// Threshold cooldown: suppress repeated threshold alerts within 30 min
const THRESHOLD_COOLDOWN_MS = 30 * 60 * 1000;

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

// Fetch Open-Meteo for a given lat/lon and return computed weather metrics
async function fetchWeather(lat: number, lon: number) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&hourly=cape,lifted_index,wind_speed_80m` +
    `&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
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
  const risk = calcRisk(cape, srh, sh, h, dF, lift);
  return { tF, h, w, cape, srh, sh, lift, dF, risk };
}

serve(async (req) => {
  // Verify cron secret — check Authorization header or ?secret= query param
  const url = new URL(req.url);
  const headerAuth = req.headers.get('authorization') === `Bearer ${CRON_SECRET}`;
  const queryAuth  = url.searchParams.get('secret') === CRON_SECRET;
  if (!headerAuth && !queryAuth) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results: { notified: number; errors: string[] } = { notified: 0, errors: [] };

  try {
    // ── 1. Fetch all active NWS tornado + flood warnings (CONUS) ─────────────
    const eventParam = NWS_EVENTS.map(e => encodeURIComponent(e)).join(',');
    const nwsRes = await fetch(
      `https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=${eventParam}`,
      { headers: { 'User-Agent': 'VORTEX Storm Intelligence (jhansen136@gmail.com)' } }
    );
    const nwsJson  = await nwsRes.json();
    const allAlerts = nwsJson.features || [];

    // ── 2. Load all active users with home location + settings ────────────────
    const { data: users, error: usersErr } = await supa
      .from('profiles')
      .select('id, display_name, home_lat, home_lng, home_fips')
      .eq('disabled', false);

    if (usersErr || !users?.length) {
      return new Response(JSON.stringify({ ok: true, users: 0 }), { status: 200 });
    }

    const ids = users.map((u: any) => u.id);
    const [{ data: thresholds }, { data: integrations }, { data: preferences }] = await Promise.all([
      supa.from('thresholds').select('*').in('user_id', ids),
      supa.from('integrations').select('*').in('user_id', ids),
      supa.from('preferences').select('*').in('user_id', ids),
    ]);

    // ── 3. Load recent sent_alerts (last 48h for deduplication) ──────────────
    const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: recentSent } = await supa
      .from('sent_alerts')
      .select('user_id, alert_key, sent_at')
      .gte('sent_at', cutoff48h);

    // ── 4. Fetch weather — deduplicated by approximate location ───────────────
    // Cache keyed by rounded lat/lon to avoid duplicate API calls for nearby users
    const wxCache = new Map<string, any>();
    async function getWeather(lat: number, lon: number) {
      const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      if (!wxCache.has(key)) {
        wxCache.set(key, await fetchWeather(lat, lon));
      }
      return wxCache.get(key);
    }

    // ── 5. Process each user ──────────────────────────────────────────────────
    const newAlerts: { user_id: string; alert_key: string }[] = [];

    for (const user of users) {
      const th   = (thresholds   || []).find((t: any) => t.user_id === user.id);
      const intg = (integrations || []).find((i: any) => i.user_id === user.id);
      const pref = (preferences  || []).find((p: any) => p.user_id === user.id);

      // Use user's stored home location, fall back to NW Arkansas
      const homeLat  = user.home_lat  ?? FALLBACK_LAT;
      const homeLon  = user.home_lng  ?? FALLBACK_LON;
      const homeFips = user.home_fips ?? null;

      // Build user's SAME code list for NWS filtering
      const userSame: string[] = homeFips
        ? ['0' + homeFips]      // 5-digit FIPS → 6-digit SAME code
        : FALLBACK_SAME;

      // Filter NWS alerts to this user's exact county
      const userAlerts = allAlerts.filter((f: any) => {
        const same: string[] = f.properties?.geocode?.SAME || [];
        return same.some((code: string) => userSame.includes(code));
      });

      const userSent     = (recentSent || []).filter((a: any) => a.user_id === user.id);
      const hasSent      = (key: string) => userSent.some((a: any) => a.alert_key === key);
      const sentRecently = (key: string) => userSent.some((a: any) =>
        a.alert_key === key && new Date(a.sent_at).getTime() > Date.now() - THRESHOLD_COOLDOWN_MS
      );

      const toSend: { key: string; title: string; body: string; priority: string; tags: string }[] = [];

      // NWS alerts — never re-send the same NWS event ID
      for (const alert of userAlerts) {
        const key = `nws:${alert.properties.id}`;
        if (!hasSent(key)) {
          const isTornado = alert.properties.event === 'Tornado Warning';
          toSend.push({
            key,
            title:    `⚠️ ${alert.properties.event}`,
            body:     alert.properties.headline || alert.properties.description?.slice(0, 200) || '',
            priority: isTornado ? 'max' : 'high',
            tags:     isTornado ? 'rotating_light,sos' : 'rain,warning',
          });
        }
      }

      // Threshold alerts — fetch weather for this user's home location
      if (th) {
        try {
          const wx = await getWeather(homeLat, homeLon);
          const checks = [
            { key: 'threshold:cape', value: wx.cape, limit: th.cape, label: 'CAPE',       unit: ' J/kg'  },
            { key: 'threshold:srh',  value: wx.srh,  limit: th.srh,  label: 'SRH',        unit: ' m²/s²' },
            { key: 'threshold:wind', value: wx.w,    limit: th.wind, label: 'Wind Speed',  unit: ' mph'   },
            { key: 'threshold:risk', value: wx.risk, limit: th.risk, label: 'Risk Score',  unit: ' / 100' },
          ];
          for (const c of checks) {
            if (c.value >= c.limit && !sentRecently(c.key)) {
              toSend.push({
                key:      c.key,
                title:    `VORTEX: ${c.label} Alert`,
                body:     `${c.label} is ${Math.round(c.value)}${c.unit} — your threshold is ${c.limit}${c.unit}`,
                priority: 'high',
                tags:     'warning,chart_increasing',
              });
            }
          }
        } catch (e: any) {
          results.errors.push(`weather:${user.id}: ${e.message}`);
        }
      }

      // ── 6. Send notifications ───────────────────────────────────────────────
      for (const alert of toSend) {
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
          } catch (e: any) {
            results.errors.push(`ntfy:${user.id}: ${e.message}`);
          }
        }

        // Future notification channels — add new integrations here:
        // smart speaker, phone call, SMS, etc.

        newAlerts.push({ user_id: user.id, alert_key: alert.key });
        results.notified++;
      }
    }

    // ── 7. Persist new sent_alerts ────────────────────────────────────────────
    if (newAlerts.length) {
      await supa.from('sent_alerts').insert(newAlerts);
    }

    // ── 8. Clean up sent_alerts older than 48h ────────────────────────────────
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
