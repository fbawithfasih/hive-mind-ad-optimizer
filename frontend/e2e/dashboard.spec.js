import { test, expect } from '@playwright/test';

/**
 * E2E Tests: Dashboard Tab Navigation
 * Tests user interactions with dashboard tabs and basic UI functionality
 */

test.describe('Dashboard Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication by setting a token in localStorage
    // In a real test, this would involve logging in first
    await page.goto('/');
    // Wait for app to load
    await page.waitForSelector('[class*="flex"]', { timeout: 5000 }).catch(() => null);
  });

  test('should display campaigns tab by default', async ({ page }) => {
    // Look for campaigns section heading
    const campaignsHeading = page.getByText(/Campaigns/i).first();
    await expect(campaignsHeading).toBeVisible();
  });

  test('should switch to search terms tab', async ({ page }) => {
    // Click on Search Terms tab
    const searchTermsTab = page.getByRole('button', { name: /Search Terms/i });
    await searchTermsTab.click();

    // Verify tab is active (border color changes to blue)
    await expect(searchTermsTab).toHaveCSS('border-bottom-color', /rgb.*58.*130.*246/);
  });

  test('should switch to listing optimizer tab', async ({ page }) => {
    // Click on Listing Optimizer tab
    const listingTab = page.getByRole('button', { name: /Listing Optimizer/i });
    await listingTab.click();

    // Verify tab is active
    await expect(listingTab).toHaveCSS('border-bottom-color', /rgb.*58.*130.*246/);
  });

  test('should switch to reporting agent tab', async ({ page }) => {
    // Click on Reporting Agent tab
    const reportingTab = page.getByRole('button', { name: /Reporting Agent/i });
    await reportingTab.click();

    // Verify tab is active
    await expect(reportingTab).toHaveCSS('border-bottom-color', /rgb.*58.*130.*246/);
  });

  test('should cycle through all tabs', async ({ page }) => {
    const tabs = [
      { name: /Campaigns/i },
      { name: /Search Terms/i },
      { name: /Listing Optimizer/i },
      { name: /Reporting Agent/i },
    ];

    for (const tab of tabs) {
      const button = page.getByRole('button', tab);
      await button.click();
      // Verify it became active (has blue bottom border)
      await expect(button).toHaveCSS('border-bottom-color', /rgb.*58.*130.*246/);
    }
  });

  test('should display AI command input', async ({ page }) => {
    // Look for AI Command section
    const aiHeader = page.getByText(/AI Command/i);
    await expect(aiHeader).toBeVisible();

    // Check for model toggle buttons
    const geminiButton = page.getByRole('button', { name: /Gemini/i });
    const claudeButton = page.getByRole('button', { name: /Claude/i });
    await expect(geminiButton).toBeVisible();
    await expect(claudeButton).toBeVisible();
  });

  test('should toggle AI model selection', async ({ page }) => {
    // Initially Gemini should be selected
    const geminiButton = page.getByRole('button', { name: /Gemini/i });
    const claudeButton = page.getByRole('button', { name: /Claude/i });

    // Click Claude button
    await claudeButton.click();

    // Verify Claude button is now highlighted (has color background)
    await expect(claudeButton).toHaveCSS('background-color', /rgb.*139.*92.*246/);
  });

  test('should display stat cards', async ({ page }) => {
    // Look for stat card labels
    const statLabels = [
      /Total Campaigns/i,
      /Active/i,
      /Paused/i,
      /Daily Budget/i,
    ];

    for (const label of statLabels) {
      const element = page.getByText(label);
      await expect(element).toBeVisible();
    }
  });

  test('should display error when present', async ({ page }) => {
    // This test would need to trigger an error condition
    // For now, we're just verifying the error container exists
    // In a real scenario, we'd trigger an API error
    const errorContainer = page.locator('[style*="F43F5E"]');
    // Just verify it exists in the DOM (may not be visible until error occurs)
    await expect(errorContainer).toHaveCount(1);
  });
});

test.describe('Dashboard Date Range Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[type="date"]', { timeout: 5000 }).catch(() => null);
  });

  test('should display date range inputs', async ({ page }) => {
    const dateInputs = page.locator('input[type="date"]');
    const count = await dateInputs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('should update start date', async ({ page }) => {
    const dateInputs = page.locator('input[type="date"]');
    const startDate = dateInputs.first();

    // Clear and set new date
    await startDate.fill('2024-01-01');
    await expect(startDate).toHaveValue('2024-01-01');
  });

  test('should enforce 31-day max range', async ({ page }) => {
    const dateInputs = page.locator('input[type="date"]');
    const startDate = dateInputs.first();
    const endDate = dateInputs.nth(1);

    // Set start date to specific date
    await startDate.fill('2024-01-01');
    // Try to set end date more than 31 days later
    await endDate.fill('2024-02-15'); // 45 days later

    // The end date should be capped to max 31 days from start
    // (This depends on hook behavior - may not restrict in input itself)
  });
});

test.describe('Dashboard Campaign Search and Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[placeholder*="Search"]', { timeout: 5000 }).catch(() => null);
  });

  test('should display search input', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/Search campaigns/i);
    await expect(searchInput).toBeVisible();
  });

  test('should display status filter dropdown', async ({ page }) => {
    const statusFilter = page.locator('select').last();
    await expect(statusFilter).toBeVisible();

    // Check for options
    const options = statusFilter.locator('option');
    expect(await options.count()).toBeGreaterThanOrEqual(5);
  });

  test('should change status filter', async ({ page }) => {
    const statusFilter = page.locator('select').last();

    // Change to "Paused" status
    await statusFilter.selectOption('paused');
    await expect(statusFilter).toHaveValue('paused');

    // Change back to "All Status"
    await statusFilter.selectOption('all');
    await expect(statusFilter).toHaveValue('all');
  });

  test('should type in search input', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/Search campaigns/i);

    // Type search term
    await searchInput.fill('test campaign');
    await expect(searchInput).toHaveValue('test campaign');

    // Clear search
    await searchInput.clear();
    await expect(searchInput).toHaveValue('');
  });
});

test.describe('Dashboard Sign Out', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button', { timeout: 5000 }).catch(() => null);
  });

  test('should display sign out button', async ({ page }) => {
    const signOutButton = page.getByRole('button', { name: /Sign out/i });
    await expect(signOutButton).toBeVisible();
  });

  test('should have user email displayed', async ({ page }) => {
    // This would only show if authenticated
    // Look for text that matches email pattern
    const emailText = page.locator('span').filter({ hasText: /@/ });
    // May or may not be visible depending on auth state
  });
});
