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
 * 업로드 단계 귀속 (TASK-4501, CTO 정책 4501-②).
 *
 * 상품에 붙기 전에 돌린 OCR의 비용은 지금까지 전부 미귀속으로 떨어졌고,
 * 나중에 상품을 붙여도 기록은 실행 시점의 사실이라 소급되지 않았습니다.
 * 그래서 소속을 받는 자리를 업로드로 옮겼습니다.
 */
test.describe("업로드 단계 귀속 (TASK-4501)", () => {
  test("업로드 화면에서 소속 프로젝트를 고를 수 있다", async ({ page }) => {
    test.slow();
    await setMode("data");
    await open(page, "/upload");

    const select = page.getByTestId("upload-project");
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveText([
      "밝히지 않음 (상품에 붙일 때 귀속)",
      "발행 테스트 프로젝트",
    ]);
  });

  /**
   * 비워 두는 것은 잘못이 아니다 — 다만 그 결과를 화면이 미리 말해야
   * 사람이 알고 비운다.
   */
  test("비워 두면 어떻게 되는지 먼저 말한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/upload");

    await expect(page.getByText("미귀속은 공용이 아니라 모른다는 뜻이고")).toBeVisible();
  });
});
