import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@13.3.0';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY     = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL            = 'VORTEX <noreply@vortexintel.app>';

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

        await sendWelcomeEmail(customerEmail);
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

// ── Welcome email ─────────────────────────────────────────────────────────────
async function sendWelcomeEmail(to: string): Promise<void> {
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
      <div style="font-size:18px;font-weight:700;letter-spacing:2px;color:#e8edf5;margin-bottom:16px;">WELCOME TO VORTEX</div>
      <div style="font-size:13px;color:#c8d0dc;line-height:1.8;margin-bottom:24px;">
        Your 7-day free trial is now active. You have full access to everything VORTEX has to offer:
      </div>
      <div style="margin-bottom:24px;">
        <div style="font-size:12px;color:#c8d0dc;line-height:2;">
          <div>⚡ <span style="color:#f5a623;font-weight:700;">Real-time NWS alerts</span> — tornado warnings, severe thunderstorms, and more delivered in under 60 seconds</div>
          <div>🌡 <span style="color:#f5a623;font-weight:700;">Live weather map</span> — temperature, wind, and risk overlays across the US</div>
          <div>📍 <span style="color:#f5a623;font-weight:700;">Push notifications</span> — get alerted the moment a warning is issued for your area</div>
          <div>📊 <span style="color:#f5a623;font-weight:700;">Risk scoring</span> — 0–100 storm risk index updated every minute</div>
        </div>
      </div>
      <div style="text-align:center;margin:28px 0;">
        <a href="https://vortexintel.app" style="display:inline-block;background:#f5a623;color:#000;font-weight:700;font-size:14px;letter-spacing:2px;text-decoration:none;padding:13px 32px;border-radius:4px;">
          OPEN VORTEX →
        </a>
      </div>
      <div style="font-size:11px;color:#5a6475;line-height:1.7;border-top:1px solid #1e2229;padding-top:16px;">
        <strong style="color:#c8d0dc;">Pro tip:</strong> Add VORTEX to your iPhone home screen for instant access — open <span style="color:#00d4ff;">vortexintel.app</span> in Safari, tap Share, then "Add to Home Screen."<br><br>
        Your trial runs for 7 days. No charge until it ends — cancel anytime from Settings.
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
        to:      [to],
        subject: 'Welcome to VORTEX — your trial is active',
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[stripe-webhook] Welcome email failed:', err);
    } else {
      console.log(`[stripe-webhook] Welcome email sent to ${to}`);
    }
  } catch (err) {
    console.error('[stripe-webhook] Welcome email error:', err);
  }
}

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
