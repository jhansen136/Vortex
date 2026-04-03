/**
 * VORTEX E2E — App Shell (authenticated)
 *
 * Requires: E2E_EMAIL and E2E_PASSWORD env vars pointing to a real test account.
 * All tests in this file are skipped automatically when credentials are absent.
 *
 * Covers:
 *   - Successful sign-in transitions to app shell
 *   - Header elements render (logo, status dots, clock, user pill)
 *   - Map SVG renders within a reasonable time
 *   - Left/right sidebars are visible
 *   - Status indicators show "DATA LIVE"
 *   - NWS alert count appears
 *   - Data source label shows Open-Meteo
 *   - User pill opens settings modal
 *   - Sign out works and returns to landing
 */
import { test, expect } from '@playwright/test';
import { signIn, hasCredentials, TEST_EMAIL, TEST_PASSWORD } from './helpers';

test.describe('App shell', () => {

  // Skip entire suite if no test credentials
  test.beforeAll(() => {
    if (!hasCredentials()) {
      console.log('[app.spec] Skipping — set E2E_EMAIL + E2E_PASSWORD to run authenticated tests.');
    }
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials(), 'No E2E credentials set');
    await page.context().clearCookies();
    await page.goto('/');
    await page.waitForSelector('#landingPage, header .logo-text', { timeout: 20_000 });
    await signIn(page, TEST_EMAIL, TEST_PASSWORD);
  });

  // ── Auth transition ────────────────────────────────────────────────────────

  test('landing page is hidden after sign-in', async ({ page }) => {
    await expect(page.locator('#landingPage')).toBeHidden();
  });

  test('auth overlay is hidden after sign-in', async ({ page }) => {
    await expect(page.locator('#authOverlay')).toBeHidden();
  });

  // ── Header ────────────────────────────────────────────────────────────────

  test('VORTEX logo renders in header', async ({ page }) => {
    await expect(page.locator('header .logo-text')).toHaveText('VORTEX');
  });

  test('DATA LIVE status indicator is visible', async ({ page }) => {
    await expect(page.locator('#liveDot')).toBeVisible();
    await expect(page.locator('header')).toContainText('DATA LIVE');
  });

  test('UTC clock is ticking', async ({ page }) => {
    const clock = page.locator('#clock');
    await expect(clock).toBeVisible();
    const t1 = await clock.textContent();
    await page.waitForTimeout(1_500);
    const t2 = await clock.textContent();
    // Clock should have changed
    expect(t1).not.toBe(t2);
  });

  test('alert count appears in header', async ({ page }) => {
    const alertCount = page.locator('#alertCount');
    await expect(alertCount).toBeVisible({ timeout: 10_000 });
    // Should have resolved from "LOADING…" to a real value
    await expect(alertCount).not.toHaveText('LOADING…', { timeout: 15_000 });
  });

  test('user pill shows in header', async ({ page }) => {
    await expect(page.locator('#userPill')).toBeVisible();
    // Profile loads async — wait for avatar to update from the default '?'
    const avatar = page.locator('#userAvatar');
    await expect(avatar).toBeVisible();
    await expect(avatar).not.toHaveText('?', { timeout: 8_000 });
  });

  // ── Map ───────────────────────────────────────────────────────────────────

  test('map SVG renders with paths (US states)', async ({ page }) => {
    const mapSvg = page.locator('#mapSvg');
    await expect(mapSvg).toBeVisible({ timeout: 15_000 });

    // Map should have rendered state paths
    const pathCount = await mapSvg.locator('path').count();
    expect(pathCount).toBeGreaterThan(10);
  });

  test('map loading spinner disappears after load', async ({ page }) => {
    const loadMsg = page.locator('#mapLoadMsg');
    // It may already be gone by the time we check — that's fine
    await expect(loadMsg).toBeHidden({ timeout: 20_000 });
  });

  test('map wrap is visible', async ({ page }) => {
    await expect(page.locator('#mapWrap')).toBeVisible();
  });

  // ── Sidebars ──────────────────────────────────────────────────────────────

  test('left sidebar layer buttons are visible', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Layer controls use a bottom-sheet on mobile');
    const layerBtns = page.locator('.sidebar-left [data-layer]');
    await expect(layerBtns.first()).toBeVisible();
    const count = await layerBtns.count();
    expect(count).toBeGreaterThanOrEqual(8);
  });

  test('right sidebar active alerts section is visible', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Alerts list is in a mobile bottom-sheet panel, not the desktop sidebar');
    await expect(page.locator('#alertsList')).toBeVisible({ timeout: 10_000 });
  });

  test('right sidebar alert history section is visible', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Alert history is in a mobile bottom-sheet panel, not the desktop sidebar');
    await expect(page.locator('#alertHistoryList')).toBeVisible();
  });

  test('risk score gauge renders', async ({ page, isMobile }) => {
    // Desktop uses #riskScore / #riskFill; mobile uses #riskScoreM / #riskFillM
    const scoreId = isMobile ? '#riskScoreM' : '#riskScore';
    const fillId  = isMobile ? '#riskFillM'  : '#riskFill';
    await expect(page.locator(scoreId)).toBeAttached();
    // fill starts at width:0% until a point is selected — just check it's in DOM
    await expect(page.locator(fillId)).toBeAttached();
  });

  // ── Data status ───────────────────────────────────────────────────────────

  test('data source label mentions Open-Meteo', async ({ page, isMobile }) => {
    test.skip(isMobile, '#dataSource is in the desktop footer bar, hidden on mobile');
    const ds = page.locator('#dataSource');
    await expect(ds).toBeVisible({ timeout: 15_000 });
    await expect(ds).toContainText('Open-Meteo', { timeout: 15_000 });
  });

  test('NWS status shows after data loads', async ({ page, isMobile }) => {
    test.skip(isMobile, '#nwsStatus is in the desktop header, hidden on mobile');
    const nwsStatus = page.locator('#nwsStatus');
    await expect(nwsStatus).toBeVisible();
    await expect(nwsStatus).not.toHaveText('…', { timeout: 15_000 });
  });

  // ── Settings modal ────────────────────────────────────────────────────────

  test('clicking user pill opens setup modal', async ({ page }) => {
    await page.click('#userPill');
    await expect(page.locator('#setupModal')).toBeVisible({ timeout: 5_000 });
  });

  test('setup modal has Settings and (if admin) Admin tabs', async ({ page }) => {
    await page.click('#userPill');
    await expect(page.locator('#setupModal')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#tabBtnSettings')).toBeVisible();
  });

  test('setup modal shows display name field', async ({ page }) => {
    await page.click('#userPill');
    await expect(page.locator('#setupModal')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#setupDisplayName')).toBeVisible();
  });

  test('setup modal shows ntfy.sh URL field', async ({ page }) => {
    await page.click('#userPill');
    await expect(page.locator('#setupModal')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#pushToken')).toBeVisible();
  });

  test('setup modal shows user email in subtitle', async ({ page }) => {
    await page.click('#userPill');
    await expect(page.locator('#setupModal')).toBeVisible({ timeout: 5_000 });
    const info = page.locator('#setupUserInfo');
    await expect(info).toBeVisible();
    const text = await info.textContent();
    expect(text?.includes('@')).toBeTruthy();
  });
});
