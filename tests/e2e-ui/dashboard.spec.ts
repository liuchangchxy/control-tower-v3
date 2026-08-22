import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('loads and displays server status', async ({ page }) => {
    await page.goto('/');
    // Should show the dashboard with server status
    await expect(page.locator('text=Control Tower')).toBeVisible({ timeout: 10000 });
    // Status should be one of the known states
    const statusText = page.getByText(/stopped|loading|ready|starting|error/);
    await expect(statusText.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Profile Form', () => {
  test('text input accepts non-numeric characters (C4 regression)', async ({ page }) => {
    // Navigate to create profile page
    await page.goto('/profiles/new');

    // Find the SERVED_NAME input — should be type="text", not type="number"
    const servedNameInput = page.locator('input[type="text"]').first();
    await expect(servedNameInput).toBeVisible({ timeout: 10000 });

    // Type a model name with hyphens and letters — should work
    await servedNameInput.fill('qwen36-27b-int4');
    await expect(servedNameInput).toHaveValue('qwen36-27b-int4');
  });

  test('numeric fields accept decimal values', async ({ page }) => {
    await page.goto('/profiles/new');

    // Find a number input (GPU_UTIL or similar)
    const numberInput = page.locator('input[type="number"]').first();
    await expect(numberInput).toBeVisible({ timeout: 10000 });

    // Should accept decimal input
    await numberInput.fill('0.88');
    await expect(numberInput).toHaveValue('0.88');
  });
});

test.describe('Profiles Page', () => {
  test('loads and displays profile list', async ({ page }) => {
    await page.goto('/profiles');

    // Should show at least one profile card
    await expect(page.locator('text=/.*\\.env/').first()).toBeVisible({ timeout: 10000 });
  });
});
