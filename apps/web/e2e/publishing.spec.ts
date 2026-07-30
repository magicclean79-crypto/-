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

test.describe("발행 거버넌스 Web UI (TASK-2501)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("acos_token", "stub-token");
    });
  });

  /** 본문에 금지어를 넣는다 */
  async function ban(): Promise<void> {
    await fetch(`${STUB}/__publishing/ban`, { method: "POST" });
  }

  /** 금지어를 지운다 */
  async function unban(): Promise<void> {
    await fetch(`${STUB}/__publishing/unban`, { method: "POST" });
  }

  test("판정이 발행 버튼 옆에 보인다 — 눌러 보고 알게 되지 않는다", async ({
    page,
  }) => {
    await reset();
    await ban();
    await page.goto("/projects/proj-pub");

    const panel = page.getByTestId("content-governance");
    await expect(panel.getByTestId("governance-status")).toHaveText("실패");
    await expect(panel.getByTestId("governance-verdict")).toHaveText("발행 차단");
    // 무엇이 막는지 그대로 보여준다
    await expect(panel).toContainText("금지어 발견: 1위");
    // 색만으로 구분하지 않는다 — 막는 항목임을 글자로 밝힌다
    await expect(panel).toContainText("발행 차단");
  });

  test("다섯 검사가 모두 보이고, 판정 기준도 함께 보인다", async ({ page }) => {
    await reset();
    await page.goto("/projects/proj-pub");

    const panel = page.getByTestId("content-governance");
    await expect(panel.getByTestId("governance-check")).toHaveCount(5);
    for (const name of [
      "제목·본문",
      "금지어 검사",
      "필수 고지",
      "근거 상품 연결",
      "관련 규칙 검토",
    ]) {
      await expect(panel).toContainText(name);
    }
    // 규칙은 나중에 바뀐다 — 어떤 기준으로 판정했는지 보여준다
    await expect(panel).toContainText("금지어 2개");
    await expect(panel).toContainText("적용 고지 1건");
  });

  test("금지어가 든 본문은 발행 버튼을 눌러도 막히고 사유가 뜬다", async ({
    page,
  }) => {
    await reset();
    await ban();
    await page.goto("/projects/proj-pub");
    const item = page.getByTestId("content-item");

    await item.getByRole("button", { name: "검토 요청 (REVIEW)" }).click();
    await expect(item.getByTestId("content-status-badge")).toHaveText("REVIEW");

    await item.getByRole("button", { name: "발행 (PUBLISHED)" }).click();
    await expect(item.getByTestId("content-status-error")).toContainText(
      "발행 거버넌스 판정을 통과하지 못했습니다",
    );
    // 상태는 그대로 — 막혔으면 바뀌지 않는다
    await expect(item.getByTestId("content-status-badge")).toHaveText("REVIEW");
    await expect(item.getByTestId("content-published-at")).toHaveCount(0);
  });

  test("금지어를 지우면 발행된다", async ({ page }) => {
    await reset();
    await ban();
    await page.goto("/projects/proj-pub");
    const item = page.getByTestId("content-item");
    await item.getByRole("button", { name: "검토 요청 (REVIEW)" }).click();
    await item.getByRole("button", { name: "발행 (PUBLISHED)" }).click();
    await expect(item.getByTestId("content-status-error")).toBeVisible();

    await unban();
    await page.reload();
    const fixed = page.getByTestId("content-item");
    await expect(
      fixed.getByTestId("content-governance").getByTestId("governance-verdict"),
    ).toHaveText("발행 가능");

    await fixed.getByRole("button", { name: "발행 (PUBLISHED)" }).click();
    await expect(fixed.getByTestId("content-status-badge")).toHaveText(
      "PUBLISHED",
    );
  });

  test("주의만 있으면 발행 가능으로 보인다 — 미구성과 위반은 다르다", async ({
    page,
  }) => {
    await reset();
    await page.goto("/projects/proj-pub");

    const panel = page.getByTestId("content-governance");
    // 근거 상품 연결이 주의지만 막지는 않는다
    await expect(panel.getByTestId("governance-status")).toHaveText("주의");
    await expect(panel.getByTestId("governance-verdict")).toHaveText("발행 가능");
    await expect(panel).toContainText("추적할 수 없습니다");
  });
});
