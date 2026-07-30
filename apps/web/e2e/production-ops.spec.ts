import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function openPage(page: import("@playwright/test").Page) {
  await page.goto("/admin/production");
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

test.describe("Provider 운영 점검 (TASK-1301)", () => {
  test("정상 상태 — 키 형식·비용·모니터링을 한 화면에 보여준다", async ({
    page,
  }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await openPage(page);

    // API Key Validation — 키 값은 힌트만, 원문은 어디에도 없다
    await expect(page.getByTestId("validation-verdict")).toContainText(
      "문제 없음",
    );
    const openai = page.getByTestId("provider-openai");
    await expect(openai).toContainText("형식 정상");
    await expect(openai).toContainText("sk-pro…");
    await expect(page.getByTestId("provider-anthropic")).toContainText(
      "미설정",
    );
    // 기본 조회는 Live Check를 하지 않는다 (실호출·과금)
    await expect(openai).toContainText("미실행");

    // Production Monitoring
    await expect(page.getByTestId("monitor-status")).toContainText("정상");
    await expect(page.getByTestId("monitor-openai")).toContainText(
      "820 / 1900 / 2400ms",
    );
    await expect(page.getByTestId("monitor-alerts")).toHaveCount(0);

    // Cost Verification
    await expect(page.getByTestId("cost-verdict")).toContainText("일치");
    await expect(page.getByTestId("cost-issues")).toHaveCount(0);
    await expect(page.getByTestId("cost-verification")).toContainText(
      "미산정 0건",
    );
  });

  test("진단 호출은 관측에서 제외되고, 제외된 수는 보인다 (CTO 결정 1301-③)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);
    await expect(page.getByTestId("production-monitor")).toContainText(
      "관측에서 제외",
    );
    await expect(page.getByTestId("production-monitor")).toContainText(
      "진단 호출 2건",
    );
  });

  test("문제 상태 — 조치 항목과 경보를 드러낸다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("validation-verdict")).toContainText(
      "조치 필요",
    );
    await expect(page.getByTestId("validation-blockers")).toContainText(
      "플레이스홀더",
    );

    await expect(page.getByTestId("monitor-status")).toContainText("저하");
    await expect(page.getByTestId("monitor-alerts")).toContainText("성공률 70%");

    await expect(page.getByTestId("cost-verdict")).toContainText("확인 필요");
    await expect(page.getByTestId("cost-issues")).toContainText(
      "예산 상한이 적용되지 않습니다",
    );
  });

  test("Live Check는 눌러야 실행된다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("provider-openai")).toContainText("미실행");
    await page.getByTestId("live-check").click();
    await expect(page.getByTestId("provider-openai")).toContainText("정상 412ms");
    await expect(page.getByTestId("key-validation")).toContainText(
      "Live Check 포함",
    );
  });

  test("ADMIN 인증이 없으면 권한 안내를 보여준다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/production");
    await expect(page.getByTestId("production-error")).toContainText(
      "ADMIN 권한이 필요합니다",
    );
  });

  test("경보 — 활성 경보와 예약 점검 구성을 보여준다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    // 배지와 아래 목록이 어긋나면 안 된다 (심각 1 · 주의 1)
    await expect(page.getByTestId("alert-verdict")).toContainText("조치 필요");
    const active = page.getByTestId("active-alerts");
    await expect(active).toContainText("일 예산 초과");
    await expect(active).toContainText("3회 감지");
    await expect(active).toContainText("예산 상한이 적용되지 않습니다");

    // 예약 점검 구성 — 간격과 중단 여부
    await expect(page.getByTestId("schedule-cost-verification")).toContainText(
      "15분",
    );
    await expect(page.getByTestId("schedule-health-check")).toContainText(
      "중단",
    );
    // 전달 채널이 없으면 그 사실을 말한다
    await expect(page.getByTestId("alert-board")).toContainText(
      "사람이 보고 있어야",
    );
  });

  test("경보 없음 — 이상 없음으로 표시하고 지금 점검할 수 있다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("alert-verdict")).toContainText("이상 없음");
    await expect(page.getByTestId("active-alerts")).toHaveCount(0);
    await expect(page.getByTestId("schedule-cost-verification")).toContainText(
      "실행 이력 없음",
    );

    await page.getByTestId("run-checks").click();
    await expect(page.getByTestId("schedule-cost-verification")).toContainText(
      "10건 검사",
    );
  });

  test("주의 경보만 있으면 배지도 '주의'로 — 배지와 목록이 어긋나지 않는다", async ({
    page,
  }) => {
    await setMode("warn");
    await openPage(page);

    // 목록에 경보가 있는데 배지가 "이상 없음"이면 사람이 목록을 무시하게 된다
    await expect(page.getByTestId("alert-verdict")).toContainText("주의 1건");
    await expect(page.getByTestId("alert-verdict")).not.toContainText(
      "이상 없음",
    );
    await expect(page.getByTestId("active-alerts")).toContainText(
      "가격표에 없는 모델",
    );
  });

  test("알림 채널·예약 조율 현황을 보여준다 (TASK-1401)", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const board = page.getByTestId("alert-board");
    // 채널 구성 — 주소가 아니라 어떤 채널이 무엇을 받는지
    await expect(board).toContainText("slack(전체·해소 포함)");
    await expect(board).toContainText("webhook(전체)");
    // 분산 조율 여부를 드러낸다
    await expect(board).toContainText("분산 (인스턴스 pod-a-1234-abcd)");
    // 점검별 리더
    await expect(page.getByTestId("schedule-cost-verification")).toContainText(
      "이 인스턴스",
    );
    await expect(page.getByTestId("schedule-provider-validation")).toContainText(
      "pod-b-5678-efgh",
    );
  });

  test("단일 인스턴스 모드와 전송 실패를 드러낸다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    const board = page.getByTestId("alert-board");
    // 다중 인스턴스에서 중복 실행된다는 사실을 숨기지 않는다
    await expect(board).toContainText("단일 인스턴스");
    await expect(board).toContainText("로그만");

    // 알림이 실패한 사실이 보인다 — 이것이 TASK-1302의 구멍이었다
    const deliveries = page.getByTestId("delivery-history");
    await expect(deliveries).toContainText("실패 1건");
    await deliveries.click();
    await expect(deliveries).toContainText("4회 시도");
  });

  test("보관 정리는 삭제가 아님을 말한다 (CTO 결정 1302-④)", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    await page.getByTestId("archive-alerts").click();
    await expect(page.getByTestId("archive-note")).toContainText(
      "2건을 보관했습니다 (삭제하지 않습니다)",
    );
  });

  test("알림 큐 — Dead Letter를 드러내고 다시 보낼 수 있다 (TASK-1501)", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    const queue = page.getByTestId("notification-queue");
    await expect(page.getByTestId("queue-verdict")).toContainText(
      "전달 실패 2건",
    );
    // 전달 못 한 것을 지우지 않는다는 사실을 화면이 말한다
    await expect(queue).toContainText("지우지 않고 남깁니다");
    await expect(page.getByTestId("dead-letters")).toContainText("HTTP 404");
    await expect(page.getByTestId("dead-letters")).toContainText("4회 시도");
    // 워커가 꺼져 있으면 그 사실을 드러낸다
    await expect(queue).toContainText("워커 중단");

    await page.getByTestId("requeue-dead").click();
    await expect(page.getByTestId("queue-verdict")).toContainText(
      "전달 실패 없음",
    );
  });

  test("보관이 예약 점검에 편입되어 시각으로 표시된다 (CTO 결정 1401-③)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    // 운영 서버 로컬 시각 기준 (CTO 결정 1501-①) — UTC로 적으면 운영자가
    // 생각하는 새벽과 어긋난다
    await expect(page.getByTestId("schedule-alert-archive")).toContainText(
      "매일 04:00 로컬",
    );
  });

  test("백업·복원 검증이 예약에 들어오고, 과금되는 스모크는 꺼져 있다 (TASK-1601)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    // 백업은 시각이 아니라 1시간 간격이다 (CTO 결정 1701-①)
    await expect(page.getByTestId("schedule-backup")).toContainText("1시간");
    await expect(page.getByTestId("schedule-restore-verify")).toContainText(
      "매일 03:30 로컬",
    );
    // 실제 과금되는 점검은 기본으로 돌지 않는다 (CTO 결정 1301-①)
    await expect(page.getByTestId("schedule-provider-smoke")).toContainText(
      "중단",
    );
  });

  test("분산 잠금을 쓸 수 없으면 예약 점검이 돌지 않는다고 말한다 (CTO 결정 1401-①)", async ({
    page,
  }) => {
    await setMode("warn");
    await openPage(page);

    // 단일 모드로 조용히 내려가지 않는다 — 멈춘 사실을 드러낸다
    await expect(page.getByTestId("alert-board")).toContainText(
      "단일 인스턴스",
    );
  });
});

