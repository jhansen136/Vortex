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

// Escape HTML special characters to prevent injection in email body
function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { to, inviteUrl, inviterName } = body;
  if (!to || !inviteUrl) {
    return new Response('Missing required fields', { status: 400 });
  }

  // Sanitize user-supplied values before inserting into HTML
  const safeInviterName = escHtml(String(inviterName || 'A VORTEX user'));
  const safeTo          = escHtml(String(to));
  // inviteUrl goes into an href — only allow https:// links to prevent javascript: injection
  const safeInviteUrl   = String(inviteUrl).startsWith('https://') ? inviteUrl : 'https://vortexintel.app';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You've been invited to VORTEX</title>
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

      <!-- Invite line -->
      <div style="font-size:14px;color:#c8d0dc;line-height:1.7;margin-bottom:24px;">
        <strong style="color:#e8edf5;">${safeInviterName}</strong> invited you to VORTEX — a storm intelligence platform that calls your phone when a tornado warning is issued for your location.
      </div>

      <!-- Origin story -->
      <div style="background:#13161b;border-left:3px solid #f5a623;padding:14px 18px;margin-bottom:24px;border-radius:0 4px 4px 0;">
        <div style="font-size:12px;color:#c8d0dc;line-height:1.8;">
          VORTEX was built after a tornado struck a campground in Rogers, Arkansas while the founder's family was sleeping in a camper — with no warning. Every existing alert system relied on push notifications that get silenced or missed. So he built one that calls your phone instead.
        </div>
      </div>

      <!-- Features -->
      <div style="background:#13161b;border:1px solid #1e2229;border-radius:6px;padding:20px 24px;margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#5a6475;text-transform:uppercase;margin-bottom:16px;">What VORTEX does</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;width:28px;font-size:16px;">📞</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Phone Call Alerts</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Tornado and flash flood warnings call your phone directly — even when it's face down and Do Not Disturb is on. Proximity alerts fire when a storm is tracking toward you, even if you're outside the warning area.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;font-size:16px;">🗺</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Live Weather Map</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Live radar, NWS warning polygons, storm risk overlay, wildfires, and earthquakes — all on one screen, updated continuously.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-size:16px;">📊</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Storm Risk Score</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">A 0–100 atmospheric danger index from real data — CAPE, helicity, wind shear, and more. Alerts you before the NWS issues anything.</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- What they get -->
      <div style="font-size:13px;color:#5a6475;line-height:1.7;margin-bottom:28px;">
        Your invite creates a <strong style="color:#c8d0dc;">free account</strong> with full map access. You can start a free Pro trial — including phone call alerts and background notifications — anytime from within the app. No credit card required to get started.
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${safeInviteUrl}" style="display:inline-block;background:#f5a623;color:#000;font-weight:700;font-size:14px;letter-spacing:2px;text-decoration:none;padding:14px 36px;border-radius:4px;">
          ACCEPT INVITE →
        </a>
      </div>

      <!-- Fine print -->
      <div style="font-size:10px;color:#5a6475;line-height:1.7;border-top:1px solid #1e2229;padding-top:16px;">
        This invite was sent to <span style="color:#c8d0dc;">${safeTo}</span> and can only be used with this email address.<br>
        Link expires in <strong style="color:#f5a623;">7 days</strong>.<br><br>
        If you cannot click the button, copy this URL:<br>
        <span style="color:#00d4ff;word-break:break-all;">${safeInviteUrl}</span>
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

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [to],
        subject: "You've been invited to VORTEX",
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: err }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await res.json();
    return new Response(JSON.stringify({ success: true, id: data.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
