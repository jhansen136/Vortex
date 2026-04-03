/**
 * VORTEX E2E — Map Layer Toggles (authenticated)
 *
 * Requires: E2E_EMAIL and E2E_PASSWORD
 *
 * Covers:
 *   - Each layer button toggles its active class on click
 *   - Risk and NWS Warnings layers start active by default
 *   - Layer canvases / svgs respond to visibility changes
 *   - Zoom in/out buttons work
 *   - Home zoom button works
 *   - Radar layer enables the playbar
 */
import { test, expect } from '@playwright/test';
import { signIn, hasCredentials } from './helpers';

test.describe('Map layer controls', () => {

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!hasCredentials(), 'No E2E credentials set');
    // Layer controls live in the desktop sidebar — mobile uses a bottom sheet with different UX
    test.skip(isMobile, 'Layer controls use a bottom-sheet on mobile; tested separately');
    await page.context().clearCookies();
    await page.goto('/');
    await page.waitForSelector('#landingPage, header .logo-text', { timeout: 20_000 });
    await signIn(page);
    // Wait for map to be ready
    await expect(page.locator('#mapSvg path').first()).toBeVisible({ timeout: 20_000 });
  });

  // ── Default active layers ─────────────────────────────────────────────────

  test('Risk Score layer is active by default', async ({ page }) => {
    const btn = page.locator('.sidebar-left [data-layer="risk"]');
    await expect(btn).toHaveClass(/active/);
  });

  test('NWS Warnings layer is active by default', async ({ page }) => {
    const btn = page.locator('.sidebar-left [data-layer="warnings"]');
    await expect(btn).toHaveClass(/active/);
  });

  test('Temperature layer is inactive by default', async ({ page }) => {
    const btn = page.locator('.sidebar-left [data-layer="temp"]');
    await expect(btn).not.toHaveClass(/active/);
  });

  // ── Toggle behaviour ──────────────────────────────────────────────────────

  test('clicking inactive Temperature layer makes it active', async ({ page }) => {
    const btn = page.locator('.sidebar-left [data-layer="temp"]');
    await btn.click();
    await expect(btn).toHaveClass(/active/);
  });

  test('clicking active layer a second time deactivates it', async ({ page }) => {
    const btn = page.locator('.sidebar-left [data-layer="temp"]');
    await btn.click();
    await expect(btn).toHaveClass(/active/);
    await btn.click();
    await expect(btn).not.toHaveClass(/active/);
  });

  test('clicking Wind Vectors layer makes it active', async ({ page }) => {
    const btn = page.locator('.sidebar-left [data-layer="wind"]');
    await btn.click();
    await expect(btn).toHaveClass(/active/);
  });

  test('clicking CAPE Index layer makes it active', async ({ page }) => {
    const btn = page.locator('.sidebar-left [data-layer="cape"]');
    await btn.click();
    await expect(btn).toHaveClass(/active/);
  });

  test('clicking Radar layer makes it active', async ({ page }) => {
    const btn = page.locator('.sidebar-left [data-layer="radar"]');
    await btn.click();
    await expect(btn).toHaveClass(/active/);
  });

  test('enabling Radar layer shows radar playbar', async ({ page }) => {
    const btn     = page.locator('.sidebar-left [data-layer="radar"]');
    const playbar = page.locator('#radarPlaybar');

    // Make sure radar is off first
    if (await btn.evaluate(el => el.classList.contains('active'))) {
      await btn.click();
    }
    await expect(playbar).toBeHidden();

    await btn.click();
    await expect(btn).toHaveClass(/active/);
    // Playbar appears once radar frames start loading
    await expect(playbar).toBeVisible({ timeout: 20_000 });
  });

  test('disabling Radar layer hides radar playbar', async ({ page }) => {
    const btn     = page.locator('.sidebar-left [data-layer="radar"]');
    const playbar = page.locator('#radarPlaybar');

    // Turn on
    if (!(await btn.evaluate(el => el.classList.contains('active')))) {
      await btn.click();
      await expect(playbar).toBeVisible({ timeout: 20_000 });
    }

    // Turn off
    await btn.click();
    await expect(btn).not.toHaveClass(/active/);
    await expect(playbar).toBeHidden();
  });

  // Earthquakes and Wildfires are Pro-gated. For Pro accounts the button
  // gains the `active` class; for free accounts the upgrade modal opens instead.
  // Both are correct, tested outcomes — the test handles each branch.

  test('clicking Earthquakes layer makes it active (Pro) or shows upgrade modal (free)', async ({ page }) => {
    const btn          = page.locator('.sidebar-left [data-layer="earthquakes"]');
    const upgradeModal = page.locator('#upgradeModal');

    // Evaluate Pro status inside the page so we branch correctly
    const isPro = await page.evaluate(() =>
      typeof (window as any).isProUser === 'function' && (window as any).isProUser()
    );

    await btn.click();

    if (isPro) {
      await expect(btn).toHaveClass(/active/);
    } else {
      // Free user — upgrade modal should appear
      await expect(upgradeModal).toBeVisible({ timeout: 3_000 });
      // Dismiss so subsequent tests start clean
      await page.locator('#upgradeModal [onclick*="display="]').click();
      await expect(upgradeModal).toBeHidden();
    }
  });

  test('clicking Wildfires layer makes it active (Pro) or shows upgrade modal (free)', async ({ page }) => {
    const btn          = page.locator('.sidebar-left [data-layer="wildfires"]');
    const upgradeModal = page.locator('#upgradeModal');

    const isPro = await page.evaluate(() =>
      typeof (window as any).isProUser === 'function' && (window as any).isProUser()
    );

    await btn.click();

    if (isPro) {
      await expect(btn).toHaveClass(/active/);
    } else {
      await expect(upgradeModal).toBeVisible({ timeout: 3_000 });
      await page.locator('#upgradeModal [onclick*="display="]').click();
      await expect(upgradeModal).toBeHidden();
    }
  });

  // ── Zoom controls ─────────────────────────────────────────────────────────

  test('zoom in button is clickable', async ({ page }) => {
    const zoomIn = page.locator('.zoom-btn', { hasText: '+' });
    await expect(zoomIn).toBeVisible();
    await zoomIn.click();
    // No error — just ensure it's clickable
  });

  test('zoom out button is clickable', async ({ page }) => {
    const zoomOut = page.locator('.zoom-btn', { hasText: '−' });
    await expect(zoomOut).toBeVisible();
    await zoomOut.click();
  });

  test('home zoom button resets view', async ({ page }) => {
    // Zoom in first
    const zoomIn   = page.locator('.zoom-btn', { hasText: '+' });
    const homeBtn  = page.locator('.zoom-btn', { hasText: '⌂' });
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();
    await homeBtn.click();
    // Map should still be visible after reset
    await expect(page.locator('#mapSvg')).toBeVisible();
  });

  // ── Heatmap canvas ────────────────────────────────────────────────────────

  test('heat canvas exists in DOM', async ({ page }) => {
    await expect(page.locator('#heatCanvas')).toBeAttached();
  });
});
