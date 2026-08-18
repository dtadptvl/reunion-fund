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

test.describe('H1 Routing, Deep Links, Back/Forward & Contribution Tests', () => {
  test('Desktop browser history navigation: pushState, Back, Forward', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    await expect(page.locator('.hero-card')).toBeVisible();
    expect(page.url()).toContain('/');

    // 1. Click Kế hoạch và hoạt động
    await page.locator('.desktop-nav-links .nav-link', { hasText: 'Kế hoạch và hoạt động' }).click();
    await expect(page).toHaveURL(/.*\/activities/);
    await expect(page.locator('.card-title', { hasText: 'Kế hoạch họp lớp' })).toBeVisible();

    // 2. Click Quyết toán
    await page.locator('.desktop-nav-links .nav-link', { hasText: 'Quyết toán' }).click();
    await expect(page).toHaveURL(/.*\/settlement/);
    await expect(page.locator('.card-title', { hasText: /QUỸ ĐANG HOẠT ĐỘNG|ĐÃ QUYẾT TOÁN/ })).toBeVisible();

    // 3. Browser Back -> Kế hoạch và hoạt động
    await page.goBack();
    await expect(page).toHaveURL(/.*\/activities/);
    await expect(page.locator('.card-title', { hasText: 'Kế hoạch họp lớp' })).toBeVisible();

    // 4. Browser Back -> Trang chủ
    await page.goBack();
    await expect(page.locator('.hero-card')).toBeVisible();

    // 5. Browser Forward -> Kế hoạch và hoạt động
    await page.goForward();
    await expect(page).toHaveURL(/.*\/activities/);
    await expect(page.locator('.card-title', { hasText: 'Kế hoạch họp lớp' })).toBeVisible();

    // 6. Browser Forward -> Quyết toán
    await page.goForward();
    await expect(page).toHaveURL(/.*\/settlement/);
    await expect(page.locator('.card-title', { hasText: /QUỸ ĐANG HOẠT ĐỘNG|ĐÃ QUYẾT TOÁN/ })).toBeVisible();
  });

  test('Mobile drawer navigation updates URL and handles Back navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.brand-main-title')).toBeVisible();

    // Open drawer and click Danh sách đóng góp
    const toggle = page.locator('.navbar-toggle');
    await toggle.click();
    const drawer = page.locator('.mobile-nav-drawer');
    await expect(drawer).toBeVisible();
    await drawer.locator('button', { hasText: 'Danh sách đóng góp' }).click();
    await expect(page).toHaveURL(/.*\/contributors/);
    await expect(page.locator('.card-title', { hasText: 'Danh Sách Đóng Góp' })).toBeVisible();

    // Open drawer again and click Danh sách chi tiêu
    await toggle.click();
    await expect(drawer).toBeVisible();
    await drawer.locator('button', { hasText: 'Danh sách chi tiêu' }).click();
    await expect(page).toHaveURL(/.*\/expenses/);
    await expect(page.locator('.card-title', { hasText: 'Danh Sách Khoản Chi Minh Bạch' })).toBeVisible();

    // Browser Back -> Danh sách đóng góp
    await page.goBack();
    await expect(page).toHaveURL(/.*\/contributors/);
    await expect(page.locator('.card-title', { hasText: 'Danh Sách Đóng Góp' })).toBeVisible();
  });

  test('Direct URL deep linking and page reload persistence', async ({ page }) => {
    const routesToTest = [
      { path: '/activities', heading: 'Kế hoạch họp lớp' },
      { path: '/contributors', heading: 'Danh Sách Đóng Góp' },
      { path: '/expenses', heading: 'Danh Sách Khoản Chi Minh Bạch' },
      { path: '/settlement', heading: /QUỸ ĐANG HOẠT ĐỘNG|ĐÃ QUYẾT TOÁN/ },
      { path: '/login', heading: 'Đăng Nhập Thành Viên' },
      { path: '/register', heading: 'Đăng Ký Tài Khoản' },
    ];

    for (const r of routesToTest) {
      await page.goto(r.path);
      await expect(page.locator('.card-title, .auth-form-title', { hasText: r.heading })).toBeVisible({ timeout: 10000 });

      // Refresh and assert it stays on the same page
      await page.reload();
      await expect(page.locator('.card-title, .auth-form-title', { hasText: r.heading })).toBeVisible({ timeout: 10000 });
      expect(page.url()).toContain(r.path);
    }
  });

  test('Unauthenticated user visiting /contribute sees login/register prompt without contributor selector', async ({ page }) => {
    await page.goto('/contribute');
    await expect(page.locator('.card-title', { hasText: 'Đóng Quỹ Hoạt Động' })).toBeVisible();

    // Assert login prompt is present
    await expect(page.locator('text=Yêu Cầu Đăng Nhập Thành Viên')).toBeVisible();
    await expect(page.locator('.card button', { hasText: 'Đăng Nhập' })).toBeVisible();
    await expect(page.locator('.card button', { hasText: 'Đăng Ký Tài Khoản' })).toBeVisible();

    // Assert NO contributor dropdown or "Bạn đang đóng quỹ dưới tên ai?" is rendered
    await expect(page.locator('text=Bạn đang đóng quỹ dưới tên ai?')).toBeHidden();
    await expect(page.locator('select')).toBeHidden();
  });

  test('Registration guest flow: selects "Không có tên trong danh sách" -> enters name -> opens /contribute as guest WITHOUT login -> generates VietQR with custom 600,000', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('.auth-shell-card')).toBeVisible();

    // 1. Click member search autocomplete input
    const memberInput = page.locator('input[placeholder*="Gõ để tìm tên"]');
    await memberInput.click();

    // 2. Select "Không có tên trong danh sách" option
    const guestOption = page.locator('.autocomplete-guest-option', { hasText: 'Không có tên trong danh sách' });
    await expect(guestOption).toBeVisible();
    await guestOption.click();

    // 3. Fill guest name
    const guestNameInput = page.locator('input[placeholder*="Nhập họ và tên"]');
    await expect(guestNameInput).toBeVisible();
    await guestNameInput.fill('Bác Trần Văn Quý (Khách mời)');

    // 4. Click "Đóng quỹ với tư cách khách" button
    const guestSubmitBtn = page.locator('button', { hasText: 'Đóng quỹ với tư cách khách' });
    await expect(guestSubmitBtn).toBeVisible();
    await guestSubmitBtn.click();

    // 5. Verify navigation to /contribute in guest mode (NO login required)
    await expect(page).toHaveURL(/.*\/contribute/);
    await expect(page.locator('.card-title', { hasText: 'Đóng Quỹ Hoạt Động' })).toBeVisible();

    // Assert NO login required prompt
    await expect(page.locator('text=Yêu Cầu Đăng Nhập Thành Viên')).toBeHidden();

    // Assert Guest banner shows entered guest name
    await expect(page.locator('text=Đóng quỹ với tư cách khách ủng hộ')).toBeVisible();
    await expect(page.locator('text=Bác Trần Văn Quý (Khách mời)')).toBeVisible();

    // 6. Select custom amount and enter 600000
    const customAmountField = page.locator('input[type="number"]');
    await customAmountField.click();
    await customAmountField.fill('600000');

    // 7. Click "Tạo Mã QR Đóng Quỹ"
    await page.locator('button', { hasText: 'Tạo Mã QR Đóng Quỹ' }).click();

    // 8. Verify QR code is generated with 600.000 ₫ and payment code
    await expect(page.locator('img[alt="VietQR Đóng Quỹ Họp Lớp"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=600.000 ₫')).toBeVisible();
  });

  test('Canonical Admin identity: logs in and verifies Dương Tuấn Anh is displayed without legacy text', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('.auth-shell-card')).toBeVisible();

    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', '123456');
    await page.click('button[type="submit"]');

    // Should redirect to Admin Dashboard
    await expect(page.locator('.card-title', { hasText: 'Bảng Điều Khiển Quản Trị' })).toBeVisible({ timeout: 10000 });

    // Assert canonical name is displayed in admin card header
    await expect(page.locator('.card-header strong', { hasText: 'Dương Tuấn Anh' })).toBeVisible();

    // Assert legacy text is NOT present anywhere on the page
    const pageText = await page.innerText('body');
    expect(pageText).not.toContain('Thủ Quỹ Lớp A1');
  });
});
