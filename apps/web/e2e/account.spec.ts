import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function reset(): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode: "data" }),
  });
}

test.describe("비밀번호 관리 (TASK-0803)", () => {
  test("미로그인 /account — 로그인 안내를 표시한다", async ({ page }) => {
    await reset();
    await page.goto("/account");
    const notice = page.getByTestId("account-login-required");
    await expect(notice).toContainText("로그인이 필요합니다");
    await expect(notice.getByRole("link", { name: "로그인" })).toBeVisible();
  });

  test("비밀번호 변경 — 현재 비밀번호 오류 → 성공 흐름", async ({ page }) => {
    await reset();
    await page.addInitScript(() => {
      localStorage.setItem("acos_token", "stub-token");
      localStorage.setItem(
        "acos_user",
        JSON.stringify({
          id: "u-admin",
          email: "admin@acos.local",
          name: "관리자",
          role: "ADMIN",
          disabled: false,
          createdAt: "2026-07-28T00:00:00.000Z",
        }),
      );
    });
    await page.goto("/account");
    await expect(page.getByText("admin@acos.local")).toBeVisible();

    const form = page.getByTestId("password-change-form");

    // 잘못된 현재 비밀번호 → 오류
    await form.getByLabel("현재 비밀번호").fill("wrong-pass");
    await form.getByLabel("새 비밀번호 (8자+)").fill("changed-pass-1");
    await form.getByLabel("새 비밀번호 확인").fill("changed-pass-1");
    await form.getByRole("button", { name: "변경" }).click();
    await expect(page.getByTestId("password-change-error")).toContainText(
      "현재 비밀번호가 올바르지 않습니다",
    );

    // 확인 불일치 → 클라이언트 오류
    await form.getByLabel("현재 비밀번호").fill("admin1234");
    await form.getByLabel("새 비밀번호 확인").fill("mismatch-pass");
    await form.getByRole("button", { name: "변경" }).click();
    await expect(page.getByTestId("password-change-error")).toContainText(
      "확인이 일치하지 않습니다",
    );

    // 올바른 입력 → 성공 + 다른 세션 로그아웃 안내
    await form.getByLabel("현재 비밀번호").fill("admin1234");
    await form.getByLabel("새 비밀번호 (8자+)").fill("changed-pass-1");
    await form.getByLabel("새 비밀번호 확인").fill("changed-pass-1");
    await form.getByRole("button", { name: "변경" }).click();
    await expect(page.getByTestId("password-change-success")).toContainText(
      "비밀번호가 변경되었습니다",
    );
  });

  test("관리자 비밀번호 재설정 — 대상 지정·감사 로그 기록", async ({
    page,
  }) => {
    await reset();
    await page.addInitScript(() => {
      localStorage.setItem("acos_token", "stub-token");
    });
    await page.goto("/admin/users");

    // 대상 사용자 생성
    const form = page.getByTestId("user-create-form");
    await form.getByLabel("이메일").fill("editor@acos.local");
    await form.getByLabel("이름").fill("에디터");
    await form.getByLabel("비밀번호 (8자+)").fill("editor-pass-1");
    await form.getByRole("button", { name: "생성" }).click();
    const editorRow = page
      .getByTestId("user-row")
      .filter({ hasText: "editor@acos.local" });
    await expect(editorRow).toBeVisible();

    // 재설정 — 8자 미만이면 확인 버튼 비활성
    await editorRow.getByRole("button", { name: "비밀번호 재설정" }).click();
    const input = page.getByLabel("editor@acos.local 새 비밀번호");
    await input.fill("short");
    await expect(editorRow.getByRole("button", { name: "확인" })).toBeDisabled();

    await input.fill("reset-pass-11");
    await editorRow.getByRole("button", { name: "확인" }).click();

    // 감사 로그에 PASSWORD_RESET 기록
    await expect(page.getByTestId("user-audit-list")).toContainText(
      "PASSWORD_RESET",
    );
    await expect(page.getByTestId("user-audit-list")).toContainText(
      "editor@acos.local",
    );
  });
});
