import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function openDashboard(page: import("@playwright/test").Page) {
  await page.goto("/admin/health");
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

test.describe("Health Dashboard (TASK-1202)", () => {
  test("준비된 상태는 배포 가능으로 표시된다", async ({ page }) => {
    await setMode("data");
    await openDashboard(page);

    await expect(page.getByTestId("readiness-verdict")).toContainText(
      "배포 가능",
    );
    await expect(page.getByTestId("readiness-summary")).toContainText("실패 0");
    await expect(page.getByTestId("readiness-blockers")).toHaveCount(0);

    // 체크리스트 — 자동 판정 + 직접 확인 항목
    const checklist = page.getByTestId("checklist-section");
    await expect(checklist).toContainText("환경변수 검증");
    await expect(checklist).toContainText("마이그레이션 적용");
    await expect(checklist).toContainText("직접 확인"); // 스모크 항목

    // 구성 요소
    await expect(page.getByTestId("component-row")).toHaveCount(2);
    await expect(page.getByTestId("component-section")).toContainText(
      "버킷 접근 정상",
    );
  });

  test("차단 항목이 있으면 배포 불가와 사유를 표시한다", async ({ page }) => {
    await setMode("empty");
    await openDashboard(page);

    await expect(page.getByTestId("readiness-verdict")).toContainText(
      "배포 불가",
    );
    const blockers = page.getByTestId("readiness-blockers");
    await expect(blockers).toContainText("환경변수 검증");
    await expect(blockers).toContainText("마이그레이션 적용");
    await expect(blockers).toContainText("이미지 저장소 접근");

    // 환경 검증 오류·권고가 함께 보인다
    const issues = page.getByTestId("env-issues");
    await expect(issues).toContainText("S3_BUCKET");
    await expect(issues).toContainText("오류");
    await expect(issues).toContainText("LLM_DAILY_BUDGET_USD");
    await expect(issues).toContainText("권고");
  });

  test("설정 현황에서 비밀 값은 값이 아니라 설정 여부만 보인다", async ({
    page,
  }) => {
    await setMode("data");
    await openDashboard(page);

    const table = page.getByTestId("configuration-table");
    await expect(table).toContainText("DATABASE_URL");
    await expect(table).toContainText("설정됨 (비공개)");
    // 비밀이 아닌 값은 그대로 보인다
    await expect(table).toContainText("acos");
    await expect(table).toContainText("mock (실제 호출 없음)");
  });

  test("미인증 접근은 ADMIN 권한 안내를 표시한다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/health");
    await page.evaluate(() => localStorage.removeItem("acos_token"));
    await page.reload();

    await expect(page.getByTestId("health-error")).toContainText(
      "ADMIN 권한이 필요합니다",
    );
  });
});
