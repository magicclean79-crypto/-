import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function openPage(page: import("@playwright/test").Page) {
  await page.goto("/admin/costs");
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

/** 제안 등록 (OCR 단가) */
async function propose(
  page: import("@playwright/test").Page,
  reason: string,
  perUnit = "0.002",
) {
  await page.getByTestId("pricing-per-unit").fill(perUnit);
  await page.getByTestId("pricing-reason").fill(reason);
  await page.getByTestId("pricing-propose").click();
}

test.describe("AI 비용 관리 (TASK-3101)", () => {
  test("가격표·예측·리포트를 한 화면에서 성격까지 함께 보여준다", async ({
    page,
  }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await openPage(page);

    // 실효 가격표 — 지금 계산에 쓰는 단가와 그 출처
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "OCR google-vision",
    );
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "단위당 $0.0015",
    );
    // 승인된 단가와 코드 기본값은 화면에서 구분된다
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "코드 기본값 — 승인 이력이 없습니다",
    );
    await expect(page.getByTestId("pricing-board")).toContainText(
      "과거 비용 기록은 바뀌지 않습니다",
    );

    // 예측은 참고자료다 (정책 3101-③)
    const forecast = page.getByTestId("cost-forecast");
    await expect(forecast).toContainText("참고자료");
    await expect(forecast).toContainText("예산 차단은 실제 비용만 사용합니다");
    await expect(forecast).toContainText("$62.000000");

    // 리포트는 운영 지표다 (정책 3101-④)
    await expect(page.getByTestId("billing-report")).toContainText("운영 지표");
    await expect(page.getByTestId("billing-disclaimer")).toContainText(
      "회계 청구서를 대체하지 않습니다",
    );
    await expect(page.getByTestId("billing-rows")).toContainText("gpt-4o");
    // 미산정은 숨기지 않는다 — 총액이 실제보다 작다는 뜻이다
    await expect(page.getByTestId("billing-rows")).toContainText("미산정 1");
  });

  test("검토 없이 승인할 수 없다 — 거절 사유를 화면이 그대로 말한다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await propose(page, "2026-07 단가 공지 반영");
    const open = page.getByTestId("open-proposals");
    await expect(open).toContainText("작성됨");
    await expect(open).toContainText("단위당 $0.0015 → 단위당 $0.002");
    // DRAFT에서 누를 수 있는 것은 "검토 완료"뿐이다 (승인 버튼이 없다)
    await expect(open.getByRole("button", { name: "검토 완료" })).toBeVisible();
    await expect(open.getByRole("button", { name: "승인" })).toHaveCount(0);
  });

  test("검토 → 승인 → 적용을 거치면 실효 가격표가 바뀐다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await propose(page, "2026-07 단가 공지 반영");
    await page.getByRole("button", { name: "검토 완료" }).click();
    await expect(page.getByTestId("open-proposals")).toContainText("검토됨");

    await page.getByRole("button", { name: "승인" }).click();
    // 제안자와 승인자가 같은 사실은 남기되 막지 않는다
    await expect(page.getByTestId("self-approval-warning")).toContainText(
      "제안자와 승인자가 같습니다",
    );

    await page.getByRole("button", { name: "적용" }).click();
    await expect(page.getByTestId("costs-note")).toContainText(
      "과거 비용 기록은 바뀌지 않습니다",
    );
    // 적용 뒤에야 계산에 쓰인다 — 그 사실과 출처가 함께 남는다
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "단위당 $0.002",
    );
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "승인된 제안으로 적용됨",
    );
    await expect(page.getByTestId("closed-proposals")).toContainText("적용됨");
  });

  test("사유 없는 제안은 등록되지 않고 이유가 보인다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await page.getByTestId("pricing-per-unit").fill("0.002");
    await page.getByTestId("pricing-propose").click();
    await expect(page.getByTestId("costs-error")).toContainText("변경 사유");
  });

  test("표본이 적으면 숫자를 만들지 않고, 모른다고 말한다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    const forecast = page.getByTestId("cost-forecast");
    await expect(forecast).toContainText("표본 부족");
    await expect(forecast).toContainText("최소 3일이 필요합니다");
    // 예상은 비우고 실제 지출은 그대로 말한다
    await expect(forecast).toContainText("미산정");
    await expect(forecast).toContainText("$3.000000");
    await expect(forecast).toContainText("추정도 실제보다 작을 수 있습니다");
  });

  test("빈 기간에도 면책 문구는 남는다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("billing-report")).toContainText(
      "집계된 호출이 없습니다",
    );
    await expect(page.getByTestId("billing-disclaimer")).toContainText(
      "회계 청구서를 대체하지 않습니다",
    );
  });

  test("ADMIN 전용이다 — 단가는 돈의 기준이다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/costs");
    await expect(page.getByTestId("costs-error")).toContainText(
      "ADMIN 권한이 필요합니다",
    );
  });
});
