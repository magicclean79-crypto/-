import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function openPage(page: import("@playwright/test").Page) {
  await page.goto("/admin/kpi");
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

/**
 * 운영 KPI 대시보드 (TASK-3801, CTO 정책 3801-①③④).
 *
 * 이 화면에서 검증하는 것은 "숫자가 예쁘게 나오는가"가 아니라, **모르는
 * 것을 초록으로 칠하지 않는가**와 **좋아 보이는 0에 주석이 달리는가**다.
 */
test.describe("운영 KPI 대시보드 (TASK-3801)", () => {
  test("지표·이벤트·감사 기록을 한 화면에 보여준다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("kpi-board")).toContainText("최근 30일");
    await expect(page.getByTestId("kpi-cards")).toBeVisible();
    await expect(page.getByTestId("ops-events")).toContainText("운영 활성화 완료");
    await expect(page.getByTestId("audit-list")).toContainText("운영 스모크 실행");
  });

  test("표본이 없는 지표를 0이 아니라 '낼 수 없음'으로 보여준다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    // 값 자리에 0이 아니라 "낼 수 없음"이 온다 —
    // 0으로 보이면 "우리는 매우 빠르다"로 읽힌다
    await expect(page.getByTestId("kpi-value-mttr")).toHaveText("낼 수 없음");
    await expect(page.getByTestId("kpi-caveat-mttr")).toContainText(
      "0분이 아니라 '모른다'",
    );
    await expect(page.getByTestId("kpi-unknown-count")).toContainText("낼 수 없음 3개");
  });

  test("좋아 보이는 0에 주석을 단다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    // 장애 0건 — 아무도 적지 않았을 수 있다
    await expect(page.getByTestId("kpi-caveat-incidents-open")).toContainText(
      "아무도 적지 않았다는 뜻일 수도",
    );
    // 경보 0건인데 감시가 멈춰 있으면 초록이 아니다
    await expect(page.getByTestId("kpi-status-alerts")).toContainText("낼 수 없음");
    await expect(page.getByTestId("kpi-caveat-alerts")).toContainText(
      "아무도 보고 있지 않아서일 수 있습니다",
    );
  });

  test("풀린 활성화를 붉게, 못 보낸 알림을 그대로 보여준다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const events = page.getByTestId("event-item");
    await expect(events.first()).toContainText("풀렸습니다");
    // "알렸다"고 적지 않는다
    await expect(events.nth(1)).toContainText("알림 미발송");
  });

  test("실패한 시도도 감사 기록에 남는다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const first = page.getByTestId("audit-item").first();
    await expect(first).toContainText("실패 400");
    await expect(first).toContainText("severity=CRITICAL");
  });

  test("기록이 없으면 비어 있다고 말한다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("events-empty")).toContainText(
      "활성화가 완료되거나 풀리는 순간",
    );
    await expect(page.getByTestId("audit-empty")).toContainText("기록된 변경이 없습니다");
  });

  test("ADMIN이 아니면 지표를 보여 주지 않는다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/kpi");

    await expect(page.getByTestId("kpi-error")).toContainText("ADMIN 로그인이 필요합니다");
  });
});
