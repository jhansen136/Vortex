/**
 * VORTEX E2E — Shared helpers
 */
import { type Page, expect } from '@playwright/test';

export const TEST_EMAIL    = process.env.E2E_EMAIL    ?? '';
export const TEST_PASSWORD = process.env.E2E_PASSWORD ?? '';

/** True only when real test credentials are provided in env. */
export const hasCredentials = () => !!TEST_EMAIL && !!TEST_PASSWORD;

/**
 * Sign in via the UI auth form.
 * Waits until the app shell header is visible (auth overlay gone).
 */
export async function signIn(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  // Make sure we're on the auth overlay / landing page
  const loginBtn = page.locator('#authLoginBtn');
  const overlay  = page.locator('#authOverlay');

  // If landing is showing, click Sign In first
  const landing = page.locator('#landingPage');
  if (await landing.isVisible()) {
    await page.click('.lp-signin-btn');
  }

  await expect(overlay).toBeVisible();
  await page.fill('#authEmail', email);
  await page.fill('#authPassword', password);
  await loginBtn.click();

  // Auth overlay must disappear and map must appear (works on both desktop and mobile viewports)
  await expect(overlay).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('#mapWrap')).toBeVisible({ timeout: 15_000 });

  // Pre-emptively mark onboarding as complete in localStorage so the 800ms-delayed
  // overlay can never appear (or re-appear) during the rest of this test.
  await page.evaluate(() => localStorage.setItem('vortex_onboarded', '1'));

  // If the overlay fired before our eval ran (tight race), dismiss it now.
  // Use .first() — there are multiple .ob-skip a elements (one per step) and
  // Playwright strict mode would throw without it, causing the catch to swallow
  // the error while the overlay stays visible and blocks all subsequent clicks.
  const onboarding = page.locator('#onboardingOverlay');
  try {
    await onboarding.waitFor({ state: 'visible', timeout: 1_500 });
    await page.locator('#onboardingOverlay .ob-skip a').first().click();
    await onboarding.waitFor({ state: 'hidden', timeout: 5_000 });
  } catch {
    // Onboarding didn't appear — expected for accounts that already completed it
  }
}

/**
 * Navigate to base URL and wait for the page to settle
 * (either landing page or app shell, depending on auth state).
 */
export async function gotoHome(page: Page) {
  await page.goto('/');
  // Wait for either landing or app header — one of them must appear
  await page.waitForSelector('#landingPage, header .logo-text', { timeout: 20_000 });
}
