import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@13.3.0';

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY   = Deno.env.get('STRIPE_SECRET_KEY')!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });

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

  // Load stripe_customer_id from profile
  const { data: profile } = await supa
    .from('profiles')
    .select('stripe_customer_id, subscription_status')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.stripe_customer_id) {
    return new Response(JSON.stringify({ error: 'No Stripe customer found. Contact support@vortexintel.app.' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Return URL — where Stripe sends the user after they leave the portal
  let returnUrl = 'https://vortexintel.app';
  try {
    const body = await req.json();
    if (body.return_url) returnUrl = body.return_url;
  } catch { /* no body */ }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: returnUrl,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[stripe-portal] Error creating portal session:', e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
