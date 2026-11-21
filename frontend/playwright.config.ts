import { defineConfig, devices } from '@playwright/test';

/** Tests de bout en bout sur le build de production (PWA), moteur de simulation. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', locale: 'fr-FR' },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
