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

    await expect(page.getByTestId("schedule-alert-archive")).toContainText(
      "매일 04:00 UTC",
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
