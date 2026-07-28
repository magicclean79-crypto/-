import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

/** ADMIN 토큰을 심고 콘솔을 연다 */
async function openConsole(page: import("@playwright/test").Page) {
  await page.goto("/admin/console");
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

test.describe("Provider Administration Console (TASK-1201)", () => {
  test("Provider·모델·예산·실험 현황과 값의 출처가 렌더링된다", async ({
    page,
  }) => {
    await setMode("data");
    await openConsole(page);

    // Provider Enable/Disable
    await expect(page.getByTestId("provider-row")).toHaveCount(3);
    const providers = page.getByTestId("provider-section");
    await expect(providers).toContainText("openai");
    await expect(providers).toContainText("키 설정됨");
    await expect(providers).toContainText("키 없음"); // anthropic

    // Model Management — 환경변수 출처
    const models = page.getByTestId("model-section");
    await expect(models).toContainText("LLM_MODEL_ANALYSIS");
    await expect(models).toContainText("gpt-4o-mini");

    // Budget Management — 현재 지출 + 임계
    await expect(page.getByTestId("budget-status")).toContainText("8.5200");
    await expect(page.getByTestId("budget-section")).toContainText(
      "LLM_DAILY_BUDGET_USD",
    );

    // Experiment Management
    await expect(page.getByTestId("experiment-row")).toHaveCount(3);
    await expect(page.getByTestId("experiment-section")).toContainText(
      "LLM_EXPERIMENT_ANALYSIS",
    );

    // 값의 출처 배지 (환경변수/기본값)
    await expect(page.getByTestId("setting-source").first()).toBeVisible();
  });

  test("설정 변경 → 출처가 콘솔로 바뀌고 변경 이력이 남는다", async ({
    page,
  }) => {
    await setMode("data");
    await openConsole(page);

    const budget = page.getByTestId("budget-section");
    const input = budget.locator("input").first();
    await input.fill("25");
    await budget.getByRole("button", { name: "적용" }).first().click();

    await expect(page.getByTestId("console-notice")).toContainText(
      "budget.daily = 25",
    );
    await expect(budget.getByTestId("setting-source").first()).toContainText(
      "콘솔",
    );

    // Audit Log
    const audit = page.getByTestId("audit-table");
    await expect(audit).toContainText("budget.daily");
    await expect(audit).toContainText("(없음) → 25");
    await expect(audit).toContainText("admin@acos.local");
  });

  test("해제하면 환경변수 값으로 되돌아간다", async ({ page }) => {
    await setMode("data");
    await openConsole(page);

    const budget = page.getByTestId("budget-section");
    await budget.locator("input").first().fill("25");
    await budget.getByRole("button", { name: "적용" }).first().click();
    await expect(budget.getByTestId("setting-source").first()).toContainText(
      "콘솔",
    );

    await budget.getByTestId("clear-override").first().click();
    await expect(page.getByTestId("console-notice")).toContainText(
      "환경변수 값으로 복귀",
    );
    await expect(budget.getByTestId("setting-source").first()).toContainText(
      "환경변수",
    );
    await expect(page.getByTestId("audit-table")).toContainText("(환경변수)");
  });

  test("Provider 토글 — 끄면 비활성으로 표시된다", async ({ page }) => {
    await setMode("data");
    await openConsole(page);

    const openaiRow = page.getByTestId("provider-row").nth(1);
    await expect(openaiRow.getByTestId("provider-toggle")).toContainText("활성");
    await openaiRow.getByTestId("provider-toggle").click();

    await expect(page.getByTestId("console-notice")).toContainText(
      "provider.openai.enabled = false",
    );
    await expect(
      page.getByTestId("provider-row").nth(1).getByTestId("provider-toggle"),
    ).toContainText("비활성");
    await expect(page.getByTestId("provider-row").nth(1)).toContainText(
      "후보 제외",
    );
  });

  test("잘못된 값은 오류 안내를 표시한다", async ({ page }) => {
    await setMode("data");
    await openConsole(page);

    const budget = page.getByTestId("budget-section");
    await budget.locator("input").first().fill("-5");
    await budget.getByRole("button", { name: "적용" }).first().click();

    await expect(page.getByTestId("console-notice")).toContainText("변경 실패");
    await expect(page.getByTestId("console-notice")).toContainText(
      "0보다 큰 숫자",
    );
  });

  test("미인증 접근은 ADMIN 권한 안내를 표시한다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/console");
    await page.evaluate(() => localStorage.removeItem("acos_token"));
    await page.reload();

    await expect(page.getByTestId("console-error")).toContainText(
      "ADMIN 권한이 필요합니다",
    );
  });
});
