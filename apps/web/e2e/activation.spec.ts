import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function openPage(page: import("@playwright/test").Page) {
  await page.goto("/admin/activation");
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

/**
 * 운영 활성화 대시보드 (TASK-3701, CTO 정책 3701-③).
 *
 * 여기서 보는 것은 "예쁘게 나오는가"가 아니다. 이 화면이 하지 말아야 할
 * 일을 하지 않는지를 본다 — **스텁의 200을 통과로 보여 주지 않는가**,
 * **되돌아간 것을 말하는가**, **안 본 구간을 유지됐다고 하지 않는가**,
 * **복구된 것이 없을 때 평균을 0으로 적지 않는가**.
 */
test.describe("운영 활성화 대시보드 (TASK-3701)", () => {
  test("지금·과정·증거·장애를 한 화면에 보여준다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await openPage(page);

    // 1. 지금 — 세 조건
    await expect(page.getByTestId("activation-verdict")).toContainText(
      "아직 활성화 아님",
    );
    await expect(page.getByTestId("condition-credentials")).toContainText("아직");
    await expect(page.getByTestId("condition-network")).toContainText(
      "가릴 수 없음",
    );

    // 2. 과정 — 되돌아간 것을 붉게 말한다
    await expect(page.getByTestId("history-regression").first()).toContainText(
      "되돌아감",
    );
    await expect(page.getByTestId("activation-history")).toContainText(
      "되돌아간 적 1회",
    );

    // 3. 증거 — 스모크
    await expect(page.getByTestId("smoke-results")).toBeVisible();

    // 4. 장애
    await expect(page.getByTestId("incident-list")).toContainText(
      "OpenAI 호출 전량 실패",
    );
  });

  test("스텁을 상대로 성공한 호출을 '통과'로 보여 주지 않는다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    // 이 한 줄이 TASK-3401에서 실제로 겪은 사고를 막는다 —
    // 화면이 스텁 응답을 근거로 "연결됨"이라고 말했던 그 사고다
    await expect(page.getByTestId("smoke-status-llm")).toContainText(
      "스텁 응답 — 통과 아님",
    );
    await expect(page.getByTestId("smoke-llm")).toContainText(
      "공식 주소가 아닙니다",
    );
    // 실패는 실패로
    await expect(page.getByTestId("smoke-status-ocr")).toContainText("실패");
    // 셋 중 하나만 통과했으므로 "거의 다"가 아니다
    await expect(page.getByTestId("smoke-section")).toContainText("1/3 통과");
  });

  test("마지막 확인 이후 구간을 '유지됐다'로 보여 주지 않는다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await expect(page.getByTestId("history-unobserved").first()).toContainText(
      "아무도 보지 않았습니다",
    );
  });

  test("진행 중인 장애를 먼저·붉게 보여 주고, 복구 기록 자리를 남긴다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    const first = page.getByTestId("incident-item").first();
    await expect(first).toContainText("진행 중");
    await expect(page.getByTestId("resolve-inc-open")).toBeVisible();
    // 원인이 없는 진행 중 장애를 "원인 없음"으로 단정하지 않는다
    await expect(first).toContainText("알아챈 시각 기록 없음");
  });

  test("기록이 없으면 '없다'가 아니라 '모른다'로 말한다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("history-empty")).toContainText(
      "아직 판정한 적이 없다",
    );
    await expect(page.getByTestId("incident-empty")).toContainText(
      "아무도 적지 않았다는 뜻일 수도",
    );
    // 복구된 장애가 없으면 평균은 0분이 아니라 "낼 수 없음"이다
    await expect(page.getByTestId("incident-section")).toContainText(
      "평균 복구 낼 수 없음",
    );
    // 한 번도 안 돌린 스모크는 3칸이 모두 자리를 지킨다 (0/3, ok 아님)
    await expect(page.getByTestId("smoke-section")).toContainText("0/3 통과");
    await expect(page.getByTestId("smoke-section")).toContainText(
      "한 번도 돌린 적이 없습니다",
    );
  });

  test("ADMIN이 아니면 판정을 보여 주지 않는다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/activation");

    await expect(page.getByTestId("activation-error")).toContainText(
      "ADMIN 로그인이 필요합니다",
    );
  });
});
