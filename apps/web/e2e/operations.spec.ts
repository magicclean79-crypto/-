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
    // 통과로 세지 않는다 — 리허설·원격 사본 대조도 직접 확인이다
    await expect(page.getByTestId("dr-checklist")).toContainText(
      "직접 확인 3",
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
    await expect(protection).toContainText("운영 저장소 표준은 Amazon S3");
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

test.describe("Enterprise Recovery Assurance (TASK-1901)", () => {
  test("백업 소요 시간에 기준이 붙는다 (CTO 결정 1801-①)", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const performance = page.getByTestId("backup-performance");
    await expect(performance).toContainText("통과");
    await expect(performance).toContainText(
      "2초 미만 정상 · 2~10초 주의 · 10초 3회 연속 경보 · 30초 심각",
    );
    await expect(performance).toContainText("1.2초");
  });

  test("2~10초는 주의로 드러내되 조치 수준은 아니라고 말한다", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    const performance = page.getByTestId("backup-performance");
    await expect(performance).toContainText("주의");
    await expect(performance).toContainText("아직 조치할 수준은 아니지만");
  });

  test("백업 버킷도 이미지 버킷과 같이 보호 상태를 판정한다 (CTO 결정 1801-③)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("backup-bucket-protection")).toContainText(
      "통과",
    );
    await expect(page.getByTestId("backup-bucket-protection")).toContainText(
      "백업 버킷",
    );
    // 두 항목이 체크리스트에 모두 있다
    await expect(page.getByTestId("dr-item-storage-protection")).toBeVisible();
    await expect(
      page.getByTestId("dr-item-backup-bucket-protection"),
    ).toBeVisible();
  });

  test("조회 불가 저장소는 백업 버킷도 '직접 확인'으로 남는다 (CTO 결정 1801-④)", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    const protection = page.getByTestId("backup-bucket-protection");
    await expect(protection).toContainText("직접 확인");
    await expect(protection).toContainText("운영 저장소 표준은 Amazon S3");
    await expect(protection).toContainText("MinIO·s3rver는 개발 전용");
  });
});

/** 스텁에 리허설 요구를 직접 등록한다 (대시보드에는 등록 UI가 없다) */
async function requireDrill(
  trigger: string,
  description: string,
): Promise<number> {
  const response = await fetch(`${STUB}/ops/drills/require`, {
    method: "POST",
    headers: {
      authorization: "Bearer stub-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ trigger, description, registeredBy: "운영자" }),
  });
  return response.status;
}

test.describe("Enterprise Backup Integrity Platform (TASK-2001)", () => {
  test("백업 사슬 연속성을 개별 성공과 따로 판정한다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const chain = page.getByTestId("backup-chain");
    await expect(chain).toContainText("통과");
    await expect(chain).toContainText("24/24회");
    await expect(chain).toContainText(
      "개별 백업이 모두 성공이어도 사슬은 끊길 수 있습니다",
    );
  });

  test("사슬 공백은 되돌아갈 수 없는 구간이라 복구 불가로 판정한다", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    const chain = page.getByTestId("backup-chain");
    await expect(chain).toContainText("실패");
    await expect(chain).toContainText("5.0시간 공백");
    await expect(chain).toContainText(
      "돌지 않은 백업은 아무 데도 기록되지 않습니다",
    );
    // critical 항목이다 — 복구 가능성 판정을 바꾼다
    await expect(page.getByTestId("dr-item-backup-chain")).toContainText(
      "실패",
    );
    await expect(page.getByTestId("dr-verdict")).toContainText("복구 불가");
  });

  test("원격 사본 대조는 기본으로 돌지 않는다 — 전송 비용이 든다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    const remote = page.getByTestId("remote-integrity");
    await expect(remote).toContainText("직접 확인");
    await expect(remote).toContainText("전송 비용");
    await expect(page.getByTestId("verify-remote")).toContainText(
      "원격 사본 검증 (전송 비용)",
    );

    await page.getByTestId("verify-remote").click();
    await expect(page.getByTestId("operations-note")).toContainText(
      "내려받아 대조했습니다",
    );
    await expect(remote).toContainText("통과");
    // 체크섬 전체를 늘어놓지 않는다
    await expect(remote).not.toContainText("c".repeat(64));
  });

  test("원격에 사본이 없으면 올렸다는 기록만 남은 상태라고 말한다", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    await page.getByTestId("verify-remote").click();
    await expect(page.getByTestId("operations-note")).toContainText(
      "올렸다는 기록만 남아 있고 실제 사본은 없습니다",
    );
  });

  test("운영 저장소 표준은 Amazon S3이고, 개발 저장소는 개발에서 정상이다 (CTO 결정 1901-③)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    const standard = page.getByTestId("storage-standard");
    await expect(standard).toContainText("통과");
    await expect(standard).toContainText("개발에서는 정상입니다");
    await expect(standard).toContainText("운영 표준은 Amazon S3");
  });

  test("데이터베이스 규모는 재평가 신호로만 쓰고 기준을 자동으로 바꾸지 않는다 (CTO 결정 1901-④)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    const scale = page.getByTestId("database-scale");
    await expect(scale).toContainText("통과");
    await expect(scale).toContainText("재평가 기준 10 · 50 · 100GB");
    await expect(scale).toContainText("10.0GB까지");

    await setMode("empty");
    await openPage(page);
    await expect(scale).toContainText("주의");
    await expect(scale).toContainText("실측으로 다시 재세요");
    await expect(scale).toContainText("자동으로 바꾸지는 않습니다");
  });

  test("같은 Trigger가 미해소면 중복 등록하지 않는다 (CTO 결정 1901-⑤)", async ({
    page,
  }) => {
    await setMode("data");
    expect(await requireDrill("dr-change", "복구 절차 개정")).toBe(201);
    // 두 번째는 거절한다 — 리허설 1회로 함께 해소되므로 쌓을 이유가 없다
    expect(await requireDrill("dr-change", "복구 절차 재개정")).toBe(409);
    // 다른 Trigger는 별개다
    expect(await requireDrill("pitr-adoption", "PITR 도입")).toBe(201);

    await openPage(page);
    const triggers = page.getByTestId("drill-triggers");
    await expect(triggers).toContainText("재해 복구 절차 변경");
    await expect(triggers).toContainText("PITR 도입");
    await expect(triggers).not.toContainText("복구 절차 재개정");
  });

  test("요구는 삭제하지 않고 사유와 함께 취소로 남긴다 (CTO 결정 1901-②)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    // 먼저 리허설을 통과시켜 둔다 — 그 뒤의 변경이 판정을 뒤집는지 본다
    await page.getByTestId("record-drill").click();
    await page.getByTestId("drill-performer").fill("운영자 D");
    await page.getByTestId("drill-success").click();
    await expect(page.getByTestId("dr-item-drill")).toContainText("통과");

    expect(await requireDrill("dr-change", "복구 절차 개정")).toBe(201);
    await page.reload();
    await expect(page.getByTestId("dr-item-drill")).toContainText("실패");

    page.once("dialog", (dialog) => void dialog.accept("절차 변경이 철회됨"));
    await page.getByTestId("cancel-requirement-req-1").click();

    await expect(page.getByTestId("operations-note")).toContainText(
      "사유와 함께 남습니다",
    );
    // 목록에서 사라지지 않는다 — 취소 기록으로 남는다
    const cancelled = page.getByTestId("cancelled-requirements");
    await expect(cancelled).toContainText("복구 절차 개정");
    await expect(cancelled).toContainText("절차 변경이 철회됨");
    // 취소된 요구는 리허설을 붙잡지 않는다
    await expect(page.getByTestId("drill-triggers")).toHaveCount(0);
    await expect(page.getByTestId("dr-item-drill")).toContainText("통과");
  });
});

