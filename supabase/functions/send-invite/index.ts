import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL     = 'VORTEX <noreply@vortexintel.app>';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
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

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0b0d;font-family:'Courier New',monospace;">
  <div style="max-width:480px;margin:40px auto;background:#0f1114;border:1px solid #1e2229;border-radius:8px;overflow:hidden;">
    <div style="background:#0a0b0d;padding:28px 32px;border-bottom:1px solid #1e2229;text-align:center;">
      <div style="font-size:28px;font-weight:900;letter-spacing:6px;color:#f5a623;">⟳ VORTEX</div>
      <div style="font-size:11px;letter-spacing:3px;color:#5a6475;margin-top:4px;">STORM INTELLIGENCE PLATFORM</div>
    </div>
    <div style="padding:32px;">
      <div style="font-size:13px;color:#c8d0dc;line-height:1.7;margin-bottom:24px;">
        <strong style="color:#e8edf5;">${inviterName}</strong> has invited you to join VORTEX — a real-time storm intelligence platform for tornado tracking, NWS alerts, and severe weather monitoring.
      </div>
      <div style="text-align:center;margin:28px 0;">
        <a href="${inviteUrl}" style="display:inline-block;background:#f5a623;color:#000;font-weight:700;font-size:14px;letter-spacing:2px;text-decoration:none;padding:13px 32px;border-radius:4px;">
          ACCEPT INVITE →
        </a>
      </div>
      <div style="font-size:10px;color:#5a6475;line-height:1.7;border-top:1px solid #1e2229;padding-top:16px;">
        This invite was sent to <span style="color:#c8d0dc;">${to}</span> and can only be used with this email address.<br>
        Link expires in <strong style="color:#f5a623;">7 days</strong>.<br><br>
        If you cannot click the button, copy this URL:<br>
        <span style="color:#00d4ff;word-break:break-all;">${inviteUrl}</span>
      </div>
    </div>
    <div style="background:#0a0b0d;padding:16px 32px;border-top:1px solid #1e2229;text-align:center;">
      <div style="font-size:9px;color:#5a6475;letter-spacing:1px;">VORTEX STORM INTELLIGENCE · NW ARKANSAS</div>
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
