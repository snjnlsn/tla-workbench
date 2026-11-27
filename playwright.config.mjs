import {defineConfig} from '@playwright/test';

const published = process.env.WORKBENCH_TEST_URL;
const baseURL = published || 'http://127.0.0.1:8813/';
export default defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL,
    launchOptions: {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE},
  },
  webServer: published ? undefined : {
    command: 'python3 -m http.server 8813 --bind 127.0.0.1 --directory dist',
    url: baseURL,
  },
});
