import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_SID           = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const TWILIO_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN')  || '';
const TWILIO_FROM          = Deno.env.get('TWILIO_FROM_NUMBER') || '';
const TWILIO_AUDIO_URL     = Deno.env.get('TWILIO_ALERT_AUDIO_URL') || '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // Verify user JWT
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await supa.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: CORS });
  }

  // Get phone from request body, fall back to profile
  let phone = '';
  try {
    const body = await req.json();
    phone = (body.phone || '').trim();
  } catch { /* no body */ }

  if (!phone) {
    const { data: profile } = await supa
      .from('profiles')
      .select('phone')
      .eq('id', user.id)
      .maybeSingle();
    phone = (profile?.phone || '').trim();
  }

  if (!phone) {
    return new Response(JSON.stringify({ error: 'No phone number on file. Add one in Settings first.' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return new Response(JSON.stringify({ error: 'Twilio not configured on server.' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const audioTag = TWILIO_AUDIO_URL ? `<Play loop="1">${TWILIO_AUDIO_URL}</Play>` : '';
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${audioTag}
  <Say voice="alice">This is a test call from Vortex Storm Intelligence. Your phone call alerts are working correctly. You will receive calls like this for tornado warnings and severe weather conditions.</Say>
</Response>`;

  try {
    const creds = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
    const res = await fetch(
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

    if (!res.ok) {
      const err = await res.json();
      return new Response(JSON.stringify({ error: err.message || 'Twilio error' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, phone }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
