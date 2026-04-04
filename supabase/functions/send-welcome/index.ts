import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY       = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FROM_EMAIL           = 'VORTEX <noreply@vortexintel.app>';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function buildWelcomeEmail(name?: string): string {
  const greeting = name ? name.split(' ')[0] : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Welcome to VORTEX</title>
</head>
<body style="margin:0;padding:0;background:#0a0b0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#0f1114;border:1px solid #1e2229;border-radius:8px;overflow:hidden;">

    <!-- Header -->
    <div style="background:#0a0b0d;padding:28px 32px;border-bottom:1px solid #1e2229;text-align:center;">
      <div style="font-size:26px;font-weight:900;letter-spacing:6px;color:#f5a623;">⟳ VORTEX</div>
      <div style="font-size:10px;letter-spacing:3px;color:#5a6475;margin-top:5px;">STORM INTELLIGENCE PLATFORM</div>
    </div>

    <!-- Body -->
    <div style="padding:32px 36px;">
      <div style="font-size:20px;font-weight:700;color:#e8edf5;margin-bottom:12px;">
        ${greeting ? `Welcome, ${greeting}.` : 'Welcome to VORTEX.'}
      </div>
      <div style="font-size:14px;color:#c8d0dc;line-height:1.7;margin-bottom:28px;">
        Your free account is ready. You have access to the live weather map, real-time radar, NWS warning overlays, wildfire tracking, and earthquake data — all in one place.
      </div>

      <!-- What you have -->
      <div style="background:#13161b;border:1px solid #1e2229;border-radius:6px;padding:20px 24px;margin-bottom:20px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#5a6475;text-transform:uppercase;margin-bottom:16px;">Your free account includes</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;width:28px;font-size:16px;">🗺</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Live Weather Map</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Live radar, NWS warning polygons, risk overlay, wildfires, and earthquakes — all on one screen.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-size:16px;">📊</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Storm Risk Score</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">A 0–100 atmospheric danger index calculated from real data — see how dangerous conditions are before the NWS issues anything.</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- Pro upsell -->
      <div style="background:#13161b;border:1px solid #2a2f3a;border-radius:6px;padding:20px 24px;margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#f5a623;text-transform:uppercase;margin-bottom:16px;">Unlock with Pro — start a free trial in the app</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;width:28px;font-size:16px;">📞</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#c8d0dc;">Phone Call Alerts</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Tornado warnings call your phone directly — even when it's face down and Do Not Disturb is on. Also fires when a storm is within miles of you, even across county lines.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;font-size:16px;">🔔</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#c8d0dc;">Background Push Notifications</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">NWS warnings, watches, and rapid pressure drop alerts — running 24/7 even when the app is closed.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-size:16px;">📍</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#c8d0dc;">Multi-Location Monitoring</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Monitor home plus up to 3 additional cities, each with independent background alerting.</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="https://vortexintel.app" style="display:inline-block;background:#f5a623;color:#000;font-weight:700;font-size:14px;letter-spacing:2px;text-decoration:none;padding:14px 36px;border-radius:4px;">
          OPEN VORTEX →
        </a>
      </div>

      <!-- Setup tips -->
      <div style="font-size:12px;color:#5a6475;line-height:1.8;border-top:1px solid #1e2229;padding-top:20px;">
        <div style="color:#c8d0dc;font-weight:600;margin-bottom:8px;">Get started:</div>
        <div>1. Set your <strong style="color:#c8d0dc;">home location</strong> in Settings</div>
        <div>2. Explore the live map — tap anywhere for weather detail</div>
        <div style="margin-top:10px;">📱 <strong style="color:#c8d0dc;">Install on iPhone:</strong> open vortexintel.app in Safari → Share → "Add to Home Screen"</div>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#0a0b0d;padding:16px 32px;border-top:1px solid #1e2229;text-align:center;">
      <div style="font-size:11px;color:#5a6475;line-height:1.8;">
        <a href="mailto:support@vortexintel.app" style="color:#5a6475;text-decoration:none;">support@vortexintel.app</a>
        &nbsp;·&nbsp;
        <a href="https://vortexintel.app" style="color:#5a6475;text-decoration:none;">vortexintel.app</a>
        <br><br>
        <span style="font-size:10px;letter-spacing:1px;">VORTEX INTEL LLC</span>
      </div>
    </div>

  </div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  // Verify caller is an authenticated user
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await supa.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: CORS });
  }

  let email: string, name: string;
  try {
    ({ email, name } = await req.json());
    if (!email) throw new Error('missing email');
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [email],
        subject: 'Welcome to VORTEX',
        html:    buildWelcomeEmail(name),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[send-welcome] Resend error:', err);
      return new Response(JSON.stringify({ error: err }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const data = await res.json();
    console.log(`[send-welcome] Sent to ${email}, id: ${data.id}`);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[send-welcome] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
