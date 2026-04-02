import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL     = 'VORTEX <noreply@vortexintel.app>';

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
        Your 14-day free trial is active. VORTEX is watching for severe weather at your location around the clock — even when your phone is face down and Do Not Disturb is on.
      </div>

      <!-- Features -->
      <div style="background:#13161b;border:1px solid #1e2229;border-radius:6px;padding:20px 24px;margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#5a6475;text-transform:uppercase;margin-bottom:16px;">What's included</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;width:28px;font-size:16px;">📞</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Phone Call Alerts</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Tornado warnings call your phone directly. Also fires if a storm is within miles of you — even across county lines.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;font-size:16px;">🔔</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Push Notifications</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">NWS warnings, watches, and rapid pressure drop alerts — all togglable in Settings.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;font-size:16px;">📊</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Storm Risk Score</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">A 0–100 danger index from real atmospheric data — CAPE, helicity, wind shear, and more. Get alerted before the NWS issues anything.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-size:16px;">🗺</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Live Weather Map</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Live radar, NWS warning polygons, risk overlay, wildfires, and earthquakes — all on one screen.</div>
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
        <div style="color:#c8d0dc;font-weight:600;margin-bottom:8px;">Get set up in 2 minutes:</div>
        <div>1. Set your <strong style="color:#c8d0dc;">home location</strong> in Settings</div>
        <div>2. Add your <strong style="color:#c8d0dc;">phone number</strong> to enable call alerts</div>
        <div>3. Install the <strong style="color:#c8d0dc;">ntfy app</strong> and paste your channel URL for push notifications</div>
        <div style="margin-top:10px;">📱 <strong style="color:#c8d0dc;">Install on iPhone:</strong> open vortexintel.app in Safari → Share → "Add to Home Screen"</div>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#0a0b0d;padding:16px 32px;border-top:1px solid #1e2229;text-align:center;">
      <div style="font-size:11px;color:#5a6475;line-height:1.8;">
        Your trial runs for 14 days. No charge until it ends.<br>
        Cancel anytime from Settings → Manage Subscription.<br>
        <br>
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
        subject: 'Welcome to VORTEX — your trial is active',
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
