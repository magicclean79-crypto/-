import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function reset(): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode: "data" }),
  });
}

test.describe("로그인 보호 (TASK-0804)", () => {
  test("연속 로그인 실패 5회 → 계정 잠금 안내", async ({ page }) => {
    await reset();
    await page.goto("/login");

    const form = page.getByTestId("login-form");
    await form.getByLabel("이메일").fill("admin@acos.local");

    // 4회까지는 일반 실패 메시지
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await form.getByLabel("비밀번호").fill(`wrong-pass-${attempt}`);
      await form.getByRole("button", { name: "로그인" }).click();
      await expect(page.getByTestId("login-error")).toContainText(
        "이메일 또는 비밀번호가 올바르지 않습니다",
      );
    }

    // 5회째 실패로 잠금 → 이후 올바른 비밀번호도 잠금 안내
    await form.getByLabel("비밀번호").fill("wrong-pass-5");
    await form.getByRole("button", { name: "로그인" }).click();
    await form.getByLabel("비밀번호").fill("admin1234");
    await form.getByRole("button", { name: "로그인" }).click();
    await expect(page.getByTestId("login-error")).toContainText(
      "계정이 잠겼습니다",
    );
  });

  test("비밀번호 복잡도 — 숫자 없는 새 비밀번호는 오류 안내", async ({
    page,
  }) => {
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
          lockedUntil: null,
          createdAt: "2026-07-28T00:00:00.000Z",
        }),
      );
    });
    await page.goto("/account");

    const form = page.getByTestId("password-change-form");
    await form.getByLabel("현재 비밀번호").fill("admin1234");
    await form.getByLabel("새 비밀번호 (8자+)").fill("aaaaaaaa");
    await form.getByLabel("새 비밀번호 확인").fill("aaaaaaaa");
    await form.getByRole("button", { name: "변경" }).click();
    await expect(page.getByTestId("password-change-error")).toContainText(
      "숫자를 1자 이상 포함",
    );
  });

  test("실패/잠금 감사 로그 — LOGIN_FAILED·ACCOUNT_LOCKED가 목록에 보인다", async ({
    page,
  }) => {
    await reset();
    // 5회 실패로 잠금 상태를 만든다 (API 직접 호출)
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await fetch(`${STUB}/auth/login`, {
        method: "POST",
        body: JSON.stringify({
          email: "admin@acos.local",
          password: `wrong-${attempt}`,
        }),
      });
    }
    await page.addInitScript(() => {
      localStorage.setItem("acos_token", "stub-token");
    });
    await page.goto("/admin/users");

    const audit = page.getByTestId("user-audit-list");
    await expect(audit).toContainText("ACCOUNT_LOCKED");
    await expect(audit).toContainText("LOGIN_FAILED");
    await expect(audit).toContainText("연속 5회 실패");
  });
});
