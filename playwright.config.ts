import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    port: 3000,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      NODE_ENV: 'production',
      PORT: '3000',
      HOST: '127.0.0.1',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$3Sy+TI6PWk+XTGiGzLPMuA$pwh31RA5Ww/5QQ8iLM7QLORDOPGfxXaSPBg8IBTZiso',
    },
  },
});
