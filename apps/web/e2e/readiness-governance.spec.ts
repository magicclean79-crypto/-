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
 * 운영 준비 화면 · 트래픽 관측 · 방치 무시 (TASK-4301, CTO 정책 4301-①③④).
 *
 * 이번에 화면이 지켜야 하는 것: **관측을 허가로 보여 주지 않는가**,
 * **무시를 해결처럼 보여 주지 않는가**, 그리고 **대시보드가 스스로 판정하지
 * 않는가**.
 */
test.describe("운영 준비 상태 (TASK-4301)", () => {
  test("여섯 판정을 모으고 각 칸이 출처를 달고 있다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await open(page, "/admin/readiness");

    await expect(page.getByTestId("readiness-steps")).toHaveText("2/11 단계");
    await expect(page.getByTestId("tile-source-validation-plan")).toHaveText(
      "GET /ops/validation-plan",
    );
    await expect(page.getByTestId("readiness-summary")).toContainText("인용만 합니다");
  });

  /**
   * unknown이 ok 옆에서 조용하면, 모르는 항목이 많은 환경이 건강해 보인다.
   */
  test("확인하지 못한 칸을 통과로 보여 주지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/readiness");

    await expect(page.getByTestId("tile-status-diagnostics")).toHaveText("확인 못 함");
    await expect(page.getByTestId("tile-diagnostics")).toContainText(
      "괜찮다는 뜻이 아닙니다",
    );
  });

  test("막힌 것은 강제로 열 수 없다고 말한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/readiness");

    await expect(page.getByTestId("tile-status-validation-run")).toHaveText("막힘");
    await expect(page.getByTestId("tile-next-validation-run")).toContainText(
      "강제로 여는 방법은 없습니다",
    );
  });

  /**
   * Host 헤더는 요청하는 쪽이 적는 값이다 — 자동 등록 버튼을 두면 바깥에서
   * 우리 보호 목록에 글을 쓰는 것이 된다.
   */
  test("트래픽에서 본 호스트를 보여 주되 목록에 넣는 버튼은 없다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("sighting-m.acos.example")).toContainText("요청 812건");
    await expect(page.getByTestId("host-discovery")).toContainText(
      "관측은 증거이지 허가가 아닙니다",
    );
    await expect(page.getByTestId("host-discovery").getByRole("button")).toHaveCount(0);
  });

  /**
   * 빼서 말하면 무시를 늘리는 것만으로 지표가 좋아진다 — 지표를 고친 것이
   * 아니라 눈을 가린 것이다.
   */
  test("무시 중인 항목도 목록에 남고 건수에서 빠지지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("streak-storage")).toContainText("23일째");
    await expect(page.getByTestId("streak-ignore-storage")).toContainText("무시 중");
    await expect(page.getByTestId("neglect-ignored")).toContainText("빼지 않음");
    await expect(page.getByTestId("streak-ignore-reason-storage")).toContainText(
      "다음 분기 계획",
    );
  });

  /**
   * 등록만 되고 취소가 화면에 없으면, 잘못 적은 무시가 검토일까지 그대로
   * 남는다 (라이브 검증에서 고침).
   */
  test("무시 중인 항목은 화면에서 취소할 수 있고 기록은 남는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await page.getByTestId("ignore-revoke-storage").click();
    await expect(page.getByTestId("ignore-notice")).toContainText(
      "다시 경보 대상입니다",
    );
  });

  test("사유가 짧으면 무시를 받아 주지 않고 이유를 말한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await page.getByTestId("ignore-open-urgent-channel").click();
    await page.getByTestId("ignore-owner").fill("김운영");
    await page.getByTestId("ignore-reason").fill("나중에");
    await page.getByTestId("ignore-submit").click();

    await expect(page.getByTestId("ignore-notice")).toContainText("10자 이상");
  });

  test("무시해도 해결이 아니라고 화면이 먼저 말한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await page.getByTestId("ignore-open-urgent-channel").click();
    await expect(page.getByTestId("ignore-form-urgent-channel")).toContainText(
      "연속 기간도 계속 갑니다",
    );
    await expect(page.getByTestId("ignore-form-urgent-channel")).toContainText(
      "자동으로 풀리고",
    );
  });

  /**
   * 전체 창만 보면 배선을 고친 것이 보이지 않고, 최근 창만 보면 청구서가
   * 틀렸다는 사실이 가려진다.
   */
  test("지금 들어오는 기록의 귀속률과 전체 귀속률을 함께 보여 준다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("cost-coverage")).toContainText("귀속률 40%");
    await expect(page.getByTestId("cost-recent-coverage")).toContainText(
      "지금 들어오는 기록 100%",
    );
  });
});
