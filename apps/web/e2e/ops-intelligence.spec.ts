import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function open(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

/**
 * 운영 인텔리전스 화면 (TASK-4001, CTO 정책 4001-①②③⑥).
 *
 * 여기서 보는 것도 같습니다 — **화면이 스스로를 속이지 않는가.** 다만
 * 이번에는 시간축이 붙었습니다: 한 점으로 추세를 그리지 않는가, 기준이
 * 움직인 구간을 개선으로 읽지 않는가, 아무도 안 본 초안을 기각으로 적지
 * 않는가, 사람이 줄 것이 남았는데 준비 완료라고 말하지 않는가.
 */
test.describe("운영 인텔리전스 (TASK-4001)", () => {
  test("한 점짜리 지표는 '0% 변화'가 아니라 '낼 수 없음'이다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await open(page, "/admin/kpi");

    await expect(page.getByTestId("trend-direction-smoke")).toHaveText("낼 수 없음");
    await expect(page.getByTestId("trend-smoke")).toContainText(
      "한 점으로는 추세가 아닙니다",
    );
    await expect(page.getByTestId("trend-unknown-count")).toContainText(
      "낼 수 없음 1개",
    );
  });

  test("나빠지는 지표를 요약이 먼저 말한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/kpi");

    await expect(page.getByTestId("trend-worsening-count")).toContainText(
      "나빠지는 중 1개",
    );
    await expect(page.getByTestId("trend-direction-mttr")).toHaveText("나빠지는 중");
  });

  test("기준이 움직인 구간의 '변화 없음'을 개선으로 읽지 않게 말한다", async ({
    page,
  }) => {
    await setMode("data");
    await open(page, "/admin/kpi");

    await expect(page.getByTestId("trend-direction-incidents-open")).toHaveText(
      "변화 없음",
    );
    await expect(
      page.getByTestId("trend-threshold-changed-incidents-open"),
    ).toContainText("색의 변화를 상태의 변화로 읽지 마세요");
  });

  test("임계값 설정에 느슨해진 기준이 표시되고, 범위 밖 값은 거절 사유가 보인다", async ({
    page,
  }) => {
    await setMode("data");
    await open(page, "/admin/kpi");

    await expect(page.getByTestId("threshold-relaxed-incidents-open")).toContainText(
      "초록을 산 것입니다",
    );

    // 임계값을 없애는 값은 설정이 아니라 우회다 — 화면이 그 거절을 삼키지 않는다
    const input = page.getByTestId("threshold-input-mttr-watch");
    await input.fill("99999");
    await input.blur();
    await expect(page.getByTestId("threshold-error")).toContainText(
      "임계값을 없앤 것",
    );
  });

  test("임계값 변경 이력이 느슨해진 변경과 판정 불가를 가른다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/kpi");

    const items = page.getByTestId("setting-history-item");
    await expect(items.first()).toContainText("진행 중인 장애 정상 경계");
    await expect(page.getByTestId("setting-history-relaxed").first()).toContainText(
      "느슨해짐",
    );
    // 판정할 수 없는 것을 "엄격해짐"으로 적지 않는다
    await expect(items.nth(1)).toContainText("방향을 판정할 수 없음");
  });

  test("검증 준비는 사람이 줄 것이 남으면 시작할 수 있다고 말하지 않는다", async ({
    page,
  }) => {
    test.slow();
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("validation-readiness")).toHaveText(
      "사람이 줄 것이 남았습니다",
    );
    await expect(page.getByTestId("validation-plan")).toContainText(
      "코드로 해결되지 않습니다",
    );
    await expect(page.getByTestId("validation-owner-credentials")).toHaveText(
      "사람이 줘야 함",
    );
    // 앞 단계에 막힌 것을 "안 한 것"으로도, "우리 쪽에 남은 일"로도 적지 않는다
    await expect(page.getByTestId("validation-status-smoke")).toHaveText(
      "앞 단계에 막힘",
    );
    await expect(page.getByTestId("validation-blocked-count")).toContainText(
      "앞 단계에 막힘 1건",
    );
    await expect(page.getByTestId("validation-plan")).toContainText(
      "우리가 부지런해져서 풀리지 않습니다",
    );
  });

  test("진단은 모르는 것을 통과로 세지 않고 서비스를 막지도 않는다", async ({
    page,
  }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("diagnostic-status-migrations")).toHaveText(
      "확인 못 함",
    );
    await expect(page.getByTestId("diagnostics-unknown-count")).toContainText(
      "확인 못 함 1건",
    );
    await expect(page.getByTestId("diagnostics-section")).toContainText(
      "서비스는 계속 뜹니다",
    );
    // 긴급 경로 미구성은 진단 대상이다 (정책 4001-④)
    await expect(page.getByTestId("diagnostic-status-urgent-channel")).toHaveText(
      "주의",
    );
  });

  test("만료된 초안을 기각으로 적지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("draft-stale-count")).toContainText(
      "확인 대기 1건",
    );
    await expect(page.getByTestId("draft-lifecycle")).toContainText(
      "만료는 기각이 아닙니다",
    );
    await expect(page.getByTestId("draft-expired")).toContainText("기각이 아닙니다");
  });
});
