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
const FALLBACK_LAT  = 36.08;
const FALLBACK_LON  = -94.20;
const FALLBACK_SAME = ['005007', '005143', '005087', '005015', '005009'];

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

// Push cooldown — suppress repeated threshold pushes within 30 min
const THRESHOLD_COOLDOWN_MS = 30 * 60 * 1000;

// Call cooldown — suppress repeated threshold calls within 3 hours
const CALL_COOLDOWN_MS = 3 * 60 * 60 * 1000;

// Daily call cap per user
const DAILY_CALL_CAP = 5;

// Severe parameter thresholds that trigger a phone call (in addition to push)
const SEVERE = { cape: 1500, srh: 250, risk: 70 };

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

// ── Twilio voice call ──────────────────────────────────────────────────────────
// Plays the NWS EAS audio (if TWILIO_ALERT_AUDIO_URL is set) then a TTS message.
// When you have the NWS recording: npx supabase secrets set TWILIO_ALERT_AUDIO_URL=https://...
async function makeCall(phone: string, type: 'warning' | 'threshold' | 'flood'): Promise<void> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return;

  const audioTag = TWILIO_AUDIO_URL
    ? `<Play loop="1">${TWILIO_AUDIO_URL}</Play>`
    : '';

  const tts = type === 'warning'
    ? 'This is an emergency alert from Vortex Storm Intelligence. A tornado warning is active for your home area. Open the Vortex app immediately.'
    : type === 'flood'
    ? 'This is an emergency alert from Vortex Storm Intelligence. A flash flood warning is active for your home area. Move to higher ground immediately.'
    : 'This is a Vortex weather alert. Severe storm conditions are developing near your home area. Check the Vortex app for current conditions.';

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

