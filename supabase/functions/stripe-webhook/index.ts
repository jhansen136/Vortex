import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

// ── Stripe webhook handler ──────────────────────────────────────────────────
// Listens for Stripe events and updates subscription_status in profiles.
//
// Events handled:
//   checkout.session.completed       → set pro, store stripe_customer_id
//   customer.subscription.deleted    → set free
//   customer.subscription.updated    → handle plan changes
//
// Setup:
//   1. Get webhook secret from Stripe Dashboard → Webhooks → Add endpoint
//   2. Endpoint URL: https://<project>.supabase.co/functions/v1/stripe-webhook
//   3. npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// ────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const body      = await req.text();
  const signature = req.headers.get('stripe-signature') || '';

  // TODO: Verify webhook signature using STRIPE_WEBHOOK_SECRET
  // For now parse the event directly — add verification before going live
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    switch (event.type) {

      // ── Payment succeeded → activate Pro ───────────────────────────────────
      case 'checkout.session.completed': {
        const session     = event.data.object;
        const customerId  = session.customer;
        const customerEmail = session.customer_details?.email || session.customer_email;
        if (!customerEmail) break;

        await supa.from('profiles')
          .update({
            subscription_status: 'pro',
            stripe_customer_id:  customerId,
            trial_ends_at:       null,
          })
          .eq('id', await getUserIdByEmail(supa, customerEmail));

        console.log(`[stripe] Activated Pro for ${customerEmail}`);
        break;
      }

      // ── Subscription cancelled → revert to free ────────────────────────────
      case 'customer.subscription.deleted': {
        const sub        = event.data.object;
        const customerId = sub.customer;

        await supa.from('profiles')
          .update({ subscription_status: 'free' })
          .eq('stripe_customer_id', customerId);

        console.log(`[stripe] Reverted to free for customer ${customerId}`);
        break;
      }

      // ── Subscription updated (e.g. plan change) ────────────────────────────
      case 'customer.subscription.updated': {
        const sub        = event.data.object;
        const customerId = sub.customer;
        const status     = sub.status; // active, past_due, canceled, etc.

        if (status === 'active') {
          await supa.from('profiles')
            .update({ subscription_status: 'pro' })
            .eq('stripe_customer_id', customerId);
        } else if (status === 'past_due' || status === 'canceled') {
          await supa.from('profiles')
            .update({ subscription_status: 'free' })
            .eq('stripe_customer_id', customerId);
        }
        break;
      }

      default:
        // Unhandled event type — ignore
        break;
    }
  } catch (e: any) {
    console.error('[stripe] Handler error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// Helper — look up a Supabase user ID by email
async function getUserIdByEmail(supa: any, email: string): Promise<string | null> {
  const { data } = await supa
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  return data?.id || null;
}