test.describe("Provider 연결 순서 (TASK-2901, CTO 결정 2801-⑤)", () => {
  test("단계별 상태와 다음 단계를 한 화면에 보여준다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const section = page.getByTestId("provider-rollout");
    await expect(section).toBeVisible();
    // 확정된 순서가 화면 순서다
    await expect(page.getByTestId("rollout-stage")).toHaveCount(5);
    await expect(page.getByTestId("rollout-progress")).toContainText(
      "2/5 연결됨",
    );

    // 다음에 붙일 단계를 **글자로** 밝힌다 — 색만으로 구분하지 않는다
    await expect(page.getByTestId("rollout-next")).toHaveText("다음 단계");
    await expect(
      page.getByTestId("rollout-stage").nth(1),
    ).toContainText("Anthropic");
  });

  test("모르는 것을 연결됨으로 보여주지 않는다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const stages = page.getByTestId("rollout-stage");
    // 형식만 맞는 단계는 "확인 안 됨" — 초록(연결됨)이 아니다
    await expect(stages.nth(1)).toContainText("확인 안 됨");
    await expect(stages.nth(1)).toContainText("아직 모릅니다");
    // 미구성은 실패가 아니라고 말한다
    await expect(stages.nth(2)).toContainText("미구성");
    await expect(stages.nth(2)).toContainText("실패가 아닙니다");
    // 가짜가 돌고 있으면 그 사실을 말한다
    await expect(stages.nth(4)).toContainText("가짜(mock)");
    await expect(stages.nth(4)).toContainText("가짜 텍스트");
  });

  test("연결됨에는 근거가 붙고, 순서 이탈은 막지 않는다고 말한다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    // 연결됨의 근거는 선언이 아니라 성공 기록이다
    await expect(page.getByTestId("rollout-stage").first()).toContainText(
      "근거: 실 호출 성공 12건",
    );
    await expect(page.getByTestId("rollout-out-of-order")).toContainText(
      "막지는 않습니다",
    );
  });
});

