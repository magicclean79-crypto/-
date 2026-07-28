import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function openPage(page: import("@playwright/test").Page) {
  await page.goto("/admin/production");
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

test.describe("Provider 운영 점검 (TASK-1301)", () => {
  test("정상 상태 — 키 형식·비용·모니터링을 한 화면에 보여준다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    // API Key Validation — 키 값은 힌트만, 원문은 어디에도 없다
    await expect(page.getByTestId("validation-verdict")).toContainText(
      "문제 없음",
    );
    const openai = page.getByTestId("provider-openai");
    await expect(openai).toContainText("형식 정상");
    await expect(openai).toContainText("sk-pro…");
    await expect(page.getByTestId("provider-anthropic")).toContainText(
      "미설정",
    );
    // 기본 조회는 Live Check를 하지 않는다 (실호출·과금)
    await expect(openai).toContainText("미실행");

    // Production Monitoring
    await expect(page.getByTestId("monitor-status")).toContainText("정상");
    await expect(page.getByTestId("monitor-openai")).toContainText(
      "820 / 1900 / 2400ms",
    );
    await expect(page.getByTestId("monitor-alerts")).toHaveCount(0);

    // Cost Verification
    await expect(page.getByTestId("cost-verdict")).toContainText("일치");
    await expect(page.getByTestId("cost-issues")).toHaveCount(0);
    await expect(page.getByTestId("cost-verification")).toContainText(
      "미산정 0건",
    );
  });

  test("문제 상태 — 조치 항목과 경보를 드러낸다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("validation-verdict")).toContainText(
      "조치 필요",
    );
    await expect(page.getByTestId("validation-blockers")).toContainText(
      "플레이스홀더",
    );

    await expect(page.getByTestId("monitor-status")).toContainText("저하");
    await expect(page.getByTestId("monitor-alerts")).toContainText("성공률 70%");

    await expect(page.getByTestId("cost-verdict")).toContainText("확인 필요");
    await expect(page.getByTestId("cost-issues")).toContainText(
      "예산 상한이 적용되지 않습니다",
    );
  });

  test("Live Check는 눌러야 실행된다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("provider-openai")).toContainText("미실행");
    await page.getByTestId("live-check").click();
    await expect(page.getByTestId("provider-openai")).toContainText("정상 412ms");
    await expect(page.getByTestId("key-validation")).toContainText(
      "Live Check 포함",
    );
  });

  test("ADMIN 인증이 없으면 권한 안내를 보여준다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/production");
    await expect(page.getByTestId("production-error")).toContainText(
      "ADMIN 권한이 필요합니다",
    );
  });
});
