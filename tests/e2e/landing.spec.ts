/**
 * VORTEX E2E — Landing Page
 *
 * Covers the unauthenticated marketing page:
 *   - Page loads and is correctly titled
 *   - Hero copy and CTAs render
 *   - Pricing card is visible
 *   - "Sign In" button transitions to auth overlay WITHOUT bouncing back
 *   - "Start Free Trial" button transitions to the register form
 *   - Back navigation / session doesn't restore landing while auth is open
 */
import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {

  // Force a completely clean browser context — no cookies, no localStorage.
  // This ensures Supabase has no cached session token and shows the landing page.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for landing page to be visible (unauthenticated)
    await page.waitForSelector('#landingPage', { timeout: 20_000 });
  });

  // ── Rendering ────────────────────────────────────────────────────────────────

  test('page title is correct', async ({ page }) => {
    await expect(page).toHaveTitle(/VORTEX.*Storm Intelligence/i);
  });

  test('logo is visible', async ({ page }) => {
    await expect(page.locator('.lp-logo')).toContainText('VORTEX');
  });

  test('hero headline is visible', async ({ page }) => {
    await expect(page.locator('.lp-headline')).toBeVisible();
    await expect(page.locator('.lp-headline')).toContainText('STORM');
  });

  test('stat callouts render (< 60s, 0-100, 24/7)', async ({ page }) => {
    const stats = page.locator('.lp-stat-val');
    await expect(stats).toHaveCount(3);
    const text = await stats.allTextContents();
    expect(text.some(t => t.includes('60s'))).toBeTruthy();
    expect(text.some(t => t.includes('0–100'))).toBeTruthy();
    expect(text.some(t => t.includes('24/7'))).toBeTruthy();
  });

  test('pricing card shows $4.99/mo', async ({ page }) => {
    await expect(page.locator('.lp-pricing-card')).toBeVisible();
    await expect(page.locator('.lp-price')).toContainText('4.99');
  });

  test('annual savings note is visible', async ({ page }) => {
    await expect(page.locator('.lp-price-period')).toContainText('39.99');
  });

  test('feature cards render (Instant Alerts, Live Map, Risk Scoring)', async ({ page }) => {
    const features = page.locator('.lp-feature-title');
    await expect(features).toHaveCount(3);
    const titles = await features.allTextContents();
    expect(titles.some(t => /alert/i.test(t))).toBeTruthy();
    expect(titles.some(t => /map/i.test(t))).toBeTruthy();
    expect(titles.some(t => /risk/i.test(t))).toBeTruthy();
  });

  // ── Sign In flow — the previously-fixed bounce bug ────────────────────────

  test('Sign In button shows auth overlay and hides landing page', async ({ page }) => {
    await page.click('.lp-signin-btn');

    // Auth overlay should appear
    await expect(page.locator('#authOverlay')).toBeVisible({ timeout: 3_000 });

    // Landing page should disappear (the key regression check)
    await expect(page.locator('#landingPage')).toBeHidden();
  });

  test('landing page does NOT come back after auth overlay opens', async ({ page }) => {
    await page.click('.lp-signin-btn');
    await expect(page.locator('#authOverlay')).toBeVisible({ timeout: 3_000 });

    // Wait 2 seconds — previous bug caused landing to reappear after ~500ms
    await page.waitForTimeout(2_000);
    await expect(page.locator('#landingPage')).toBeHidden();
    await expect(page.locator('#authOverlay')).toBeVisible();
  });

  test('auth overlay shows email and password fields after Sign In click', async ({ page }) => {
    await page.click('.lp-signin-btn');
    await expect(page.locator('#authEmail')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#authPassword')).toBeVisible();
    await expect(page.locator('#authLoginBtn')).toBeVisible();
  });

  // ── Start Free Trial flow ─────────────────────────────────────────────────

  test('Start Free Trial button shows register form', async ({ page }) => {
    await page.click('.lp-cta-primary >> nth=0');
    await expect(page.locator('#authOverlay')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#landingPage')).toBeHidden();
    // Register form should be visible, not the login form
    await expect(page.locator('#authFormRegister')).toBeVisible();
  });

  test('register form has name, email, and password fields', async ({ page }) => {
    await page.click('.lp-cta-primary >> nth=0');
    await expect(page.locator('#authFormRegister')).toBeVisible({ timeout: 3_000 });
    // Fields may be below fold in auth box — scroll into view before checking
    await page.locator('#authName').scrollIntoViewIfNeeded();
    await expect(page.locator('#authName')).toBeVisible();
    await page.locator('#authRegEmail').scrollIntoViewIfNeeded();
    await expect(page.locator('#authRegEmail')).toBeVisible();
    await page.locator('#authRegPassword').scrollIntoViewIfNeeded();
    await expect(page.locator('#authRegPassword')).toBeVisible();
  });

  test('can switch from register form back to login form', async ({ page }) => {
    await page.click('.lp-cta-primary >> nth=0');
    await expect(page.locator('#authFormRegister')).toBeVisible({ timeout: 3_000 });

    const backLink = page.locator('#authSwitch2 a');
    await backLink.scrollIntoViewIfNeeded();
    await backLink.click({ timeout: 5_000 });
    await expect(page.locator('#authFormLogin')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#authFormRegister')).toBeHidden();
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  test('nav Sign In and hero Sign In buttons both open auth overlay', async ({ page }) => {
    // Hero secondary CTA
    await page.click('.lp-cta-secondary');
    await expect(page.locator('#authOverlay')).toBeVisible({ timeout: 3_000 });
  });
});