test.describe("OCR 비용·관측 편입 (TASK-3001, CTO 결정 2901-④)", () => {
  test("OCR을 LLM과 같은 기준으로 관측해 보여준다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const section = page.getByTestId("ocr-monitor");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("ocr-monitor-status")).toHaveText("정상");
    await expect(section).toContainText("호출 12건");
    await expect(section).toContainText("성공률 100.0%");
    // 판정 기준이 LLM과 같다는 사실을 화면이 말한다
    await expect(section).toContainText("LLM과 같은 기준으로 판정합니다");
    await expect(page.getByTestId("ocr-provider-google-vision")).toContainText(
      "google-vision",
    );
  });

  test("OCR 엔진 장애를 장애로 보여준다", async ({ page }) => {
    // 스텁의 "정상이 아닌" 모드 (mode !== "data")
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("ocr-monitor-status")).toHaveText("장애");
    await expect(page.getByTestId("ocr-provider-google-vision")).toContainText(
      "성공률 0.0%",
    );
  });

  test("비용을 원장별로 밝힌다 — 예산은 합해서 보되 출처를 감추지 않는다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("cost-by-source")).toContainText("LLM $0.181213");
    await expect(page.getByTestId("cost-by-source")).toContainText("OCR $0.003000");
  });
});

/**
 * 운영 전환 검증 (TASK-3401 — CTO 지시 4·5·6).
 *
 * 이 화면이 지키는 한 줄: **계약 스텁을 상대로 만든 성공 기록을 "연결됨"으로
 * 보여 주지 않는다.** 우리 라이브 검증이 실제로 스텁을 상대로 돌기 때문에,
 * 이것을 가려내지 못하면 화면은 붙지 않은 시스템을 붙었다고 보고한다.
 */
test.describe("운영 전환 검증 (TASK-3401)", () => {
  test("스텁을 상대로 성공한 기록을 연결됨으로 보여 주지 않는다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    const section = page.getByTestId("production-cutover");
    await expect(section).toContainText("운영 전환 검증");
    await expect(page.getByTestId("cutover-summary")).toContainText("0/4 확인됨");
    await expect(page.getByTestId("cutover-status-llm")).toHaveText(
      "운영의 그것이 아님",
    );
    // 왜 아닌지를 말한다 — 상태만 보여 주면 사람은 무엇을 고칠지 모른다
    await expect(page.getByTestId("cutover-llm")).toContainText(
      "운영 연결의 증거가 아닙니다",
    );
    await expect(page.getByTestId("cutover-llm")).toContainText("다음 할 일");
  });

  test("s3rver를 Amazon S3로 세지 않는다 (CTO 지시 5)", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("cutover-storage")).toContainText(
      "Amazon S3가 아닙니다",
    );
  });

  test("CI가 계속 빨간 사실을 화면이 말한다 (CTO 지시 6)", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const ci = page.getByTestId("cutover-ci");
    await expect(page.getByTestId("cutover-status-ci")).toHaveText("설정 오류");
    await expect(ci).toContainText("연속 실패");
    await expect(ci).toContainText("로컬에서만 통과하는 게이트는 게이트가 아닙니다");
  });

  test("모두 실 연결이면 전환 완료로 보여준다", async ({ page }) => {
    await setMode("cutover-done");
    await openPage(page);

    await expect(page.getByTestId("cutover-summary")).toContainText("4/4 확인됨");
    await expect(page.getByTestId("cutover-status-llm")).toHaveText("실 연결 확인");
    // 근거 없이 통과시키지 않는다
    await expect(page.getByTestId("cutover-llm")).toContainText(
      "근거: openai 실 호출 성공 12건",
    );
  });
});

