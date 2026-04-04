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

        // Determine monthly vs annual interval from the subscription
        let planInterval = 'month';
        if (session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            planInterval = sub.items.data[0]?.price?.recurring?.interval ?? 'month';
          } catch (e: any) {
            console.warn('[stripe-webhook] Could not fetch subscription interval:', e.message);
          }
        }

        // Check current status before updating — Stripe may retry this webhook,
        // and we only want to send the welcome email on the first activation.
        const { data: existing } = await supa.from('profiles')
          .select('subscription_status')
          .eq('id', userId)
          .single();
        const alreadyPro = existing?.subscription_status === 'pro';

        await supa.from('profiles').update({
          subscription_status: 'pro',
          stripe_customer_id:  customerId,
          trial_ends_at:       null,
          plan_interval:       planInterval,
        }).eq('id', userId);

        if (!alreadyPro) {
          const { data: profile } = await supa.from('profiles').select('display_name').eq('id', userId).single();
          await sendWelcomeEmail(customerEmail, profile?.display_name ?? undefined);
        }
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
        if (status === 'active' || status === 'trialing' || status === 'past_due') {
          // past_due = payment failed but Stripe is still retrying — keep access during grace period
          newStatus = 'pro';
        } else if (status === 'canceled' || status === 'unpaid') {
          // canceled = explicitly ended; unpaid = Stripe gave up retrying
          newStatus = 'free';
        }

        if (newStatus) {
          const planInterval = sub.items.data[0]?.price?.recurring?.interval ?? 'month';
          const { error } = await supa.from('profiles')
            .update({ subscription_status: newStatus, plan_interval: planInterval })
            .eq('stripe_customer_id', customerId);
          if (error) console.error('[stripe-webhook] subscription.updated error:', error.message);
        }

        console.log(`[stripe-webhook] Subscription updated: ${customerId} → ${status} (mapped: ${newStatus ?? 'no-op'})`);
        break;
      }

      // ── Invoice payment failed → log only, do NOT downgrade yet ─────────
      // Stripe retries failed payments multiple times before marking a subscription
      // as 'canceled' or 'unpaid'. The subscription.updated handler covers the
      // final downgrade when Stripe gives up. Downgrading here would strip access
      // on the very first retry attempt.
      case 'invoice.payment_failed': {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        console.log(`[stripe-webhook] Payment failed for customer ${customerId} — Stripe will retry, no status change`);
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
function buildWelcomeEmail(name?: string): string {
  const greeting = name ? name.split(' ')[0] : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Welcome to VORTEX</title>
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
      <div style="font-size:20px;font-weight:700;color:#e8edf5;margin-bottom:12px;">
        ${greeting ? `Welcome, ${greeting}.` : 'Welcome to VORTEX.'}
      </div>
      <div style="font-size:14px;color:#c8d0dc;line-height:1.7;margin-bottom:28px;">
        Your 14-day free trial is active. VORTEX is watching for severe weather at your location around the clock — even when your phone is face down and Do Not Disturb is on.
      </div>

      <!-- Features -->
      <div style="background:#13161b;border:1px solid #1e2229;border-radius:6px;padding:20px 24px;margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#5a6475;text-transform:uppercase;margin-bottom:16px;">What's included</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;width:28px;font-size:16px;">📞</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Phone Call Alerts</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Tornado and flash flood warnings call your phone directly — even when it's face down and Do Not Disturb is on. Proximity alerts also call you when a tornado is tracking toward your location and you're outside the warning area.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;font-size:16px;">🔔</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Push Notifications</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">NWS warnings, watches, and rapid pressure drop alerts — all togglable in Settings.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;font-size:16px;">📊</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Storm Risk Score</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">A 0–100 danger index from real atmospheric data — CAPE, helicity, wind shear, and more. Get alerted before the NWS issues anything.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;font-size:16px;">🗺</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Live Weather Map</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Live radar, NWS warning polygons, risk overlay, wildfires, and earthquakes — all on one screen.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;font-size:16px;">📍</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Multi-Location Monitoring</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Monitor home plus up to 3 additional cities, each with independent background alerting running 24/7.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #1e2229;vertical-align:top;font-size:16px;">🕐</td>
            <td style="padding:8px 0 8px 10px;border-bottom:1px solid #1e2229;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Alert History</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">A full log of every alert sent to you — event type, area, push and call status — for the last 30 days. Find it in Settings.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-size:16px;">💡</td>
            <td style="padding:8px 0 8px 10px;vertical-align:top;">
              <div style="font-size:13px;font-weight:600;color:#f5a623;">Philips Hue Integration (Beta)</div>
              <div style="font-size:12px;color:#5a6475;margin-top:2px;">Trigger your smart lights on severe weather alerts. Configure in Settings.</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="https://vortexintel.app" style="display:inline-block;background:#f5a623;color:#000;font-weight:700;font-size:14px;letter-spacing:2px;text-decoration:none;padding:14px 36px;border-radius:4px;">
          OPEN VORTEX →
        </a>
      </div>

      <!-- Setup tips -->
      <div style="font-size:12px;color:#5a6475;line-height:1.8;border-top:1px solid #1e2229;padding-top:20px;">
        <div style="color:#c8d0dc;font-weight:600;margin-bottom:8px;">Get set up in 2 minutes:</div>
        <div>1. Set your <strong style="color:#c8d0dc;">home location</strong> in Settings</div>
        <div>2. Add your <strong style="color:#c8d0dc;">phone number</strong> to enable call alerts</div>
        <div>3. Install the <strong style="color:#c8d0dc;">ntfy app</strong> and paste your channel URL for push notifications</div>
        <div style="margin-top:10px;">📱 <strong style="color:#c8d0dc;">Install on iPhone:</strong> open vortexintel.app in Safari → Share → "Add to Home Screen"</div>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#0a0b0d;padding:16px 32px;border-top:1px solid #1e2229;text-align:center;">
      <div style="font-size:11px;color:#5a6475;line-height:1.8;">
        Your trial runs for 14 days. No charge until it ends.<br>
        Cancel anytime from Settings → Manage Subscription.<br>
        <br>
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
}

async function sendWelcomeEmail(to: string, name?: string): Promise<void> {
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
        html:    buildWelcomeEmail(name),
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