test.describe("Enterprise Operational Automation (TASK-2101)", () => {
  test("원격 대조가 운영에서 주 1회 자동으로 돈다고 말한다 (CTO 결정 2001-②)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    const remote = page.getByTestId("remote-integrity");
    await expect(remote).toContainText("자동 대조 주기 7.0일");
    await expect(remote).toContainText("마지막 백업 1건만 내려받습니다");
  });

  test("예약되지 않은 환경에서는 자동으로 돌지 않는다고 말한다", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    const remote = page.getByTestId("remote-integrity");
    await expect(remote).toContainText("자동 대조가 예약되어 있지 않습니다");
    await expect(remote).toContainText("전송 비용");
  });

  test("대조하면 무엇을 언제 봤는지 남는다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await page.getByTestId("verify-remote").click();
    const remote = page.getByTestId("remote-integrity");
    await expect(remote).toContainText("통과");
    await expect(remote).toContainText("acos-2026-07-29.dump");
  });

  test("관측 창을 올렸으면 숨기지 않는다 (CTO 결정 2001-①)", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    const clamped = page.getByTestId("chain-window-clamped");
    await expect(clamped).toContainText("4배에 못 미쳐");
    await expect(clamped).toContainText("올렸습니다");
  });

  test("기본 창은 조용히 지나간다 — 올리지 않았으면 말할 것이 없다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);
    await expect(page.getByTestId("chain-window-clamped")).toHaveCount(0);
  });

  test("재기동 후 자동 등록을 화면에서 확인한다 (CTO 결정 2001-④)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    const auto = page.getByTestId("auto-registration");
    await expect(auto).toContainText("등록됨");
    await expect(auto).toContainText("20260729210000_enterprise_backup");
    await expect(auto).toContainText("기동 시 1회");
  });

  test("확인하지 못한 것을 '등록할 것이 없었다'로 적지 않는다", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    const auto = page.getByTestId("auto-registration");
    await expect(auto).toContainText("확인 불가");
    await expect(auto).toContainText("확인하지 못했습니다");
  });

  test("원격 대조가 예약 점검 목록에 주 1회로 보인다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/production");
    await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
    await page.reload();

    await expect(page.getByTestId("schedule-remote-verify")).toContainText(
      "remote-verify",
    );
    await expect(page.getByTestId("schedule-remote-verify")).toContainText(
      "7일",
    );
  });
});
