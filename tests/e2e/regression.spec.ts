import { test, expect, Page } from '@playwright/test';

const VIEWPORTS = [
  // Mobile
  { width: 360, height: 800, name: 'mobile-360x800', isMobile: true },
  { width: 375, height: 812, name: 'mobile-375x812', isMobile: true },
  { width: 390, height: 844, name: 'mobile-390x844', isMobile: true },
  { width: 430, height: 932, name: 'mobile-430x932', isMobile: true },
  // Tablet
  { width: 768, height: 1024, name: 'tablet-768x1024', isMobile: true }, // <= 1150px uses mobile header
  // Desktop
  { width: 1366, height: 768, name: 'desktop-1366x768', isMobile: false },
  { width: 1920, height: 1080, name: 'desktop-1920x1080', isMobile: false },
];

const EXPECTED_NAV_ITEMS = [
  'Trang chủ',
  'Kế hoạch và hoạt động',
  'Đóng quỹ hoạt động',
  'Danh sách đóng góp',
  'Danh sách chi tiêu',
  'Quay số may mắn',
  'Quyết toán',
];

async function ensurePageReady(page: Page) {
  await page.goto('/');
  await expect(page.locator('.brand-main-title')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.hero-card')).toBeVisible({ timeout: 10000 });
}

async function navigateTo(page: Page, isMobile: boolean, linkText: string) {
  await ensurePageReady(page);
  if (isMobile) {
    const toggle = page.locator('.navbar-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    const drawer = page.locator('.mobile-nav-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await drawer.locator('button', { hasText: linkText }).first().click();
    await page.waitForTimeout(200);
  } else {
    await page.locator('.desktop-nav-links .nav-link', { hasText: linkText }).click();
    await page.waitForTimeout(200);
  }
}

test.describe('Pre-Hybrid Quality Gate — E2E Layout & Responsiveness', () => {
  for (const vp of VIEWPORTS) {
    test.describe(`Viewport: ${vp.name} (${vp.width}x${vp.height})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
      });

      test('Header layout, navigation labels, and zero horizontal scroll on Home', async ({ page }) => {
        await ensurePageReady(page);

        // Global overflow assertion
        const geo = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth);

        if (vp.isMobile) {
          // Verify Hamburger Button & SVG Icon geometry
          const toggle = page.locator('.navbar-toggle');
          await expect(toggle).toBeVisible();

          const toggleBox = await toggle.boundingBox();
          expect(toggleBox).not.toBeNull();
          if (toggleBox) {
            expect(toggleBox.width).toBe(44);
            expect(toggleBox.height).toBe(44);
            expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(vp.width - 12);
          }

          const icon = page.locator('.navbar-toggle-icon');
          await expect(icon).toBeVisible();
          const iconBox = await icon.boundingBox();
          expect(iconBox).not.toBeNull();
          if (iconBox) {
            expect(iconBox.width).toBe(24);
            expect(iconBox.height).toBe(24);
            expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(vp.width - 20);
          }

          // Open drawer
          await toggle.click();
          await expect(page.locator('.mobile-nav-drawer')).toBeVisible({ timeout: 5000 });

          // Drawer items order and exact Vietnamese text
          const navItems = page.locator('.mobile-nav-item');
          const count = await navItems.count();
          expect(count).toBeGreaterThanOrEqual(7);

          for (let i = 0; i < EXPECTED_NAV_ITEMS.length; i++) {
            const text = await navItems.nth(i).innerText();
            expect(text).toContain(EXPECTED_NAV_ITEMS[i]);
          }

          // Close drawer
          await toggle.click();
          await expect(page.locator('.mobile-nav-drawer')).toBeHidden({ timeout: 5000 });
        } else {
          // Desktop nav items visible
          await expect(page.locator('.desktop-nav-links')).toBeVisible();
        }
      });

      test('Contributors page cards/tables have no horizontal overflow', async ({ page }) => {
        await navigateTo(page, vp.isMobile, 'Danh sách đóng góp');
        await expect(page.locator('.card-title', { hasText: 'Danh Sách Đóng Góp' })).toBeVisible({ timeout: 10000 });

        const geo = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth);
      });

      test('Expenses page cards and receipts have no horizontal overflow', async ({ page }) => {
        await navigateTo(page, vp.isMobile, 'Danh sách chi tiêu');
        await expect(page.locator('.card-title', { hasText: 'Danh Sách Khoản Chi Minh Bạch' })).toBeVisible({ timeout: 10000 });

        const geo = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth);
      });

      test('AuthShell Login & Register forms usability and zero overflow', async ({ page }) => {
        await ensurePageReady(page);

        if (vp.isMobile) {
          const toggle = page.locator('.navbar-toggle');
          await expect(toggle).toBeVisible();
          await toggle.click();
          await expect(page.locator('.mobile-nav-drawer')).toBeVisible({ timeout: 5000 });
          await page.locator('.mobile-auth-guest-grid button', { hasText: 'Đăng nhập' }).click();
        } else {
          await page.locator('.desktop-auth-buttons button', { hasText: 'Đăng nhập' }).click();
        }

        const loginCard = page.locator('.auth-shell-card');
        await expect(loginCard).toBeVisible({ timeout: 10000 });

        let geo = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth);

        // Switch to register
        await page.getByRole('button', { name: 'Đăng ký ngay' }).click();
        const registerCard = page.locator('.auth-shell-card');
        await expect(registerCard).toBeVisible({ timeout: 10000 });

        geo = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth);
      });

      test('Lucky Wheel Page responsive layout integrity', async ({ page }) => {
        await navigateTo(page, vp.isMobile, 'Quay số may mắn');
        await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });

        const geo = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth);
      });
    });
  }
});
