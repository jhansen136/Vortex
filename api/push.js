/**
 * /api/push.js — Vercel Serverless Function
 *
 * VORTEX push notification proxy (FIX: Critical #2)
 * Routes ntfy.sh notifications server-side so the channel URL
 * is never exposed in browser source or DevTools network tab.
 *
 * Setup:
 *   1. In Vercel dashboard → Settings → Environment Variables, add:
 *      NTFY_URL = https://ntfy.sh/your-private-channel-name
 *   2. Deploy — /api/push will be available automatically
 *
 * The frontend calls POST /api/push with JSON body:
 *   { title, body, priority, tags }
 */

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read ntfy URL from server-side environment variable (never in client code)
  const ntfyUrl = process.env.NTFY_URL;
  if (!ntfyUrl) {
    return res.status(503).json({ error: 'Push notifications not configured on server' });
  }

  // Parse request body
  let title, body, priority, tags;
  try {
    ({ title, body, priority, tags } = req.body);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (!body) {
    return res.status(400).json({ error: 'Missing body field' });
  }

  // Basic rate limiting: reject obviously malformed inputs
  if (typeof title !== 'string' || typeof body !== 'string') {
    return res.status(400).json({ error: 'title and body must be strings' });
  }
  if (body.length > 2000 || title?.length > 200) {
    return res.status(400).json({ error: 'Payload too large' });
  }

  try {
    const response = await fetch(ntfyUrl, {
      method: 'POST',
      body: body,
      headers: {
        'Title':    title    || 'VORTEX Alert',
        'Priority': priority || 'high',
        'Tags':     tags     || 'rotating_light',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `ntfy responded with ${response.status}` });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[VORTEX push proxy error]', err);
    return res.status(502).json({ error: 'Failed to reach ntfy.sh' });
  }
}
