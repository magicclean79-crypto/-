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

test.describe("Enterprise Deployment Governance (TASK-2301)", () => {
  test("운영 표준 다섯 항목이 배포 체크리스트에 보인다 (CTO 결정 2201-④)", async ({
    page,
  }) => {
    await setMode("data");
    await openDashboard(page);

    const section = page.getByTestId("checklist-section");
    for (const title of [
      "이미지 버킷 준비",
      "저장소 접근 권한 (IAM)",
      "이미지 버킷 버전 관리",
      "백업 버킷 준비·분리",
      "재해 복구 판정 (복구 가능 여부)",
    ]) {
      await expect(section).toContainText(title);
    }
  });

  test("준비되지 않으면 무엇을 누가 해야 하는지 말한다", async ({ page }) => {
    await setMode("empty");
    await openDashboard(page);

    const section = page.getByTestId("checklist-section");
    await expect(section).toContainText("운영 담당자가 버킷을 만들어야 합니다");
    await expect(section).toContainText("s3:GetBucketVersioning");
    await expect(section).toContainText("지금 무너지면 되살릴 수 없습니다");
  });

  test("스키마 적용 주체가 드러난다 (CTO 결정 2201-①)", async ({ page }) => {
    await setMode("data");
    await openDashboard(page);

    const panel = page.getByTestId("migration-governance");
    await expect(panel).toContainText("스키마 적용");
    await expect(panel).toContainText("운영 담당자 수행");
    await expect(panel).toContainText(
      "애플리케이션은 스키마를 적용하지 않습니다",
    );
  });

  test("미적용 마이그레이션 이름을 그대로 보여준다", async ({ page }) => {
    await setMode("empty");
    await openDashboard(page);

    const pending = page.getByTestId("pending-migrations");
    await expect(pending).toContainText("20260801000000_requirement_cancel");
    await expect(pending).toContainText("20260802000000_remote_verify");
  });

  test("전부 적용됐으면 목록을 띄우지 않는다", async ({ page }) => {
    await setMode("data");
    await openDashboard(page);
    await expect(page.getByTestId("pending-migrations")).toHaveCount(0);
  });

  test("준비되지 않은 항목이 배포를 막는다", async ({ page }) => {
    await setMode("empty");
    await openDashboard(page);

    await expect(page.getByTestId("readiness-verdict")).toContainText(
      "배포 불가",
    );
    const blockers = page.getByTestId("checklist-section");
    await expect(blockers).toContainText("배포 차단");
  });
});

test.describe("Enterprise Operational Compliance (TASK-2401)", () => {
  test("확인하지 못한 미적용 개수를 0으로 적지 않는다 (CTO 결정 2301-④)", async ({
    page,
  }) => {
    await setMode("compliance");
    await openDashboard(page);

    // 0으로 보이면 "미적용 없음"으로 읽힌다 — 그것이 거짓 통과다
    await expect(page.getByTestId("component-section")).toContainText(
      "확인 불가",
    );
    await expect(page.getByTestId("migration-governance")).toContainText(
      "마이그레이션 목록과 적용 기록을 모두 읽어야",
    );
    await expect(page.getByTestId("pending-migrations")).toHaveCount(0);
  });

  test("S3 전환 후 버전 관리 조회 실패가 배포를 막는다 (CTO 결정 2301-③)", async ({
    page,
  }) => {
    await setMode("compliance");
    await openDashboard(page);

    await expect(page.getByTestId("readiness-verdict")).toContainText(
      "배포 불가",
    );
    const blockers = page.getByTestId("readiness-blockers");
    await expect(blockers).toContainText("이미지 버킷 버전 관리");
    // 저장소의 한계가 아니라 권한 누락이라고 말한다
    await expect(page.getByTestId("checklist-section")).toContainText(
      "s3:GetBucketVersioning 권한이 빠졌다",
    );
  });

  test("복구 판정을 확인하지 못하면 직접 확인으로 남는다 (CTO 결정 2301-①)", async ({
    page,
  }) => {
    await setMode("compliance");
    await openDashboard(page);

    const section = page.getByTestId("checklist-section");
    await expect(section).toContainText("재해 복구 판정 (복구 가능 여부)");
    // 통과로 뭉개지 않고, 어디서 확인하는지 알려 준다
    await expect(section).toContainText(
      "재해 복구 판정을 확인하지 못했습니다",
    );
    await expect(section).toContainText("/ops/readiness");
  });
});