serve(async (req) => {
  // Verify cron secret — check Authorization header or ?secret= query param
  const url = new URL(req.url);
  const headerAuth = req.headers.get('authorization') === `Bearer ${CRON_SECRET}`;
  const queryAuth  = url.searchParams.get('secret') === CRON_SECRET;
  if (!headerAuth && !queryAuth) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results: { notified: number; called: number; errors: string[] } = { notified: 0, called: 0, errors: [] };

  try {
    // ── 1. Fetch all active NWS tornado + flood warnings (CONUS) ─────────────
    const eventParam = NWS_EVENTS.map(e => encodeURIComponent(e)).join(',');
    const nwsRes = await fetch(
      `https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=${eventParam}`,
      { headers: { 'User-Agent': 'VORTEX Storm Intelligence (jhansen136@gmail.com)' } }
    );
    const nwsJson   = await nwsRes.json();
    const allAlerts = nwsJson.features || [];

    // ── 2. Load Pro/trial users only — free users don't get background alerts ─
    const now = new Date().toISOString();
    const { data: allUsers, error: usersErr } = await supa
      .from('profiles')
      .select('id, display_name, home_lat, home_lng, home_fips, phone, last_threshold_call_at, subscription_status, trial_ends_at')
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

    // ── 4. Weather cache — persistent in Supabase, 15-min TTL ────────────────
    // Within a single run, also deduplicated in-memory to avoid redundant DB reads.
    const WEATHER_TTL_MS = 15 * 60 * 1000;
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
        .catch(() => {});

      return wx;
    }

    // Pre-fetch all unique user locations in parallel before the user loop.
    // This means Open-Meteo is only called once per unique location per 15 min,
    // regardless of how many users share that location.
    const uniqueLocations = [...new Set(users.map((u: any) => {
      const lat = u.home_lat ?? FALLBACK_LAT;
      const lon = u.home_lng ?? FALLBACK_LON;
      return `${lat.toFixed(2)},${lon.toFixed(2)}`;
    }))];
    await Promise.all(
      uniqueLocations.map((locKey: string) => {
        const [la, lo] = locKey.split(',').map(Number);
        return getWeather(la, lo).catch(() => {});
      })
    );

    // ── 5. Process each user ──────────────────────────────────────────────────
    const newAlerts: { user_id: string; alert_key: string }[] = [];
    const profileUpdates: { id: string; last_threshold_call_at: string }[] = [];

    for (const user of users) {
      const th   = (thresholds   || []).find((t: any) => t.user_id === user.id);
      const intg = (integrations || []).find((i: any) => i.user_id === user.id);
      const pref = (preferences  || []).find((p: any) => p.user_id === user.id);

      const homeLat  = user.home_lat  ?? FALLBACK_LAT;
      const homeLon  = user.home_lng  ?? FALLBACK_LON;
      const homeFips = user.home_fips ?? null;
      const phone    = (user.phone || '').trim();

      const userSame: string[] = homeFips ? ['0' + homeFips] : FALLBACK_SAME;

      const userAlerts = allAlerts.filter((f: any) => {
        const same: string[] = f.properties?.geocode?.SAME || [];
        return same.some((code: string) => userSame.includes(code));
      });

      const userSent     = (recentSent || []).filter((a: any) => a.user_id === user.id);
      const hasSent      = (key: string) => userSent.some((a: any) => a.alert_key === key);
      const sentRecently = (key: string) => userSent.some((a: any) =>
        a.alert_key === key && new Date(a.sent_at).getTime() > Date.now() - THRESHOLD_COOLDOWN_MS
      );

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
        call?: boolean; callType?: 'warning' | 'threshold';
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

        toSend.push({
          key,
          title:    `⚠️ ${event}`,
          body:     alert.properties.headline || alert.properties.description?.slice(0, 200) || '',
          priority,
          tags,
          call:     (isTornado    && !!phone && (pref?.call_tornado_enabled !== false)) ||
                    (isFlashFlood && !!phone && (pref?.call_flood_enabled === true)),
          callType: isFlashFlood ? 'flood' : 'warning',
        });
      }

      // ── Threshold alerts ─────────────────────────────────────────────────────
      // Trigger logic:
      //   Moderate threshold hit → push only
      //   Severe threshold hit (CAPE≥1500, SRH≥250, Risk≥70) → push + call (3hr cooldown)
      if (th) {
        try {
          const wx = await getWeather(homeLat, homeLon);
          const checks = [
            { key: 'threshold:cape', value: wx.cape, limit: th.cape, label: 'CAPE',      unit: ' J/kg',  severe: wx.cape >= SEVERE.cape },
            { key: 'threshold:srh',  value: wx.srh,  limit: th.srh,  label: 'SRH',       unit: ' m²/s²', severe: wx.srh  >= SEVERE.srh  },
            { key: 'threshold:wind', value: wx.w,    limit: th.wind, label: 'Wind Speed', unit: ' mph',   severe: false },
            { key: 'threshold:risk', value: wx.risk, limit: th.risk, label: 'Risk Score', unit: ' / 100', severe: wx.risk >= SEVERE.risk },
          ];
          for (const c of checks) {
            if (c.value >= c.limit && !sentRecently(c.key)) {
              const triggerCall = c.severe && !!phone && thresholdCallOk && (pref?.call_threshold_enabled !== false);
              toSend.push({
                key:      c.key,
                title:    `VORTEX: ${c.label} Alert`,
                body:     `${c.label} is ${Math.round(c.value)}${c.unit} — your threshold is ${c.limit}${c.unit}`,
                priority: c.severe ? 'max' : 'high',
                tags:     'warning,chart_increasing',
                call:     triggerCall,
                callType: 'threshold',
              });
            }
          }
        } catch (e: any) {
          results.errors.push(`weather:${user.id}: ${e.message}`);
        }
      }

      // ── Send notifications ────────────────────────────────────────────────────
      let calledForThreshold = false;
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

        // Twilio phone call (tornado warning or severe threshold)
        if (alert.call && phone) {
          const todayKey = `call:cap:${new Date().toISOString().slice(0, 10)}`;
          if (dailyCallCount >= DAILY_CALL_CAP) {
            // Cap hit — send one ntfy notification per day to let user know
            if (!hasSent(todayKey) && pref?.push_enabled && intg?.ntfy_url?.startsWith('https://ntfy.sh/')) {
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
                newAlerts.push({ user_id: user.id, alert_key: todayKey });
              } catch (e: any) {
                results.errors.push(`cap-notify:${user.id}: ${e.message}`);
              }
            }
          } else {
            try {
              await makeCall(phone, alert.callType!);
              results.called++;
              dailyCallCount++;
              newAlerts.push({ user_id: user.id, alert_key: `call:${alert.key}` });
              if (alert.callType === 'threshold') calledForThreshold = true;
            } catch (e: any) {
              results.errors.push(`call:${user.id}: ${e.message}`);
            }
          }
        }

        newAlerts.push({ user_id: user.id, alert_key: alert.key });
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

    // ── 8. Update last_threshold_call_at for users who were called ────────────
    for (const u of profileUpdates) {
      await supa.from('profiles')
        .update({ last_threshold_call_at: u.last_threshold_call_at })
        .eq('id', u.id);
    }

    // ── 9. Clean up sent_alerts older than 48h ────────────────────────────────
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
