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
 * 운영 통제 화면 (TASK-3901, CTO 정책 3901-②⑤).
 *
 * 여기서 보는 것은 **화면이 스스로를 속이지 않는가**다: 임계값을 느슨하게
 * 바꿔 초록이 된 것이 드러나는가, 그리고 자동으로 만든 초안이 장애처럼
 * 보이지 않는가.
 */
test.describe("운영 통제 (TASK-3901)", () => {
  test("느슨하게 바꾼 임계값을 카드와 요약이 함께 말한다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await open(page, "/admin/kpi");

    // 초록이지만 그것은 기준을 내려서다
    await expect(page.getByTestId("kpi-status-incidents-open")).toContainText("정상");
    await expect(page.getByTestId("kpi-threshold-incidents-open")).toContainText(
      "상태가 좋아진 것이 아닙니다",
    );
    await expect(page.getByTestId("kpi-relaxed-count")).toContainText(
      "느슨해진 임계값 1개",
    );
    await expect(page.getByTestId("kpi-board")).toContainText("기준을 내린 것이지");
  });

  test("기본값 임계값에는 아무 말도 붙이지 않는다 — 모든 카드에 붙는 문구는 배경이 된다", async ({
    page,
  }) => {
    await setMode("data");
    await open(page, "/admin/kpi");
    await expect(page.getByTestId("kpi-threshold-mttr")).toHaveCount(0);
  });

  test("받아들이지 않은 설정을 조용히 버리지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/kpi");
    await expect(page.getByTestId("kpi-rejected")).toContainText("임계값을 없앤 것");
  });

  test("자동으로 만든 초안은 장애처럼 보이지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("incident-drafts")).toContainText(
      "아직 장애가 아닙니다",
    );
    await expect(page.getByTestId("incident-draft-badge")).toContainText("초안");
    // 초안에는 "복구 기록" 버튼이 없다 — 확인이 먼저다
    await expect(page.getByTestId("resolve-inc-draft")).toHaveCount(0);
    // 확인된 진행 중 장애에는 있다
    await expect(page.getByTestId("resolve-inc-open")).toBeVisible();
  });
});
