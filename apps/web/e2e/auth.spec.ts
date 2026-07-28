import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function resetMode(): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode: "data" }),
  });
}

test.describe("인증 Foundation Web (TASK-0801)", () => {
  test("Login UI — 로그인 성공 시 토큰 저장 후 홈으로 이동", async ({
    page,
  }) => {
    await resetMode();
    await page.goto("/login");

    await page.getByLabel("이메일").fill("admin@acos.local");
    await page.getByLabel("비밀번호").fill("admin1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();

    await page.waitForURL("**/");
    const token = await page.evaluate(() => localStorage.getItem("acos_token"));
    expect(token).toBe("stub-token");

    // 로그인 페이지 재방문 시 현재 사용자 표시
    await page.goto("/login");
    await expect(page.getByTestId("login-current-user")).toContainText(
      "admin@acos.local",
    );
  });

  test("Login UI — 잘못된 비밀번호는 오류 메시지", async ({ page }) => {
    await resetMode();
    await page.goto("/login");

    await page.getByLabel("이메일").fill("admin@acos.local");
    await page.getByLabel("비밀번호").fill("wrong-pass");
    await page.getByRole("button", { name: "로그인", exact: true }).click();

    await expect(page.getByTestId("login-error")).toContainText(
      "올바르지 않습니다",
    );
  });

  test("미로그인 상태로 전이 시도 — 401 안내 + 로그인 링크", async ({
    page,
  }) => {
    await resetMode();
    await page.goto("/projects/proj-pub");

    await page
      .getByTestId("content-item")
      .getByRole("button", { name: "검토 요청 (REVIEW)" })
      .click();

    const error = page.getByTestId("content-status-error");
    await expect(error).toContainText("로그인이 필요합니다");
    await expect(error.getByRole("link", { name: "로그인" })).toBeVisible();
  });
});
