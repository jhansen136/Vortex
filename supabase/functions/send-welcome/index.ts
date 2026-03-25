import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL     = 'VORTEX <noreply@vortexintel.app>';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

  const firstName = (name || '').split(' ')[0] || 'there';

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
      <div style="font-size:18px;font-weight:700;letter-spacing:2px;color:#e8edf5;margin-bottom:16px;">WELCOME, ${firstName.toUpperCase()}</div>
      <div style="font-size:13px;color:#c8d0dc;line-height:1.8;margin-bottom:24px;">
        Your 14-day free trial is now active. You have full access to everything VORTEX has to offer:
      </div>
      <div style="margin-bottom:24px;">
        <div style="font-size:12px;color:#c8d0dc;line-height:2.2;">
          <div>⚡ <span style="color:#f5a623;font-weight:700;">Real-time NWS alerts</span> — tornado warnings delivered in under 60 seconds</div>
          <div>🌡 <span style="color:#f5a623;font-weight:700;">Live weather map</span> — temp, wind &amp; risk overlays across the US</div>
          <div>📍 <span style="color:#f5a623;font-weight:700;">Push notifications</span> — alerted the moment a warning hits your area</div>
          <div>📊 <span style="color:#f5a623;font-weight:700;">Risk scoring</span> — 0–100 storm risk index updated every minute</div>
        </div>
      </div>
      <div style="text-align:center;margin:28px 0;">
        <a href="https://vortexintel.app" style="display:inline-block;background:#f5a623;color:#000;font-weight:700;font-size:14px;letter-spacing:2px;text-decoration:none;padding:13px 32px;border-radius:4px;">
          OPEN VORTEX →
        </a>
      </div>
      <div style="font-size:11px;color:#5a6475;line-height:1.7;border-top:1px solid #1e2229;padding-top:16px;">
        <strong style="color:#c8d0dc;">Pro tip:</strong> Add VORTEX to your iPhone home screen — open <span style="color:#00d4ff;">vortexintel.app</span> in Safari, tap Share → "Add to Home Screen."<br><br>
        Your trial runs for 14 days. No charge until it ends — cancel anytime from Settings.
      </div>
    </div>
    <div style="background:#0a0b0d;padding:16px 32px;border-top:1px solid #1e2229;text-align:center;">
      <div style="font-size:9px;color:#5a6475;letter-spacing:1px;">VORTEX STORM INTELLIGENCE · VORTEXINTEL.APP</div>
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
        to:      [email],
        subject: 'Welcome to VORTEX — your trial is active',
        html,
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
