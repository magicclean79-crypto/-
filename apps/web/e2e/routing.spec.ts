import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

test.describe("Routing Dashboard (TASK-1001)", () => {
  test("Feature별 매핑·결정 근거·경로 메트릭이 렌더링된다", async ({ page }) => {
    await setMode("data");
    await page.goto("/routing");

    // 기본 Provider·사용 가능 목록
    await expect(page.getByTestId("routing-default")).toContainText("mock");
    await expect(page.getByTestId("routing-default")).toContainText("anthropic");

    // 라우팅 표 3행 + 결정 배지 3종
    await expect(page.getByTestId("routing-row")).toHaveCount(3);
    const table = page.getByTestId("routing-table");
    await expect(table).toContainText("product-analysis");
    await expect(table).toContainText("claude-sonnet-5");
    await expect(table).toContainText("Feature 매핑");
    await expect(table).toContainText("기본 Provider");
    await expect(table).toContainText("폴백");
    await expect(table).toContainText("LLM_ROUTE_ANALYSIS");
    // 폴백 사유 노출
    await expect(page.getByTestId("routing-reason")).toContainText("gemini");

    // Routing Metrics — 경로별 성공률·지연·비용
    await expect(page.getByTestId("routing-metric-row")).toHaveCount(2);
    const metrics = page.getByTestId("routing-metrics");
    await expect(metrics).toContainText("product-analysis→anthropic");
    await expect(metrics).toContainText("75.0%");
    await expect(metrics).toContainText("850ms");
    await expect(metrics).toContainText("$0.0600");
  });

  test("매핑이 없으면 전부 기본 Provider로 표시된다", async ({ page }) => {
    await setMode("empty");
    await page.goto("/routing");

    await expect(page.getByTestId("routing-row")).toHaveCount(3);
    await expect(page.getByTestId("routing-table")).not.toContainText(
      "Feature 매핑",
    );
    // 실행 이력이 없으면 메트릭 빈 상태 안내
    await expect(page.getByTestId("routing-metrics-empty")).toBeVisible();
  });

  test("Failover 우선순위·Provider 건강 상태·계측이 렌더링된다 (TASK-1002)", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/routing");

    const summary = page.getByTestId("failover-summary");
    await expect(summary).toContainText("openai → anthropic → mock");
    await expect(summary).toContainText("120000ms");
    await expect(summary).toContainText("3회");

    // 계측 4종 (시도/Failover/체인 소진/제외)
    await expect(page.getByTestId("failover-metric")).toHaveCount(4);
    const section = page.getByTestId("failover-section");
    await expect(section).toContainText("Failover");
    await expect(section).toContainText("제외(예산/검증)");

    // Provider 건강 상태 — openai는 불건강 배지
    await expect(page.getByTestId("failover-health-row")).toHaveCount(3);
    const health = page.getByTestId("failover-health");
    await expect(health).toContainText("불건강");
    await expect(health).toContainText("건강");
    // 성공/실패 누계
    await expect(health).toContainText("4/3");
  });

  test("우선순위 미설정이면 Failover 비활성으로 표시된다 (TASK-1002)", async ({
    page,
  }) => {
    await setMode("empty");
    await page.goto("/routing");

    await expect(page.getByTestId("failover-summary")).toContainText(
      "Failover 비활성",
    );
    await expect(page.getByTestId("failover-summary")).toContainText(
      "LLM_FAILOVER_PRIORITY",
    );
  });

  test("API 오류 시 오류 안내를 표시한다", async ({ page }) => {
    await setMode("error");
    await page.goto("/routing");
    await expect(page.getByTestId("routing-error")).toBeVisible();
    await setMode("data");
  });
});
