import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@13.3.0';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY     = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20' as any,
});

serve(async (req) => {
  const body      = await req.text();
  const signature = req.headers.get('stripe-signature') || '';

  // ── Verify webhook signature ──────────────────────────────────────────────
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return new Response(`Webhook signature error: ${err.message}`, { status: 400 });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    switch (event.type) {

      // ── Checkout completed → activate Pro ────────────────────────────────
      case 'checkout.session.completed': {
        const session       = event.data.object as Stripe.Checkout.Session;
        const customerId    = session.customer as string;
        const customerEmail = session.customer_details?.email || session.customer_email;
        if (!customerEmail) {
          console.error('[stripe-webhook] checkout.session.completed: no email in event');
          break;
        }

        const userId = await getUserIdByEmail(supa, customerEmail);
        if (!userId) {
          console.error(`[stripe-webhook] No user found for email: ${customerEmail}`);
          break;
        }

        await supa.from('profiles').update({
          subscription_status: 'pro',
          stripe_customer_id:  customerId,
          trial_ends_at:       null,
        }).eq('id', userId);

        console.log(`[stripe-webhook] Activated Pro for ${customerEmail} (customer: ${customerId})`);
        break;
      }

      // ── Subscription cancelled → revert to free ───────────────────────────
      case 'customer.subscription.deleted': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        const { error } = await supa.from('profiles')
          .update({ subscription_status: 'free', stripe_customer_id: null })
          .eq('stripe_customer_id', customerId);

        if (error) console.error('[stripe-webhook] subscription.deleted update error:', error.message);
        else console.log(`[stripe-webhook] Reverted to free for customer ${customerId}`);
        break;
      }

      // ── Subscription updated (plan change, renewal, past due) ─────────────
      case 'customer.subscription.updated': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const status     = sub.status;

        let newStatus: string | null = null;
        if (status === 'active' || status === 'trialing') {
          newStatus = 'pro';
        } else if (status === 'past_due' || status === 'canceled' || status === 'unpaid') {
          newStatus = 'free';
        }

        if (newStatus) {
          const { error } = await supa.from('profiles')
            .update({ subscription_status: newStatus })
            .eq('stripe_customer_id', customerId);
          if (error) console.error('[stripe-webhook] subscription.updated error:', error.message);
        }

        console.log(`[stripe-webhook] Subscription updated: ${customerId} → ${status} (mapped: ${newStatus ?? 'no-op'})`);
        break;
      }

      // ── Invoice payment failed → flag past_due ────────────────────────────
      case 'invoice.payment_failed': {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await supa.from('profiles')
          .update({ subscription_status: 'free' })
          .eq('stripe_customer_id', customerId);

        console.log(`[stripe-webhook] Payment failed — reverted to free for customer ${customerId}`);
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }
  } catch (e: any) {
    console.error('[stripe-webhook] Handler error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// ── Look up Supabase user ID by email ─────────────────────────────────────────
// Uses a SECURITY DEFINER RPC to query auth.users — fast, indexed, no scan.
// Fallback: Supabase admin listUsers (works but slow at 1000+ users).
// SQL to create the RPC (run once in Supabase SQL editor):
//   CREATE OR REPLACE FUNCTION get_user_id_by_email(p_email text)
//   RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
//     SELECT id FROM auth.users WHERE email = lower(p_email) LIMIT 1;
//   $$;
async function getUserIdByEmail(supa: any, email: string): Promise<string | null> {
  // Try fast RPC first
  const { data: rpcData, error: rpcError } = await supa
    .rpc('get_user_id_by_email', { p_email: email.toLowerCase() });

  if (!rpcError && rpcData) {
    return rpcData as string;
  }

  if (rpcError) {
    console.warn('[stripe-webhook] RPC get_user_id_by_email failed (run the SQL to create it):', rpcError.message);
  }

  // Fallback: page through auth.users (works for any count, slower)
  let page = 1;
  while (true) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('[stripe-webhook] listUsers error:', error.message); break; }
    if (!data?.users?.length) break;
    const user = data.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (data.users.length < 1000) break; // last page
    page++;
  }

  return null;
}
