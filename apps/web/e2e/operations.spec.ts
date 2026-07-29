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
    // 통과로 세지 않는다 — 리허설 기록 전에는 리허설도 직접 확인이다
    await expect(page.getByTestId("dr-checklist")).toContainText(
      "직접 확인 2",
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

test.describe("Enterprise 백업·재해 복구 (TASK-1701)", () => {
  test("무결성·원격 복제·저장소 보호·복원 대상을 한 묶음으로 보여준다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("integrity-status")).toContainText("통과");
    await expect(page.getByTestId("integrity-status")).toContainText(
      "객체 142개",
    );
    // 체크섬 전체를 늘어놓지 않는다
    await expect(page.getByTestId("integrity-status")).not.toContainText(
      "c".repeat(64),
    );
    await expect(page.getByTestId("offsite-status")).toContainText("사본 1개");
    await expect(page.getByTestId("storage-protection")).toContainText(
      "버전 관리 켜짐",
    );
    await expect(page.getByTestId("restore-target")).toContainText(
      "운영 데이터베이스와 분리",
    );
  });

  test("복구 목표는 측정치를 쓰고, 하한임을 밝힌다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("objectives-verdict")).toContainText("통과");
    await expect(page.getByTestId("rpo-value")).toContainText("3분");
    await expect(page.getByTestId("rto-value")).toContainText("8초");
    await expect(page.getByTestId("recovery-objectives")).toContainText(
      "측정된 하한",
    );
  });

  test("측정치가 없으면 '확인 불가'로 두고 0으로 채우지 않는다", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("rto-value")).toContainText("확인 불가");
    await expect(page.getByTestId("objectives-verdict")).toContainText(
      "직접 확인",
    );
  });

  test("저장소가 알려 주지 않으면 통과로 세지 않는다 (CTO 결정 1601-④)", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    const protection = page.getByTestId("storage-protection");
    await expect(protection).toContainText("직접 확인");
    await expect(protection).toContainText("버전 관리 확인 불가");
    await expect(protection).toContainText(
      "애플리케이션은 이미지를 백업하지 않습니다",
    );
  });

  test("원격 복제가 꺼져 있으면 백업이 함께 사라진다고 말한다", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    const offsite = page.getByTestId("offsite-status");
    await expect(offsite).toContainText("주의");
    await expect(offsite).toContainText("백업도 함께 사라집니다");
    await expect(offsite).toContainText("꺼짐 (BACKUP_OFFSITE)");
  });
});

test.describe("Enterprise Operations Platform (TASK-1801)", () => {
  test("리허설 기록이 없으면 '직접 확인'으로 남는다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("drill-verdict")).toContainText("직접 확인");
    await expect(page.getByTestId("recovery-drill")).toContainText(
      "절차를 읽는 것과 해 보는 것은 다릅니다",
    );
    await expect(page.getByTestId("recovery-drill")).toContainText("90일마다");
  });

  test("리허설을 기록하면 체크리스트가 통과로 바뀐다 (CTO 결정 1701-⑤)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await page.getByTestId("record-drill").click();
    await page.getByTestId("drill-performer").fill("운영자 A");
    await page.getByTestId("drill-success").click();

    await expect(page.getByTestId("operations-note")).toContainText(
      "성공으로 기록",
    );
    await expect(page.getByTestId("drill-verdict")).toContainText("통과");
    await expect(page.getByTestId("dr-item-drill")).toContainText("통과");
    await expect(page.getByTestId("recovery-drill")).toContainText("운영자 A");
  });

  test("실패한 리허설도 기록하고, 더 값지다고 말한다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await page.getByTestId("record-drill").click();
    await expect(page.getByTestId("drill-form")).toContainText(
      "실패한 리허설이 더 값집니다",
    );
    await page.getByTestId("drill-performer").fill("운영자 B");
    await page.getByTestId("drill-findings").fill("복원 DB 권한 없음");
    await page.getByTestId("drill-failure").click();

    await expect(page.getByTestId("drill-verdict")).toContainText("실패");
    await expect(page.getByTestId("recovery-drill")).toContainText(
      "복원 DB 권한 없음",
    );
  });

  test("수행자를 적기 전에는 기록할 수 없다", async ({ page }) => {
    // 누가 확인했는지 남지 않으면 기록이 아니다
    await setMode("data");
    await openPage(page);

    await page.getByTestId("record-drill").click();
    await expect(page.getByTestId("drill-success")).toBeDisabled();
    await page.getByTestId("drill-performer").fill("운영자 C");
    await expect(page.getByTestId("drill-success")).toBeEnabled();
  });

  test("백업 버킷이 이미지 버킷과 분리되어 있는지 보여준다 (CTO 결정 1701-②)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);
    await expect(page.getByTestId("backup-bucket")).toContainText("분리됨");
    await expect(page.getByTestId("backup-bucket")).toContainText(
      "acos-backups",
    );

    await setMode("empty");
    await openPage(page);
    await expect(page.getByTestId("backup-bucket")).toContainText("같은 버킷");
    await expect(page.getByTestId("backup-bucket")).toContainText(
      "함께 사라집니다",
    );
  });
});
