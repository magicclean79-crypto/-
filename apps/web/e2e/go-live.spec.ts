import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function open(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

/**
 * 최종 Go-Live 체크리스트 (TASK-4501, CTO 정책 4501-⑤).
 *
 * 화면이 지켜야 하는 것: **검증 전에 진행률로 진행을 흉내 내지 않는가**,
 * **확인 못 한 항목을 충족 옆에 조용히 두지 않는가**, **인용처를 달고
 * 다니는가**, 그리고 **선언을 시스템이 하지 않는가**.
 */
test.describe("최종 Go-Live 체크리스트 (TASK-4501)", () => {
  /**
   * 빠진 하나가 전부인 상황에서 "0/3"을 크게 적으면 숫자가 진행을 흉내 낸다.
   */
  test("검증 전에는 진행률을 앞세우지 않는다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await open(page, "/admin/go-live");

    await expect(page.getByTestId("go-live-verdict")).toHaveText(
      "아직 시작하지 않음",
    );
    await expect(page.getByTestId("go-live-progress")).toHaveCount(0);
    await expect(page.getByTestId("go-live-detail")).toContainText(
      "아직 시작도 안 했다는 뜻",
    );
  });

  /**
   * 행이 없는 것은 실패가 아니라 아직 안 한 것이다 — 그 차이를 화면이
   * 말해야 사람이 "고칠 버그"와 "할 일"을 가릴 수 있다.
   */
  test("검증을 돌린 적이 없다는 사실을 그대로 말한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/go-live");

    await expect(page.getByTestId("go-live-validation")).toContainText(
      "실패가 아니라 안 한 것입니다",
    );
  });

  /**
   * 확인 못 한 항목이 충족 옆에서 조용하면, 모르는 항목이 많은 환경이
   * 건강해 보인다.
   */
  test("확인 못 한 항목을 통과처럼 보여 주지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/go-live");

    const unknown = page.getByTestId("go-live-state-drill");
    await expect(unknown).toHaveText("확인 못 함");
    await expect(unknown).toHaveClass(/border/);
  });

  /**
   * 두 화면이 다른 말을 할 때 그것을 숨길 수 없어야 한다.
   */
  test("항목마다 어느 판정을 인용했는지 달고 있다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/go-live");

    await expect(page.getByTestId("go-live-source-validation")).toHaveText(
      "POST /ops/validation-run/execute",
    );
    await expect(page.getByTestId("go-live-source-runbook")).toHaveText(
      "GET /ops/runbook",
    );
  });

  test("로그인 없이는 읽을 수 없다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/go-live");
    await expect(page.getByTestId("go-live-error")).toContainText(
      "ADMIN 로그인이 필요합니다",
    );
  });
});
