import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: [
    { command: "npm run dev:api", port: 8787, reuseExistingServer: true },
    { command: "npm run dev:web", port: 5173, reuseExistingServer: true }
  ],
  use: { baseURL: "http://127.0.0.1:5173", trace: "on-first-retry", channel: "chrome" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } }
  ]
});
