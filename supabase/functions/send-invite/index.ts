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
        <strong style="color:#e8edf5;">${safeInviterName}</strong> has invited you to join VORTEX — a real-time storm intelligence platform for tornado tracking, NWS alerts, and severe weather monitoring.
      </div>
      <div style="text-align:center;margin:28px 0;">
        <a href="${safeInviteUrl}" style="display:inline-block;background:#f5a623;color:#000;font-weight:700;font-size:14px;letter-spacing:2px;text-decoration:none;padding:13px 32px;border-radius:4px;">
          ACCEPT INVITE →
        </a>
      </div>
      <div style="font-size:10px;color:#5a6475;line-height:1.7;border-top:1px solid #1e2229;padding-top:16px;">
        This invite was sent to <span style="color:#c8d0dc;">${safeTo}</span> and can only be used with this email address.<br>
        Link expires in <strong style="color:#f5a623;">7 days</strong>.<br><br>
        If you cannot click the button, copy this URL:<br>
        <span style="color:#00d4ff;word-break:break-all;">${safeInviteUrl}</span>
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
