import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * 웹 스모크 테스트 (TASK-0702) — CI 품질 게이트(pnpm test)에 포함된다.
 * 실제 API 대신 스텁 API(e2e/stub-api.mjs)로 Dashboard/Empty/Error 상태를
 * 결정적으로 재현한다. 브라우저는 사전 설치된 chromium을 사용한다
 * (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 환경에서도 동작).
 *
 * 포트 3101(T1-201): 사람 검증용 고정 서버(scripts/start-verify-studio.ps1)는
 * 항상 3100/4100을 쓴다. 이 config가 예전에는 같은 3100을 자체
 * `next dev`(reuseExistingServer: false)로 다시 띄우려 했는데, 그러면
 * 검증용 서버가 떠 있을 때 `pnpm turbo run test`가 EADDRINUSE로 실패하거나
 * (반대로) 이 테스트가 검증용 서버를 밀어내는 구조적 충돌이 있었다(T1-149·
 * T1-177 등에서 반복 관찰, docs/PROJECT_STATE.md). 스텁 API·이 웹 서버 모두
 * 사람 검증용 포트(3100/4100)와 겹치지 않는 전용 포트로 분리해 두 흐름이
 * 항상 독립적으로 동작하게 한다.
 */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const STUB_PORT = 4999;
const WEB_PORT = 3101;

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
