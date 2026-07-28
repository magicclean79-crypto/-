import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: "data" | "empty" | "error"): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

test.describe("Execution Dashboard 스모크 (TASK-0702)", () => {
  test("Dashboard — KPI(% 변환)·Timeline·테이블·필터 폼이 렌더링된다", async ({
    page,
  }) => {
    await setMode("data");
    await page.goto("/executions");

    const kpi = page.getByTestId("kpi-cards");
    await expect(kpi).toContainText("호출 수");
    await expect(kpi).toContainText("9");
    await expect(kpi).toContainText("88.9%"); // API 0~1 → UI %
    await expect(page.getByText("Timeline", { exact: true })).toBeVisible();
    await expect(page.getByText("Feature별 통계")).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "content-generation" }),
    ).toBeVisible();
    await expect(page.getByTestId("dashboard-filter")).toBeVisible();
  });

  test("Filter — feature/from이 API 쿼리로 전달된다", async ({ page }) => {
    await setMode("data");
    await page.goto("/executions?feature=dev&from=2026-07-28T00:00");

    await expect(page.getByTestId("kpi-cards")).toBeVisible();
    const { urls } = (await (await fetch(`${STUB}/__last`)).json()) as {
      urls: string[];
    };
    const statsUrl = urls.find((url) => url.startsWith("/executions/stats"));
    const timelineUrl = urls.find((url) =>
      url.startsWith("/executions/timeline"),
    );
    expect(statsUrl).toContain("feature=dev");
    expect(statsUrl).toContain("from=2026-07-28T00%3A00%3A00.000Z"); // UTC 해석
    expect(timelineUrl).toContain("feature=dev");
  });

  test("Empty — 이력이 없으면 빈 상태 안내를 표시한다", async ({ page }) => {
    await setMode("empty");
    await page.goto("/executions");

    await expect(page.getByTestId("kpi-cards")).toContainText("0");
    await expect(
      page.getByText("표시할 실행 이력이 없습니다."),
    ).toBeVisible();
    await expect(page.getByText("데이터가 없습니다.").first()).toBeVisible();
  });

  test("Error — API 실패 시 오류 안내를 표시한다", async ({ page }) => {
    await setMode("error");
    await page.goto("/executions");

    await expect(page.getByTestId("dashboard-error")).toBeVisible();
    await expect(page.getByTestId("dashboard-error")).toContainText(
      "API에 연결할 수 없습니다",
    );
  });
});
