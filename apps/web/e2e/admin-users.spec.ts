import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function reset(): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode: "data" }),
  });
}

test.describe("사용자 관리 UI (TASK-0802)", () => {
  test("미로그인 접근 — 로그인 안내를 표시한다", async ({ page }) => {
    await reset();
    await page.goto("/admin/users");
    const error = page.getByTestId("admin-users-error");
    await expect(error).toContainText("로그인이 필요합니다");
    await expect(error.getByRole("link", { name: "로그인" })).toBeVisible();
  });

  test.describe("ADMIN 세션", () => {
    test.beforeEach(async ({ page }) => {
      await reset();
      await page.addInitScript(() => {
        localStorage.setItem("acos_token", "stub-token");
      });
    });

    test("목록·생성·역할 변경·비활성화 + 감사 로그", async ({ page }) => {
      await page.goto("/admin/users");

      // 목록 렌더링
      await expect(page.getByTestId("user-row")).toHaveCount(1);
      await expect(page.getByTestId("user-table")).toContainText(
        "admin@acos.local",
      );

      // 사용자 생성
      const form = page.getByTestId("user-create-form");
      await form.getByLabel("이메일").fill("editor@acos.local");
      await form.getByLabel("이름").fill("에디터");
      await form.getByLabel("비밀번호 (8자+)").fill("editor-pass-1");
      await form.getByLabel("역할").selectOption("EDITOR");
      await form.getByRole("button", { name: "생성" }).click();
      await expect(page.getByTestId("user-row")).toHaveCount(2);
      await expect(page.getByTestId("user-table")).toContainText(
        "editor@acos.local",
      );

      // 역할 변경 EDITOR → VIEWER
      await page
        .getByLabel("editor@acos.local 역할")
        .selectOption("VIEWER");
      await expect(page.getByLabel("editor@acos.local 역할")).toHaveValue(
        "VIEWER",
      );

      // 비활성화
      const editorRow = page
        .getByTestId("user-row")
        .filter({ hasText: "editor@acos.local" });
      await editorRow.getByRole("button", { name: "비활성화" }).click();
      await expect(editorRow).toContainText("비활성");
      await expect(
        editorRow.getByRole("button", { name: "활성화" }),
      ).toBeVisible();

      // 감사 로그 — 생성/역할 변경/비활성화 기록
      const audit = page.getByTestId("user-audit-list");
      await expect(audit).toContainText("USER_CREATED");
      await expect(audit).toContainText("ROLE_CHANGED");
      await expect(audit).toContainText("USER_DISABLED");
      await expect(audit).toContainText("by admin@acos.local");
    });

    test("자기 자신 비활성화는 오류 안내", async ({ page }) => {
      await page.goto("/admin/users");
      const adminRow = page
        .getByTestId("user-row")
        .filter({ hasText: "admin@acos.local" });
      await adminRow.getByRole("button", { name: "비활성화" }).click();
      await expect(page.getByTestId("admin-action-error")).toContainText(
        "자기 자신",
      );
    });
  });
});
