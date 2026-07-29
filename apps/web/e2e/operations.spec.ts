import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function openPage(page: import("@playwright/test").Page) {
  await page.goto("/admin/operations");
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

test.describe("운영 대시보드 (TASK-1601)", () => {
  test("정상 상태 — 백업·복원·Redis·메일을 한 화면에서 판정한다", async ({
    page,
  }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("dr-verdict")).toContainText("복구 가능");
    await expect(page.getByTestId("backup-verdict")).toContainText("정상");
    await expect(page.getByTestId("restore-verdict")).toContainText("정상");
    await expect(page.getByTestId("redis-verdict")).toContainText("정상");
    await expect(page.getByTestId("smtp-verdict")).toContainText("연결 확인");

    // 백업 이력 — 크기와 실행 주체가 보인다
    await expect(page.getByTestId("backup-status")).toContainText("2.3MB");
    await expect(page.getByTestId("backup-status")).toContainText("예약");
  });

  test("복원 검증 이력이 없으면 복구 불가로 판정한다", async ({ page }) => {
    // 백업 파일이 있어도 복원해 본 적이 없으면 복구를 장담할 수 없다
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("dr-verdict")).toContainText("복구 불가");
    await expect(page.getByTestId("dr-item-restore")).toContainText("실패");
    await expect(page.getByTestId("dr-item-restore")).toContainText(
      "복원해 보지 않은 백업은 백업이 아닙니다",
    );
    await expect(page.getByTestId("backup-verdict")).toContainText("이력 없음");
  });

  test("자동 판정할 수 없는 항목은 '직접 확인'으로 남는다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const runbook = page.getByTestId("dr-item-runbook");
    await expect(runbook).toContainText("직접 확인");
    await expect(runbook).toContainText("disaster-recovery.md");
    // 통과로 세지 않는다
    await expect(page.getByTestId("dr-checklist")).toContainText(
      "직접 확인 1",
    );
  });

  test("Redis 장애는 복구 가능성을 낮추지 않는다 (CTO 결정 1501-②)", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("dr-item-lock")).toContainText("주의");
    await expect(page.getByTestId("redis-health")).toContainText(
      "LLM 호출은 계속됩니다",
    );
    await expect(page.getByTestId("redis-health")).toContainText(
      "30분 이상 지속되면 심각 경보",
    );
  });

  test("복원 검증 미구성은 실패가 아니라 '하지 못한 것'으로 알린다", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    await page.getByTestId("verify-restore").click();
    await expect(page.getByTestId("operations-note")).toContainText(
      "실패가 아니라 하지 못한 것입니다",
    );
    await expect(page.getByTestId("smtp-verdict")).toContainText("미구성");
  });

  test("지금 백업을 누르면 복구 지점이 생긴다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);
    await expect(page.getByTestId("backup-verdict")).toContainText("이력 없음");

    await page.getByTestId("run-backup").click();
    await expect(page.getByTestId("operations-note")).toContainText(
      "백업 완료",
    );
    await expect(page.getByTestId("backup-verdict")).toContainText("정상");
    await expect(page.getByTestId("dr-item-backup")).toContainText("통과");
  });

  test("메일 경로 확인은 연결만 보고 메일을 보내지 않는다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("smtp-health")).toContainText(
      "메일은 보내지 않습니다",
    );
    await page.getByTestId("verify-smtp").click();
    await expect(page.getByTestId("operations-note")).toContainText(
      "메일은 보내지 않았습니다",
    );
  });

  test("ADMIN 토큰이 없으면 권한 안내만 보인다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/operations");

    await expect(page.getByTestId("operations-error")).toContainText(
      "ADMIN 권한이 필요합니다",
    );
    await expect(page.getByTestId("dr-checklist")).toHaveCount(0);
  });
});
