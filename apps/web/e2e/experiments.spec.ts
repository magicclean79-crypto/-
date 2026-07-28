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

  test("API 오류 시 오류 안내를 표시한다", async ({ page }) => {
    await setMode("error");
    await page.goto("/experiments");
    await expect(page.getByTestId("experiments-error")).toBeVisible();
    await setMode("data");
  });
});