/**
 * 운영 전환 UX (TASK-3501 — CTO 지시 2·6).
 *
 * 판정이 맞아도 **무엇부터 해야 하는지** 보이지 않으면 사람은 네 항목 앞에서
 * 멈춥니다. 그리고 **길이 막힌 것과 키가 틀린 것**은 화면에서도 갈라져야
 * 합니다 — 둘 다 빨간색이면 사람은 있지도 않은 키 문제를 찾습니다.
 */
test.describe("운영 전환 UX (TASK-3501)", () => {
  test("지금 할 일 하나를 크게 보여준다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const next = page.getByTestId("cutover-next");
    await expect(next).toContainText("지금 할 일");
    // 남은 것 중 첫 번째 — 넷을 나란히 두면 "그래서 뭐부터?"에서 멈춘다
    await expect(next).toContainText("LLM (실 Provider 호출)");
  });

  test("길이 막힌 것과 키가 틀린 것을 갈라 보여준다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const egress = page.getByTestId("cutover-egress");
    await expect(egress).toContainText("api.openai.com");
    await expect(egress).toContainText("닿지 못함");
    // 403은 "닿지 못함"이 아니라 "가릴 수 없음"이다 — 라이브에서 고쳤다
    // 403은 "닿지 못함"이 아니라 "가릴 수 없음"이다 (라이브에서 고쳤다)
    await expect(egress).toContainText("가릴 수 없음");
  });

  test("전환이 끝나면 할 일 안내가 사라진다", async ({ page }) => {
    await setMode("cutover-done");
    await openPage(page);

    await expect(page.getByTestId("cutover-summary")).toContainText("4/4");
    await expect(page.getByTestId("cutover-next")).toHaveCount(0);
  });
});

/**
 * 전환 대상 환경 (TASK-3501 — CTO 정책 3501-①).
 *
 * 개발에서 상시 빨간색을 띄우면 사람은 그 빨간색을 무시하게 되고, 정작
 * 운영에서 떴을 때도 무시합니다. 판정은 감추지 않되 사실만 함께 말합니다.
 */
test.describe("전환 대상 환경 (TASK-3501)", () => {
  test("개발 환경이면 전환 대상이 아니라고 말한다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    const note = page.getByTestId("cutover-not-applicable");
    await expect(note).toContainText("전환 대상이 아닙니다");
    await expect(note).toContainText("운영·Staging");
    // 대상이 아닌 환경에서는 "지금 할 일"을 재촉하지 않는다
    await expect(page.getByTestId("cutover-next")).toHaveCount(0);
  });

  test("운영 환경이면 지금 할 일을 재촉한다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("cutover-not-applicable")).toHaveCount(0);
    await expect(page.getByTestId("cutover-next")).toBeVisible();
  });
});

/**
 * 운영 활성화 세 조건 (TASK-3601 — CTO 정책 3601-①).
 *
 * 하나로 뭉친 초록불은 **무엇이 남았는지** 말하지 못하고, 둘이 충족된 상태를
 * "거의 다"로 보이게 만듭니다.
 */
test.describe("운영 활성화 조건 (TASK-3601)", () => {
  test("세 조건을 따로 보여준다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const conditions = page.getByTestId("activation-conditions");
    await expect(conditions).toBeVisible();
    await expect(page.getByTestId("activation-credentials")).toContainText(
      "자격 증명",
    );
    await expect(page.getByTestId("activation-network")).toContainText("네트워크");
    await expect(page.getByTestId("activation-cutover")).toContainText(
      "전환 판정",
    );
  });

  test("아직인 조건은 무엇이 없는지 이름으로 말한다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("activation-credentials")).toContainText(
      "OPENAI_API_KEY",
    );
    await expect(page.getByTestId("activation-network")).toContainText(
      "가릴 수 없음",
    );
  });

  test("세 조건이 모두 충족되면 전부 충족으로 보인다", async ({ page }) => {
    await setMode("cutover-done");
    await openPage(page);

    for (const id of ["credentials", "network", "cutover"]) {
      await expect(page.getByTestId(`activation-${id}`)).toContainText("충족");
    }
  });
});
