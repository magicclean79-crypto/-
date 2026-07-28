import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

test.describe("Experiment Dashboard (TASK-1003)", () => {
  test("실험 종류·설정 비율·실제 배정·변형별 지표가 렌더링된다", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/experiments");

    await expect(page.getByTestId("experiments-summary")).toContainText(
      "anthropic",
    );
    await expect(page.getByTestId("experiment-card")).toHaveCount(2);

    const canary = page.getByTestId("experiment-card").first();
    await expect(canary).toContainText("sonnet-canary");
    await expect(canary).toContainText("Canary");
    await expect(canary).toContainText("적용 중");
    await expect(canary).toContainText("LLM_EXPERIMENT_ANALYSIS");

    // 설정 비율 90/10 · 실제 배정 91/9 · Execution 기준 변형 지표
    const variants = canary.getByTestId("experiment-variants");
    await expect(variants).toContainText("openai:gpt-4o");
    await expect(variants).toContainText("90.0%");
    await expect(variants).toContainText("91.0%");
    await expect(variants).toContainText("97.8%"); // 성공률
    await expect(variants).toContainText("910ms");
    await expect(variants).toContainText("$1.2345");
    await expect(variants).toContainText("anthropic:claude-sonnet-5");
    await expect(variants).toContainText("100.0%");
  });

  test("사용 불가 변형만 있는 실험은 미적용 + 사유를 표시한다", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/experiments");

    const inactive = page.getByTestId("experiment-card").nth(1);
    await expect(inactive).toContainText("미적용");
    await expect(inactive).toContainText("사용 불가");
    await expect(inactive.getByTestId("experiment-reason")).toContainText(
      "기존 라우팅",
    );
  });

  test("실험이 없으면 빈 상태 안내를 표시한다", async ({ page }) => {
    await setMode("empty");
    await page.goto("/experiments");

    await expect(page.getByTestId("experiments-empty")).toBeVisible();
    await expect(page.getByTestId("experiments-empty")).toContainText(
      "LLM_EXPERIMENT_ANALYSIS",
    );
    await expect(page.getByTestId("experiment-card")).toHaveCount(0);
  });

  test("Sticky 배정 목록이 프로젝트·변형과 함께 렌더링된다 (TASK-1101)", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/experiments");

    await expect(page.getByTestId("assignment-dashboard")).toBeVisible();
    await expect(page.getByTestId("assignment-row")).toHaveCount(2);
    const table = page.getByTestId("assignment-table");
    await expect(table).toContainText("여름 신상");
    await expect(table).toContainText("openai:gpt-4o");
    await expect(table).toContainText("겨울 기획");
    await expect(table).toContainText("anthropic:claude-sonnet-5");
  });

  test("Stop → 상태가 중단됨으로 바뀌고 이력이 남는다 (TASK-1101)", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/experiments");
    await page.evaluate(() =>
      localStorage.setItem("acos_token", "stub-token"),
    );
    await page.reload();

    const card = page.getByTestId("experiment-card").first();
    await expect(card.getByTestId("experiment-status")).toContainText("진행 중");

    await card.getByRole("button", { name: "중단" }).click();
    await expect(page.getByTestId("experiments-notice")).toContainText("중단");
    await expect(card.getByTestId("experiment-status")).toContainText("중단됨");
    await expect(card.getByTestId("lifecycle-history")).toContainText("중단");
  });

  test("Winner Promotion → 승자 변형이 상태에 표시된다 (TASK-1101)", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/experiments");
    await page.evaluate(() =>
      localStorage.setItem("acos_token", "stub-token"),
    );
    await page.reload();

    const card = page.getByTestId("experiment-card").first();
    // 승격 버튼은 사용 가능한 변형마다 하나씩
    await expect(card.getByTestId("promote-button")).toHaveCount(2);
    await card
      .getByTestId("promote-button")
      .filter({ hasText: "anthropic:claude-sonnet-5" })
      .click();

    await expect(page.getByTestId("experiments-notice")).toContainText("승격");
    await expect(card.getByTestId("experiment-status")).toContainText(
      "승자 확정",
    );
    await expect(card.getByTestId("experiment-status")).toContainText(
      "anthropic:claude-sonnet-5",
    );
  });

  test("미인증 상태의 상태 전이는 안내를 표시한다 (TASK-1101)", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/experiments");
    await page.evaluate(() => localStorage.removeItem("acos_token"));

    await page
      .getByTestId("experiment-card")
      .first()
      .getByRole("button", { name: "중단" })
      .click();
    await expect(page.getByTestId("experiments-notice")).toContainText("실패");
  });

  test("변형 성과 비교와 승자 추천이 근거·신뢰도와 함께 표시된다 (TASK-1102)", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/experiments");

    const analytics = page
      .getByTestId("experiment-analytics")
      .first();
    await expect(analytics).toBeVisible();
    await expect(analytics.getByTestId("recommendation-basis")).toContainText(
      "anthropic:claude-sonnet-5",
    );
    await expect(analytics.getByTestId("recommendation-basis")).toContainText(
      "성공률",
    );
    await expect(
      analytics.getByTestId("recommendation-confidence"),
    ).toContainText("99.9%");
    await expect(analytics.getByTestId("recommendation-reason")).toContainText(
      "우연일 가능성은 낮습니다",
    );

    // 기준 대비 비교 — 부호로 방향을 알 수 있어야 한다
    const comparison = analytics.getByTestId("experiment-comparison");
    await expect(comparison).toContainText("기준(openai:gpt-4o) 대비");
    await expect(comparison).toContainText("+9.0%p");
    await expect(comparison).toContainText("-400ms");
    await expect(analytics).toContainText("관측 1000건");
  });

  test("재배정 이력이 사유와 함께 표시된다 (TASK-1102)", async ({ page }) => {
    await setMode("data");
    await page.goto("/experiments");

    const history = page.getByTestId("reassignment-history");
    await expect(history).toContainText("재배정 이력 1건");
    await expect(history).toContainText("실험 정의 변경");
    await expect(history).toContainText("proj-b");
  });

  test("API 오류 시 오류 안내를 표시한다", async ({ page }) => {
    await setMode("error");
    await page.goto("/experiments");
    await expect(page.getByTestId("experiments-error")).toBeVisible();
    await setMode("data");
  });
});
