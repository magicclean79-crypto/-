#!/usr/bin/env node
/**
 * Image Studio 회귀 방지 스모크 테스트 (T1-114, 확장 T1-119).
 *
 * 이 스크립트가 "기능 하나 추가할 때마다 다른 기능이 깨진다"는 문제에
 * 대한 공식 회귀 게이트다 — Image Studio를 고치는 모든 작업은 완료로
 * 보고하기 전에 이 스크립트를 통과시켜야 한다(`AGENTS.md` §"Image
 * Studio 변경 시 회귀 게이트", `docs/operations/image-studio-regression.md`).
 *
 * Gemini/LLM 실 호출(과금)은 절대 하지 않는다 — 화면 로드·이미지 조회·
 * DESIGN/INFO 분류·선택·Product Profile 조회·Product Story 준비 확인
 * (GET)·최종 상세페이지 조회(GET)·API 응답 계약(구조)·오류 원인 구분
 * (404/network 등)까지만 확인한다. "생성"·"실행" 버튼은 누르지 않는다.
 * 실 Gemini/OpenAI 호출이 필요한 "품질" 검증은 이 스크립트의 범위가
 * 아니다 — `scripts/real-provider-smoke.mjs`(과금 발생, 운영/스테이징
 * 대상)가 그 역할을 맡는다. 회귀 테스트(무료)와 품질 테스트(과금)를
 * 절대 섞지 않는다.
 *
 * 전제: scripts/start-verify-studio.ps1 로 띄운 로컬 API(4100)·
 * Web(3100)이 이미 떠 있어야 한다 — 이 스크립트가 서버를 대신 띄우지
 * 않는다(이 프로젝트가 관리하는 서비스가 아니다, 기존 real-provider-
 * smoke.mjs와 같은 원칙).
 *
 * 사용법:
 *   node scripts/check-image-studio-smoke.mjs
 *   API_URL=http://localhost:4100 WEB_URL=http://localhost:3100 node scripts/check-image-studio-smoke.mjs
 *
 * 판정: 모든 단계 통과 시 exit 0, 하나라도 실패하면 exit 1.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const API_URL = process.env.API_URL ?? "http://localhost:4100";
const WEB_URL = process.env.WEB_URL ?? "http://localhost:3100";

// Benchmark 사진 7장 (apps/web/app/benchmark/constants.ts 와 동일 — 이
// 스크립트는 그 파일을 import하지 않는다, 웹 워크스페이스 밖에서 실행되는
// 순수 node 스크립트이기 때문. 값이 바뀌면(사람 승인 필요) 여기도 함께
// 갱신해야 한다.
const BENCHMARK_IMAGE_IDS = [
  "cmskd3e590004ulpw8fatga47",
  "cmskd3e590006ulpwmcosfdsq",
  "cmskd3e590008ulpw58jfbdkv",
  "cmskd3e59000aulpwd4qx4l9t",
  "cmskd3e59000culpwcshzjvyj",
  "cmskd3e5a000eulpwtqed80ld",
  "cmskd3e5a000gulpwu7prd9m6",
];

const results = [];
let failed = false;

function report(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${step}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

async function main() {
  // 0. 전제 서버 확인
  let apiHealthy;
  try {
    const r = await fetch(`${API_URL}/health`);
    apiHealthy = r.ok;
  } catch {
    apiHealthy = false;
  }
  report("API /health 응답", apiHealthy, `${API_URL}/health`);
  if (!apiHealthy) {
    console.error(
      "\nAPI가 응답하지 않습니다 — 먼저 scripts\\start-verify-studio.ps1 을 실행하세요.",
    );
    process.exit(1);
  }

  // 1. API 계약 — 이미지 원본 바이트 (7장 전부)
  for (const id of BENCHMARK_IMAGE_IDS) {
    let ok;
    let detail;
    try {
      const r = await fetch(`${API_URL}/uploads/images/${id}/file`, {
        headers: { Origin: WEB_URL },
      });
      const cors = r.headers.get("access-control-allow-origin");
      ok = r.ok && cors === WEB_URL;
      detail = `HTTP ${r.status}, CORS origin=${cors ?? "(none)"}`;
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
    report(`GET /uploads/images/${id}/file`, ok, detail);
  }

  // 2. API 계약 — DESIGN/INFO 분류 (photoType)
  let photoTypes = new Map();
  try {
    const r = await fetch(
      `${API_URL}/image-gen/images?ids=${BENCHMARK_IMAGE_IDS.join(",")}`,
    );
    const body = await r.json();
    for (const item of body.results ?? []) {
      photoTypes.set(item.id, item.photoType);
    }
    const designCount = [...photoTypes.values()].filter((t) => t === "DESIGN").length;
    const infoCount = [...photoTypes.values()].filter((t) => t === "INFO").length;
    report(
      "GET /image-gen/images — DESIGN/INFO 분류 응답",
      r.ok && photoTypes.size === BENCHMARK_IMAGE_IDS.length,
      `${photoTypes.size}건 응답, DESIGN ${designCount} / INFO ${infoCount}`,
    );
  } catch (err) {
    report(
      "GET /image-gen/images — DESIGN/INFO 분류 응답",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 3. Product Profile 조회 (이 벤치마크 사진들을 포함하는 최근 실행)
  let profileId = null;
  try {
    const r = await fetch(`${API_URL}/product-profile?take=100`);
    const body = await r.json();
    const profile = (body.results ?? []).find((p) =>
      (p.imageIds ?? []).includes(BENCHMARK_IMAGE_IDS[0]),
    );
    profileId = profile?.id ?? null;
    report(
      "GET /product-profile — Benchmark Product Profile 존재",
      Boolean(profile && profile.status === "SUCCESS"),
      profile ? `id=${profile.id}, status=${profile.status}` : "찾지 못함",
    );
  } catch (err) {
    report(
      "GET /product-profile — Benchmark Product Profile 존재",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 4. 최종 상세페이지 조회 (LLM 재호출 없음 — 기존 결과 재조립)
  if (profileId) {
    try {
      const r = await fetch(`${API_URL}/product-profile/${profileId}/final`);
      const body = await r.json();
      report(
        "GET /product-profile/:id/final",
        r.ok,
        `HTTP ${r.status}, imageSource=${body.imageSource ?? "?"}`,
      );
    } catch (err) {
      report(
        "GET /product-profile/:id/final",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
    try {
      const r = await fetch(`${API_URL}/product-profile/${profileId}/final-html`);
      report("GET /product-profile/:id/final-html", r.ok, `HTTP ${r.status}`);
    } catch (err) {
      report(
        "GET /product-profile/:id/final-html",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    report("GET /product-profile/:id/final(-html)", false, "profileId 없음 — 건너뜀");
  }

  // 4-1. 후보 이미지 계약 검사 — GenerateImageCandidatesResult/ImageDto
  //      필드가 실제로 있는지(구조 드리프트 검출, T1-119). FE와 API가
  //      같은 @acos/shared 타입을 참조하므로 pnpm turbo run typecheck가
  //      1차 방어선이고, 여기서는 "타입은 맞아도 실제 응답에 값이
  //      비어 있지 않은지"를 런타임으로 한 번 더 본다.
  try {
    const r = await fetch(
      `${API_URL}/image-gen/candidates?sourceImageId=${BENCHMARK_IMAGE_IDS[0]}&category=HERO`,
    );
    const body = await r.json();
    const results = body.results ?? [];
    const first = results[0];
    const hasExpectedShape =
      r.ok &&
      Array.isArray(results) &&
      (results.length === 0 ||
        (typeof first.id === "string" &&
          typeof first.category === "string" &&
          "photoType" in first &&
          "selected" in first));
    report(
      "계약 — GET /image-gen/candidates 응답이 ImageDto 형태",
      hasExpectedShape,
      `HTTP ${r.status}, ${results.length}건`,
    );
  } catch (err) {
    report(
      "계약 — GET /image-gen/candidates 응답이 ImageDto 형태",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 4-2. 오류 원인 구분 — 존재하지 않는 리소스는 5xx가 아니라 404, 정상
  //      JSON 오류 본문(message)으로 응답해야 화면이 "Failed to fetch"가
  //      아니라 원인별 메시지를 보여줄 수 있다 (요청 #9).
  try {
    const r = await fetch(`${API_URL}/product-profile/does-not-exist-xyz`);
    let body = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    report(
      "오류 구분 — 존재하지 않는 Product Profile 조회는 404 + JSON 오류 본문",
      r.status === 404 && body !== null,
      `HTTP ${r.status}, body=${body ? "JSON 있음" : "파싱 실패"}`,
    );
  } catch (err) {
    report(
      "오류 구분 — 존재하지 않는 Product Profile 조회는 404 + JSON 오류 본문",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    const r = await fetch(`${API_URL}/uploads/images/does-not-exist-xyz/file`);
    report(
      "오류 구분 — 존재하지 않는 이미지 조회는 5xx가 아닌 4xx",
      r.status >= 400 && r.status < 500,
      `HTTP ${r.status}`,
    );
  } catch (err) {
    report(
      "오류 구분 — 존재하지 않는 이미지 조회는 5xx가 아닌 4xx",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 5. 브라우저 — 실제 화면에서 이미지 로딩·선택·Product Story 연결 확인
  //    (@playwright/test는 apps/web에만 설치돼 있다)
  let chromium;
  try {
    ({ chromium } = require(
      path.join(__dirname, "..", "apps", "web", "node_modules", "@playwright", "test"),
    ));
  } catch (err) {
    report(
      "브라우저 확인 (Playwright)",
      false,
      `@playwright/test를 불러오지 못함 — ${err instanceof Error ? err.message : String(err)}`,
    );
    chromium = null;
  }

  if (chromium) {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const consoleErrors = [];
      page.on("pageerror", (err) => consoleErrors.push(err.message));

      await page.goto(`${WEB_URL}/image-studio`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });

      // 5-1. 7장 전부 "불러오기 실패" 없이 로드됐는가
      await page.waitForTimeout(2000);
      const failedCount = await page.locator("text=불러오기 실패").count();
      report(
        "화면 — Benchmark 참조 사진 7장 '불러오기 실패' 없음",
        failedCount === 0,
        `실패 표시 ${failedCount}건`,
      );

      // 5-2. DESIGN/INFO 버튼 분리 — disabled(INFO) 개수가 photoType과 일치
      const disabledCount = await page
        .locator('button[aria-label="상품 분석 전용 · 이미지 생성에 사용할 수 없음"]')
        .count();
      const infoExpected = [...photoTypes.values()].filter((t) => t === "INFO").length;
      report(
        "화면 — INFO 사진은 선택 버튼이 비활성화됨",
        disabledCount === infoExpected,
        `disabled ${disabledCount}건 (기대값 ${infoExpected})`,
      );

      // 5-3. 첫 DESIGN 사진 체크 표시 확인 (기본 선택)
      const checkedBadge = await page.locator("text=✓").count();
      report("화면 — 기본 선택된 DESIGN 사진에 체크 표시", checkedBadge > 0, `체크 표시 ${checkedBadge}건`);

      // 5-4. Product Story 패널 — 준비 확인(GET, 무료)까지만
      const storyButton = page.getByRole("button", { name: "Product Story 준비 확인" });
      if (await storyButton.count()) {
        await storyButton.click();
        await page.waitForTimeout(2000);
        const failedToFetch = await page.locator("text=Failed to fetch").count();
        const genericError = await page.locator("text=제품 정보 조회 실패").count();
        report(
          "화면 — Product Story 준비 확인이 'Failed to fetch' 없이 응답",
          failedToFetch === 0 && genericError === 0,
          `Failed to fetch ${failedToFetch}건, 제품 정보 조회 실패 ${genericError}건`,
        );
      } else {
        report("화면 — Product Story 준비 확인 버튼 존재", false, "버튼을 찾지 못함");
      }

      // 5-5. ④-A 참조 이미지 선택 확인(GET, 무료) — T1-131부터 최종 HTML을
      // 만들지 않고 준비 상태만 확인한다(detail-page-panel.tsx 재정의).
      const detailButton = page.getByRole("button", { name: "선택 상태 확인" });
      if (await detailButton.count()) {
        await detailButton.click();
        await page.waitForTimeout(2000);
        const detailFailed = await page.locator("text=준비 상태 확인 실패").count();
        report(
          "화면 — ④-A 참조 이미지 선택 확인이 오류 없이 응답",
          detailFailed === 0,
          `오류 표시 ${detailFailed}건`,
        );
      } else {
        report("화면 — ④-A 선택 상태 확인 버튼 존재", false, "버튼을 찾지 못함");
      }

      report(
        "화면 — 처리되지 않은 자바스크립트 오류 없음",
        consoleErrors.length === 0,
        consoleErrors.join(" | ") || "없음",
      );
    } finally {
      await browser.close();
    }
  }

  console.log("");
  console.log(`요약: ${results.filter((r) => r.ok).length}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("스모크 테스트 실행 중 예외:", err);
  process.exit(1);
});
