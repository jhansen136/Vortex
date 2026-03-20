import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@13.3.0';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY')!;
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
        if (!customerEmail) break;

        const userId = await getUserIdByEmail(supa, customerEmail);
        if (!userId) {
          console.error(`[stripe-webhook] No profile found for email: ${customerEmail}`);
          break;
        }

        await supa.from('profiles').update({
          subscription_status: 'pro',
          stripe_customer_id:  customerId,
          trial_ends_at:       null,
        }).eq('id', userId);

        console.log(`[stripe-webhook] Activated Pro for ${customerEmail}`);
        break;
      }

      // ── Subscription cancelled → revert to free ───────────────────────────
      case 'customer.subscription.deleted': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        await supa.from('profiles')
          .update({ subscription_status: 'free', stripe_customer_id: null })
          .eq('stripe_customer_id', customerId);

        console.log(`[stripe-webhook] Reverted to free for customer ${customerId}`);
        break;
      }

      // ── Subscription updated (plan change, renewal, past due) ─────────────
      case 'customer.subscription.updated': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const status     = sub.status;

        if (status === 'active' || status === 'trialing') {
          await supa.from('profiles')
            .update({ subscription_status: 'pro' })
            .eq('stripe_customer_id', customerId);
        } else if (status === 'past_due' || status === 'canceled' || status === 'unpaid') {
          await supa.from('profiles')
            .update({ subscription_status: 'free' })
            .eq('stripe_customer_id', customerId);
        }

        console.log(`[stripe-webhook] Subscription updated: ${customerId} → ${status}`);
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

// Look up a Supabase profile ID by email
async function getUserIdByEmail(supa: any, email: string): Promise<string | null> {
  // Check profiles table first (has display_name, role etc)
  const { data } = await supa
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (data?.id) return data.id;

  // Fall back to auth.users if email not stored in profiles
  const { data: authData } = await supa.auth.admin.listUsers();
  const user = (authData?.users || []).find((u: any) => u.email === email);
  return user?.id || null;
}
