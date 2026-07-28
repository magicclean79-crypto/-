import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * 웹 스모크 테스트 (TASK-0702) — CI 품질 게이트(pnpm test)에 포함된다.
 * 실제 API 대신 스텁 API(e2e/stub-api.mjs)로 Dashboard/Empty/Error 상태를
 * 결정적으로 재현한다. 브라우저는 사전 설치된 chromium을 사용한다
 * (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 환경에서도 동작).
 */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const STUB_PORT = 4999;
const WEB_PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1, // 스텁 API의 모드 전환이 전역 상태이므로 직렬 실행
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...(existsSync(PREINSTALLED_CHROMIUM)
      ? { launchOptions: { executablePath: PREINSTALLED_CHROMIUM } }
      : {}),
  },
  webServer: [
    {
      command: "node e2e/stub-api.mjs",
      port: STUB_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${STUB_PORT}` },
    },
  ],
});
