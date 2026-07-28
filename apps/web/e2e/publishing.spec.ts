import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

/** 스텁의 발행 상태 초기화 (mode 재설정 시 함께 리셋됨) */
async function reset(): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode: "data" }),
  });
}

test.describe("발행 파이프라인 Web UI (TASK-0704)", () => {
  // TASK-0801: 전이는 로그인 필요 — 각 테스트에 세션 토큰 주입
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("acos_token", "stub-token");
    });
  });

  test("상태 변경 UI — DRAFT → REVIEW → PUBLISHED(publishedAt) → ARCHIVED(종결)", async ({
    page,
  }) => {
    await reset();
    await page.goto("/projects/proj-pub");

    const item = page.getByTestId("content-item");
    const badge = item.getByTestId("content-status-badge");
    await expect(badge).toHaveText("DRAFT");

    // DRAFT → REVIEW
    await item.getByRole("button", { name: "검토 요청 (REVIEW)" }).click();
    await expect(badge).toHaveText("REVIEW");

    // REVIEW → PUBLISHED: publishedAt 표기 + 발행 버튼 강조
    await item.getByRole("button", { name: "발행 (PUBLISHED)" }).click();
    await expect(badge).toHaveText("PUBLISHED");
    await expect(item.getByTestId("content-published-at")).toContainText(
      "발행:",
    );

    // 감사 이력 최신순 확인
    const history = item.getByTestId("content-history");
    await expect(history).toContainText("REVIEW → PUBLISHED");
    await expect(history).toContainText("DRAFT → REVIEW");

    // PUBLISHED → ARCHIVED: 종결 상태 (전이 버튼 없음)
    await item.getByRole("button", { name: "보관 (ARCHIVED)" }).click();
    await expect(badge).toHaveText("ARCHIVED");
    await expect(item.getByText("종결됨 (전이 불가)")).toBeVisible();
    // publishedAt은 보관 후에도 보존 (CTO 결정)
    await expect(item.getByTestId("content-published-at")).toBeVisible();
  });

  test("REVIEW → DRAFT 되돌리기 버튼이 동작한다", async ({ page }) => {
    await reset();
    await page.goto("/projects/proj-pub");
    const item = page.getByTestId("content-item");

    await item.getByRole("button", { name: "검토 요청 (REVIEW)" }).click();
    await expect(item.getByTestId("content-status-badge")).toHaveText("REVIEW");

    await item.getByRole("button", { name: "DRAFT로 되돌리기" }).click();
    await expect(item.getByTestId("content-status-badge")).toHaveText("DRAFT");
    await expect(item.getByTestId("content-history")).toContainText(
      "REVIEW → DRAFT",
    );
  });
});
