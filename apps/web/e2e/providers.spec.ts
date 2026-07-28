import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

test.describe("Provider Dashboard (TASK-0902)", () => {
  test("Registry·라우팅·예산(경고)·Provider 통계가 렌더링된다", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/providers");

    // Registry 4행 + 연결 배지 + 선택 표시
    await expect(page.getByTestId("provider-row")).toHaveCount(4);
    const table = page.getByTestId("providers-table");
    await expect(table).toContainText("OpenAI");
    await expect(table).toContainText("공식 연결");
    await expect(table).toContainText("어댑터 준비");
    await expect(table).toContainText("선택됨"); // mock 선택 상태

    // 선택 Provider + 라우팅
    await expect(page.getByTestId("selected-provider")).toContainText("mock");
    const routing = page.getByTestId("routing-table");
    await expect(routing).toContainText("product-analysis");
    await expect(routing).toContainText("gpt-4o-mini");
    await expect(routing).toContainText("(Provider 기본)");

    // 예산: 일간 경고(85.2%) · 월간 정상
    await expect(page.getByTestId("budget-daily")).toContainText("경고");
    await expect(page.getByTestId("budget-daily")).toContainText("$8.5200");
    await expect(page.getByTestId("budget-monthly")).toContainText("정상");

    // Provider별 호출 통계 (stats stub의 mock 그룹)
    await expect(page.getByTestId("provider-stats")).toContainText("mock");
  });

  test("예산 미설정이면 '미설정 (무제한)'으로 표시된다", async ({ page }) => {
    await setMode("empty");
    await page.goto("/providers");
    await expect(page.getByTestId("budget-daily")).toContainText(
      "미설정 (무제한)",
    );
    await expect(page.getByTestId("budget-monthly")).toContainText(
      "미설정 (무제한)",
    );
    // Registry는 예산과 무관하게 표시
    await expect(page.getByTestId("provider-row")).toHaveCount(4);
  });

  test("API 오류 시 오류 안내를 표시한다", async ({ page }) => {
    await setMode("error");
    await page.goto("/providers");
    await expect(page.getByTestId("providers-error")).toBeVisible();
    await setMode("data");
  });
});
