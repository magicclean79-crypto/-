# PROJECT STATE — 현재 프로젝트 상태

> **이 문서는 "지금 어디까지 했는가"에 답합니다.**
>
> 세션이 끝나기 전에 **반드시 갱신합니다.** 갱신하지 않으면 다음 세션이
> 처음부터 다시 헤맵니다.
>
> 확인한 사실만 적습니다. 추측은 적지 않습니다.

**마지막 업데이트: 2026-08-09**

---

## 1. 현재 Sprint

**Sprint 1 — GPT → Product Package → Gemini 파이프라인**

```
GPT → Product Profile → Product Package → Gemini → 브라우저 검증 → 사람 승인
```

**목표**: Gemini가 GPT가 분석한 제품 정보를 정확히 전달받아 이미지를 생성하고,
사람이 브라우저에서 그 결과를 검증할 수 있는 상태를 만드는 것.

**범위 밖**: Claude 연동, 상세페이지 생성, 디자인 엔진, Learning History
(전부 Sprint 2 이후)

---

## 2. 진행률

| 항목 | 상태 |
| --- | --- |
| Product Package 자료구조 | ✅ 완료 |
| 모든 Gemini 경로에 Package 적용 | ✅ 완료 |
| 글자 렌더링 금지 규칙 | ✅ 완료 |
| **제품 동일성 최우선 규칙** | ✅ 완료 |
| **한국인 모델 규칙** | ✅ 완료 |
| **원본 사진 함께 전송** | ✅ 완료 |
| OCR 실행 → Product Package 정확도 개선 | ✅ 완료 |
| 브라우저 검증 화면 (8개 항목) | ✅ 완료 |
| 로컬 Benchmark Dataset 구축 | ✅ 완료 |
| **T1-21 제품 자동 분석** | ✅ 완료 (바코드·모델명·브랜드·원산지·URL) |
| **상품명/품명 혼선 제거** | ✅ 완료 |
| **프롬프트 중복 제거** | ✅ 완료 |
| **T1-22 제품 자동 조사** | ✅ 완료 (2026-08-09 검증) |
| **T1-23 교차 검증** | ✅ 완료 (OCR·GPT 분석 충돌 시 자동으로 채우지 않음) |
| **T1-24 Product Profile 생성** | ✅ 완료 (STEP 5는 교차 검증된 brand/model만 사용, 2026-08-09) |
| **T1-25 Product Package 생성** | ✅ 완료 (T1-21·T1-22·T1-23 결과를 하나로 통합, 재검증 2026-08-09) |
| **사람의 최종 품질 승인** | ⏳ **대기 중** |

**T1-21·T1-22·T1-23·T1-24·T1-25 완료. 지금은 사람의 품질 승인 대기 중입니다.**

## 3-2. T1-23 교차 검증 구현 (2026-08-09)

`packages/core/src/product-profile/cross-verification.ts` 신규 —
OCR 직접 추출(T1-21, `ProductIdentification`)과 GPT 분석
(`ProductProfile`)을 항목별(브랜드·모델)로 비교하는 순수 함수.

- 값을 가진 출처가 하나뿐이면 그 값을 그대로 쓴다(`single-source`).
- 둘 이상의 출처가 같은 값을 말하면 확정한다(`agreed`).
- 둘 이상의 출처가 다른 값을 말하면 **`resolvedValue`를 null로 두고 채우지
  않는다**(`conflict`) — 어느 쪽이 맞는지는 사람만 판단할 수 있다.
- 공식 정보(웹 조사, T1-22)는 아직 없어 `officialInfo` 입력 자리만 열어
  뒀다. T1-22가 만들어지면 자동으로 비교에 포함된다.

`buildProductPackage`의 브랜드·모델 필드가 이 결과를 쓰도록 바꿨다.
**이전에는 충돌해도 조용히 OCR 값으로 덮어썼다** — 충돌 자체가 드러나지
않았다. 브라우저 화면(`apps/web/app/image-studio/category-panel.tsx`)에
"교차 검증 결과" 블록을 추가해 항목별 상태(단일 출처/일치/충돌/미확인)를
사람이 볼 수 있게 했다.

**작업 중 확인한 사실**: 같은 작업 트리에서 T1-22(제품 자동 조사,
`packages/core/src/product-profile/product-research.ts` ·
`apps/api/src/product-research/`)가 동시에 진행되고 있었다 — 이 세션이
시작한 것이 아니다. 두 작업은 겹치지 않아 충돌 없이 병합됐다.

**테스트**: `@acos/core` 130개 스위트 전부 통과(1879 tests). `pnpm build` ·
`pnpm typecheck`(10/10) 통과. `pnpm lint`는 저장소 전체 기준 5건 실패이나
**이번 변경분(cross-verification.ts·product-package.ts·category-panel.tsx
등)은 0건** — 나머지 5건은 기존 문제 3건(§10 기록된 react-hooks 규칙
누락) + 동시 진행 중인 T1-22 관련 파일 2건(`noop-web-research.provider.ts`
미사용 변수, `benchmark-view.tsx`는 git diff 없음 확인 — 이번 변경 이전부터
있던 문제)이다. `apps/api` 테스트는 1015/1023 통과 — 실패 8건은
`ops.spec.ts`로 §10에 기록된 기존 문제와 정확히 같은 개수다. `web` e2e는
로컬 3100 포트에 이미 dev 서버가 떠 있어(§4-14와 같은 이유) 실행되지
못했다 — 코드 문제가 아니다.

**브라우저에서 실제로 확인하지 않았다.** 새 "교차 검증 결과" 블록이
실제로 값을 채우려면 이미지 생성(유료 Gemini/OpenAI 호출)이 한 번
필요한데, `docs/PROJECT_MEMORY.md`의 "API 비용 최소화" 제약에 따라
이번에는 호출하지 않았다. 로컬 유닛 테스트로 로직은 확인했지만,
**화면에 실제로 어떻게 보이는지는 사람이 확인해야 한다.**

## 3-4. T1-24 Product Profile 생성 — 교차 검증된 정보만 사용 (2026-08-09)

`packages/core/src/product-profile/product-profile-engine.ts` — STEP 4(GPT
통합)가 답한 `profile`은 가공하지 않고 그대로 보존한다(사실과 평가를
구분한다, MASTER_GUIDE §2 철학 4). 그 직후 OCR 직접 추출(T1-21)과 다시
교차 검증(T1-23)해, STEP 5(카피 생성·HTML 렌더링)에는 **검증된 brand/model
만** 넘긴다 — 충돌이면 null이 되어 HTML 스펙 표에 그 항목 자체가 나타나지
않는다. 엔진 실행 결과에 `identification`·`crossVerification`을 추가해
투명하게 드러낸다.

`apps/api/src/product-profile/product-profile.service.ts`의 `toDto()`가
저장된 `ocrText`·`profile`으로 `identification`·`crossVerification`을 매
조회마다 다시 계산해 API 응답(`ProductProfileDto`)에 포함한다. 둘 다 순수
함수라 항상 같은 입력에 같은 결과이므로, 이 변경 이전에 만들어진 실행
기록에도 그대로 적용된다 — 별도 DB 컬럼이나 마이그레이션이 필요 없다.
브라우저(`apps/web/app/product-profile/product-profile-flow.tsx`)에 "교차
검증 결과" 카드를 추가해 사람이 충돌 여부를 직접 볼 수 있게 했다.

**DB 마이그레이션을 포기한 경위**: 처음에는 이 두 값을 `ProductProfile`
테이블에 컬럼으로 저장하려고 스키마를 고치고 `prisma migrate dev`를
실행했으나, **작업 도중 C 드라이브 여유 공간이 0바이트가 되어**(`Get-PSDrive
C`로 반복 확인, `PROJECT_MEMORY` M-15와 같은 종류의 문제) shadow DB 생성이
실패했다. 컬럼 없이 매번 다시 계산하는 방식으로 설계를 바꿔 마이그레이션
자체가 필요 없게 만들었다 — 디스크 문제를 임시로 피한 것이 아니라, 더
단순하고 컬럼이 필요 없는 설계가 가능함을 확인한 것이다. `apps/api/prisma/
schema.prisma`에는 주석 한 줄 수정 외에 실질적인 변경이 없다.

**`buildProductPackage`(`packages/core/src/product-profile/
product-package.ts`)는 의도적으로 건드리지 않았다.** 이 세션 도중 그
파일이 다른 동시 진행 Bridge 작업(`node bridge/bridge-cli.mjs status`로
확인 — T1-25 "Product Package 생성"이 이 시각 `IN_PROGRESS`였다)에 의해
실시간으로 계속 수정되고 있는 것을 발견했다(`research` 필드가 함수
시그니처에 추가되는 것을 직접 목격 — `PROJECT_MEMORY` M-19·M-23과 같은
동시 실행 위험). 같은 파일을 함께 고치면 충돌 위험이 컸다. `profile`을
가공하지 않고 그대로 반환하도록 설계했기 때문에, `buildProductPackage`가
독립적으로 다시 계산하는 기존 로직과도 값이 어긋나지 않는다.

**남아 있는 일**: T1-22(웹 조사) 결과를 교차 검증의 `officialInfo`
입력 자리에 실제로 연결하는 것은 이번에도 하지 않았다. `ResearchFinding`
(T1-22 산출물)은 URL·스니펫만 있고 "이게 브랜드 값이다"처럼 구조화된
필드가 없다 — 스니펫에서 값을 정규식으로 뽑아내는 것 자체가 추측이 되어
버린다(`product-package.ts`에 다른 세션이 남긴 것으로 보이는 동일한
취지의 주석도 있었다). 이 연결은 스니펫을 사람이 읽고 판단하게 하거나,
구조화된 조사 결과를 만드는 별도 작업이 먼저 필요하다.

**검증**: `@acos/core` 130개 스위트 전부 통과(1884 tests, 신규 2건 포함).
`pnpm typecheck` 10/10, 오류 0. `apps/api` 테스트 72/73 스위트, 1029/1037
통과 — 실패 8건은 전부 `ops.spec.ts`이고 §10에 기록된 기존 문제와 정확히
같은 개수(이 파일은 건드리지 않았다). `pnpm lint` 저장소 전체 0건.
`pnpm --filter web build` 1회 완전 성공(`/product-profile` 경로 포함
정적 생성 확인) — 이후 재실행에서는 동시 진행 중인 다른 세션들과의 메모리
경합으로 `next build`가 OOM으로 죽는 것을 관찰했으나(TypeScript 컴파일은
매번 성공), 이는 여러 Bridge 세션이 같은 머신에서 동시에 빌드를 도는
환경 문제이지 코드 문제가 아니다. **브라우저에서 실제로 확인하지
않았다** — 새 "교차 검증 결과" 카드가 실제 충돌 사례로 어떻게 보이는지는
유닛 테스트로만 확인했다.

## 3-5. T1-25 Product Package 생성 — 완료 검증 (2026-08-09)

`buildProductPackage()`(`packages/core/src/product-profile/
product-package.ts`)가 T1-21(자동 분석)·T1-22(웹 조사)·T1-23(교차 검증)
결과를 하나의 `ProductPackage`로 통합한다. 바코드·모델명·브랜드·원산지는
OCR에서 직접 뽑은 값(T1-21), 프롬프트에 실리는 브랜드·모델은 교차 검증을
거친 값(T1-23)만 쓴다. 웹 조사 결과(T1-22, `research` 필드)는 원문 그대로
보존만 하고 **brand·model 등 다른 필드에 자동으로 반영하지 않는다** —
검색 스니펫에서 "이게 브랜드 값이다"를 뽑아내는 것 자체가 추측이라고
판단했고(M-21의 "비슷한 제품" 오염 위험과 같은 이유), 테스트로 확인했다
(스니펫에 다른 회사 이름이 있어도 브랜드가 바뀌지 않음). 브라우저
(`category-panel.tsx`)에 "자동 조사 결과 (T1-22)" 블록을 추가해 찾은
것·버린 것·근거 URL을 사람이 직접 보게 했다.

**이번 세션은 새로 작성하지 않았다.** 코드는 세션 시작 시점에 이미 작업
트리에 완성돼 있었다 — `bridge/results/T1-25.json`에 완료 보고
(`RESULT_JSON`, workDone·testResults 포함)가 이미 들어 있었는데,
Bridge의 `state` 필드만 `IN_PROGRESS`에 멈춰 있었다. `node
bridge/bridge-cli.mjs status`로 봐도 T1-25가 `IN_PROGRESS`로만 보여
`PROJECT_MEMORY` M-23("Bridge의 `state`는 실제 코드 상태와 어긋날 수
있다")과 같은 종류의 어긋남임을 확인했다 — `state` 하나만 보고 판단하지
않고 코드와 결과 파일을 직접 읽어 실제로 무엇이 끝났는지 확인했다.

이번 세션이 실제로 한 일은 **재검증**이다: 코드를 읽어 기존 완료 보고와
일치함을 확인하고, build·typecheck·lint·test를 처음부터 다시 실행했다.

- `pnpm turbo run build` — 6/6 성공(캐시 히트, 변경 없음을 방증)
- `pnpm turbo run typecheck` — 10/10 성공, 오류 0
- `npx eslint .` — 0건
- `@acos/core` — 130/130 스위트, 1884/1884 테스트 통과
- `apps/web` e2e(Playwright) — 252/252 통과(이전 T1-25 보고 시점엔
  디스크 여유 0바이트로 11/39만 확인됐던 것과 달리, 이번엔 전체가 통과했다
  — 디스크 문제가 그 사이 해소된 것으로 보인다. §7-6 참고)
- `apps/api` — 1029/1037 통과. 실패 8건은 전부 `ops.spec.ts`이며
  `git diff`로 이 세션이 그 파일을 전혀 건드리지 않았음을 확인했다 —
  `PROJECT_MEMORY` M-10에 기록된 것과 정확히 같은 개수·내용의 기존 문제다.

**남은 것**: 웹 조사 결과(`research`)를 실제 Gemini 프롬프트 문장에
포함할지는 이번 범위 밖이다 — Gemini에 무엇을 어떻게 전달할지는 T1-26의
범위이고, 스니펫 해석은 여전히 사람 판단이 필요한 영역이다. 브라우저에서
실제 충돌·조사 사례로 화면을 확인하는 것도 아직 못 했다 — 이미지 생성
(유료 호출)이 있어야 값이 채워지는데, 이번에도 비용 발생 호출은 하지
않았다.

## 3-3. T1-22 제품 자동 조사 — 완료 검증 (2026-08-09)

`packages/core/src/product-profile/product-research.ts` +
`apps/api/src/product-research/`는 §3-2에 적힌 대로 **이 세션이 시작하기
전부터 이미 구현돼 있었다.** 이번 세션은 새로 작성하지 않고 아래를
검증했다.

- **제품이 식별된 경우에만 조사한다** — `planProductResearch`가
  `identification.identified`가 거짓이면 빈 계획을 돌려주고,
  `ProductResearchService`는 계획이 비어 있으면 Provider를 아예 부르지
  않는다(과금 없음).
- **조사 우선순위**(바코드 → 모델명 → 브랜드 → 공식 제조사 홈페이지 →
  공식 카탈로그)를 `planProductResearch`가 그대로 지킨다. 상위 단계에서
  공식 출처를 찾으면 그 자리에서 멈춘다(`ProductResearchService.research`).
- **공식 정보만 쓴다** — `classifyResearchSource`가 쇼핑몰
  목록(다나와·G마켓·11번가·쿠팡 등)을 무조건 제외하고, 포장지 OCR에서 읽은
  제조사 호스트 또는 공인 바코드 조회 기관(코리안넷 등)만 공식으로
  인정한다. 그 외는 전부 `unverified`로 버리되 근거와 함께
  `excluded`에 남긴다.
- **GPT의 기억을 사실처럼 쓰지 않는다** — 기본 Provider는 아무 검색도
  하지 않는 `NoopWebResearchProvider`(비용 없음, `WEB_RESEARCH_PROVIDER`
  미설정 시 기본값). 실제 조사를 켜면(`WEB_RESEARCH_PROVIDER=openai`)
  OpenAI Responses API의 `web_search` 도구를 쓰는
  `OpenAiWebSearchProvider`가 맡는데, **모델이 실제로 방문해 인용
  (`url_citation`)한 URL만** 결과로 인정하고 인용 없는 텍스트(모델의
  "기억"일 수 있는 부분)는 버린다.
- `AppModule`에 `ProductResearchModule`이 등록돼 있고, `POST
  /product-research`로 바로 호출할 수 있다(DB 저장 없음, OCR/Vision
  텍스트를 받아 식별 → 조사까지 한 번에 계산해 돌려준다).

**테스트**: 이번 세션에서 실제로 재실행해 확인했다.
`@acos/core` product-research 스위트 12/12,
`apps/api` product-research 관련 스위트(서비스+OpenAI Provider) 10/10 —
전부 통과. `pnpm build` 6/6, `pnpm typecheck` 10/10 통과. `pnpm lint`는
저장소 전체 기준 4건 실패이나 **전부 `git diff` 없는 기존 파일**
(`apps/web/app/benchmark/*`, `design-review/history/compare/page.tsx` —
§10에 기록된 기존 문제)이라 이번 검증과 무관함을 확인했다. `apps/api`
전체 테스트는 1025/1033 통과 — 실패 8건은 전부 `ops.spec.ts`이고, 해당
파일도 `git diff` 없음을 확인해 §10에 기록된 기존 문제와 동일함을
재확인했다.

**실제 유료 검색 호출은 하지 않았다** — `WEB_RESEARCH_PROVIDER` 기본값
(none)으로 두었다. 벤치마크(베란다 호스)로 실제 조사를 켜서 확인하는
것은 사람 승인 후에 한다.

**브라우저 화면에는 아직 조사 결과 블록이 없다.** `POST
/product-research` API는 동작하지만, `image-studio` 화면
(`category-panel.tsx`)에는 아직 표시되지 않는다 — TASKS.md에 따르면
이 연결은 T1-24(Product Profile 생성)의 범위다.

## 3-4. T1-28 CTO Bridge 다중 프로젝트 표준화 (2026-08-09)

**공식 문서 7종과 무관한 Bridge 계층 작업이다** — 제품 파이프라인
(Sprint 1)은 이 절과 별개로 §4의 "품질 승인 대기 중" 상태 그대로다.

`bridge-projects.mjs`(프로젝트 등록·격리)가 이미 코드에 있었으나
(이전 세션에서 시작됨) CLI·ChatGPT Actions 명세·검사가 따라가지
못했다. 이번에 다음을 보강했다.

- `bridge-cli.mjs`에 `--project <ID>` 플래그와 `project list · register ·
  show` 명령을 추가했다 — HTTP뿐 아니라 CLI로도 새 프로젝트를 등록·조회할
  수 있다.
- `bridge/openapi.yaml`에 `listProjects`·`registerProject`·`getProject`와
  `project` 쿼리 파라미터를 추가했다 — ChatGPT가 Actions로 새 프로젝트를
  등록하고 그 프로젝트만 대상으로 작업을 낼 수 있다.
- `bridge-projects.spec.mjs`(신규, 15건)로 ID 검증(`..` 차단 등)·등록·
  격리를 검사했다. `bridge-state.spec.mjs`에 BLOCKED 상태 전이·게이트
  검사를 보강했다(기존에 없었다). `bridge-async.spec.mjs`가 샌드박스에
  `bridge-projects.mjs`를 빠뜨려 **깨져 있던 것**을 고쳤다(실행하면
  `ERR_MODULE_NOT_FOUND`).
- **실행 중 발견한 심각한 결함**: `bridge/tasks/T1-30.json`이 0바이트로
  잘려 있었다(디스크 포화 중 쓰다 만 것으로 추정). `listTasks`가 서버
  시작·복구 경로(`recoverAbandonedRuns`)에서 매번 불리므로, **이 파일
  하나가 Bridge 서버 전체를 못 뜨게 만들고 있었다** — 실제로 별도 포트
  (4210)에서 검증용 서버를 띄우자 재현됐다. `bridge-io.mjs`의
  `listTasks`가 깨진 JSON 파일을 (지우지 않고) 건너뛰도록 고쳤다.
  **`T1-30.json` 자체는 원본 그대로 남겨 뒀다** — 무엇을 요청했는지 모르니
  지어내지 않는다. ChatGPT CTO가 다시 요청해야 한다.
- **실제 다중 프로젝트 E2E**: `demo-widget`(가상 프로젝트,
  `bridge/demo/demo-widget-repo/`)을 실제로 등록하고, 작업 `D-1`을 실제로
  생성했다. **별도 임시 포트(4210)의 격리된 서버 인스턴스**로 검증했다
  (원래 4200 서버는 T1-28을 실행 중인 프로세스라 재시작하면 이 세션이
  죽을 위험이 있어 건드리지 않았다). `dryRun`으로 실행자가 만드는
  프롬프트를 확인해, `demo-widget`의 문서(`README.md`)·doNotTouch
  (`NOTES.md`)·검증 명령(`npm run build/typecheck/lint/test`)만 실리고
  **acos 전용 규칙(`benchmark/constants.ts` 등)이 전혀 섞이지 않음**을
  확인했다 — 격리가 실제로 동작한다는 증거다.
- **실제 유료 실행(Claude Code 호출)은 하지 않았다.** 아래 §7의 디스크
  포화 문제 때문이다 — 상세는 §7과 `PROJECT_MEMORY.md`를 참고.
  `D-1`은 `REQUESTED` 상태로 남아 있다. **디스크 공간이 회복되면**
  `POST /run?project=demo-widget` (또는 그 응답의 `taskId`)로 이어서
  실행하면 된다.
- **라이브 서버(PID는 세션마다 다름, 이번엔 12908)는 재시작하지
  않았다** — 코드는 고쳐졌지만 **떠 있는 프로세스는 여전히 예전 코드로
  돈다.** 다음에 편한 시점에(다른 작업이 IN_PROGRESS가 아닐 때)
  `bridge/start-bridge.ps1`로 재시작해야 새 `/projects` 경로·깨진 파일
  방어 코드가 실제로 적용된다.

**테스트**: `bridge-state.spec.mjs` 32/32 · `bridge-projects.spec.mjs`
15/15(신규) · `bridge-async.spec.mjs` 25/25 — 전부 통과. `npx eslint .`
0건. `pnpm turbo run typecheck` 10/10. `pnpm turbo run build` 6/6(단,
Turbopack이 디스크 부족 경고를 냈다 — §7 참고). 전체 `pnpm turbo run
test`는 디스크 포화로 신뢰할 수 있게 돌리지 못했다(§7).

---

## 3-6. T1-30 재부팅·PC 교체·추가 SSD 대응 및 환경 영속화 표준화 (2026-08-09)

**공식 문서 7종과 무관한 Bridge/환경 계층 작업이다** — T1-28과 같은
분류. 제품 파이프라인(Sprint 1)은 이 절과 별개로 §4 그대로다.

`docs/RECOVERY_GUIDE.md` §9(신규)에 하드웨어 변경 대응 절차를 정리했다
— 새 PC 온보딩에서 §3에 빠져 있던 것(`.env.example`·마이그레이션·
lockfile의 git 재현성, Claude Code 실행 파일이 VS Code 확장 안에 있다는
점, Bridge 시크릿·터널 주소는 항상 새로 만들어야 한다는 점), 드라이브
문자가 바뀌었을 때 Bridge 프로젝트 재등록 절차(`acos` 기본 프로젝트는
경로를 실행 시점에 스스로 계산해 문제 없음, 추가 등록 프로젝트만
`bridge-cli.mjs project register`로 재등록 필요), 추가 SSD 장착 시
옮길 후보(pnpm 캐시·DB·MinIO·저장소 자체)와 실행 절차, 자동 시작·복구
범위를 실측한 결과를 담았다. `docs/DEVELOPMENT_ENVIRONMENT.md` §11
(신규)에는 그 근거가 된 실측 사실만 남겼다.

**실측(코드는 건드리지 않고 읽기·명령 실행만)**:
- 앱 코드에 이 PC 전용 절대경로 없음 확인(`grep`)
- `.env.example`·`pnpm-lock.yaml`·`pnpm-workspace.yaml` git 추적 확인
- `prisma migrate status` — 65개 마이그레이션이 git만으로 재현되어
  "up to date" 확인(과금 없음, DB 스키마 변경 없음)
- `Get-ScheduledTask` — 이 PC에 Bridge 자동 시작용 예약 작업이
  **없음**을 확인(가짜로 "된다"고 적지 않았다)
- `Get-PSDrive` — C: 여유 3.0GB(재발), E: 여유 28.9GB
- pnpm 전역 캐시 위치 확인(`C:\Users\82104\AppData\Local\pnpm\store\v10`)

**실행하지 않은 것(절차만 문서화)**: pnpm 캐시를 E:로 옮기는 것,
PostgreSQL·MinIO 데이터 디렉터리 이전, Bridge 자동 시작 예약 작업 등록.
전부 이 PC 전체 설정이나 운영 중인 서비스에 영향을 주는 되돌리기
어려운 변경이라 — 특히 이 워크트리에서 다른 Bridge 세션이 동시에
`pnpm install`을 돌리고 있을 위험(`PROJECT_MEMORY` M-28)이 있어 —
**가장 보수적으로 절차만 남기고 실행하지 않았다.**

**발견한 위험 — 사람 결정 필요**: `git ls-files bridge/`가 빈 결과를
반환했다. **`bridge/` 아래 전부가 한 번도 git에 커밋된 적이 없다.**
디스크가 손상되거나 이 워크트리를 지우고 새로 clone하면 Bridge
코드와 모든 작업 이력(T1-21~T1-29)이 사라진다. `bridge/`를 git에
포함할지는 "건드리면 안 되는 것" 목록에 해당하고 다른 프로젝트의
등록 정보·이력이 함께 커밋되는 문제라 **직접 결정하지 않고
`decisionNeeded`로 남겼다.** 근거: `docs/PROJECT_MEMORY.md` M-31,
`docs/RECOVERY_GUIDE.md` §9-6.

**검증**: 문서 파일(`docs/RECOVERY_GUIDE.md`·`DEVELOPMENT_ENVIRONMENT.md`·
`PROJECT_MEMORY.md`·`PROJECT_STATE.md`)만 수정했고 앱 코드는 건드리지
않았다. `pnpm turbo run build`·`typecheck`·`npx eslint .`·
`pnpm turbo run test`는 이번 변경과 무관하게 통과해야 정상이며, 아래
`RESULT_JSON`에 실측 결과를 기록한다.

---

## 3. 오늘 완료한 작업 (2026-08-08)

### 코드

1. **Product Package를 모든 Gemini 생성 경로에 적용**
   - 이전: 후보 생성 경로만 사용
   - 현재: 대표 썸네일·사용 장면·디테일·특징 강조 + 배경 제거·배경 생성·합성
   - **문장 조립 함수 하나만** 쓰도록 통일 (경로마다 프롬프트가 갈라지지 않음)

2. **제품 동일성 최우선 규칙 추가** — 프롬프트 **맨 앞**에 8개 항목 배치

3. **한국인 모델 규칙 추가** — 서양인 모델 금지, 20~30대 한국인 기본

4. **원본 사진 함께 전송** — 배경 제거본(윤곽 기준) + 원본(색상·재질·디테일 기준) 2장

5. **글자 렌더링 금지 규칙** — 제품 정보가 없어도 항상 붙임
   (원본 사진에 이미 글자가 있기 때문)

6. **브라우저 화면에 4개 항목 추가** — Provider · Model · 생성 시간 · Category

### 환경

7. **로컬 DB 마이그레이션 7개 적용** — 65개 전부 최신
8. **로컬 Benchmark Dataset 구축** — 베란다 호스 7장 업로드
9. **OCR 실행** — 987자 추출 (이전에는 실행조차 안 됐음)
10. **Product Profile 재생성** — 추측값에서 사실값으로

### 문서

11. `docs/MASTER_GUIDE.md` — 운영 헌법
12. `docs/DEVELOPMENT_ENVIRONMENT.md` — 환경 SSOT
13. `AGENTS.md` — 절대 원칙 9·10번 추가, 읽기 순서 명시
14. `docs/PROJECT_STATE.md` · `docs/PROJECT_MEMORY.md` · `docs/RECOVERY_GUIDE.md`

---

## 3-1. CTO Bridge 구축 (2026-08-09)

ChatGPT(총괄) ↔ Claude Code(실행자) 작업 전달 구조를 `bridge/`에
만들었습니다. **공식 문서 7종은 그대로 두고** 작업 흐름과 상태만 다룹니다.

- 통신 계층(`bridge-io.mjs`) · 상태 계층(`bridge-state.mjs`) · 실행 계층 분리
- 상태: `REQUESTED → IN_PROGRESS → TESTING → READY_FOR_REVIEW → COMPLETED`
  **건너뛰기 불가**
- 검증 기록이 없으면 `READY_FOR_REVIEW`로 올라가지 못함
- 현재 상태: `node bridge/bridge-cli.mjs status` → `bridge/STATUS.md`
- 검사 13건 통과 (건너뛰기 차단·게이트 누락 차단이 실제로 동작함을 확인)

### 이후 확장 (2026-08-09)

| | 상태 |
| --- | --- |
| HTTP API (`bridge-server.mjs`, 4200) | 동작 · Bearer 토큰 인증 |
| cloudflared 공개 주소 | 동작 · **재시작하면 주소가 바뀜** |
| ChatGPT Actions 명세 (`openapi.yaml`) | 등록 가능 상태 · 사람이 붙여넣어야 함 |
| **비동기 실행** | 동작 · `/run` 이 즉시 202 (실측 83ms) |
| 중단된 실행 자동 복구 | 동작 · 서버 재시작 시 대기열 복귀 |
| 현황판 (`localhost:4201`) | 동작 · 읽기 전용 · 터널에 연결 안 함 |
| **무인 실행** | 동작 · 승인 창·표준입력 대기 없음 · 조용한 정지 감지 |
| **다중 프로젝트** | 동작 · 공통 시스템과 프로젝트 데이터 분리 · 등록만으로 새 프로젝트 시작 |
| **BLOCKED (사장님 결정 대기)** | 동작 · 무엇을 정해야 하는지 적어야만 들어올 수 있음 |

**Cloudflare 524를 겪고 비동기로 바꿨습니다.** 오래 걸리는 작업을 HTTP
응답으로 기다리면 터널이 100초에서 끊습니다. 다만 **524가 났어도 작업은
계속 돌고 있었습니다** — 자세한 것은 `PROJECT_MEMORY` M-24.

검사: 상태 게이트 24건 · 비동기 실행 10건 전부 통과.

## 4. 현재 진행 중인 작업

**사람의 품질 승인 대기 중.**

개선된 설정으로 이미지 12장(v3)을 재생성해 브라우저에서 확인 가능한 상태로
준비했습니다. **품질 판단은 사람이 합니다.**

확인 주소: `http://localhost:3100/image-studio`
(로컬 서버가 꺼져 있으면 `docs/RECOVERY_GUIDE.md` §4 참고)

---

## 5. 다음 작업

| 순서 | 작업 | 조건 |
| --- | --- | --- |
| 1 | **사람이 v3 이미지 품질 판단** | 지금 대기 중 |
| 2 | 품질 미달이면 프롬프트·Package 재개선 | 1의 결과에 따라 |
| 3 | `benchmark/constants.ts`를 로컬 ID로 확정 | **사람 승인 필요** |
| 4 | 변경 사항 커밋 | 1·3 이후 |
| 5 | Sprint 1 종료 선언 | 사람 판단 |
| 6 | Sprint 2 시작 (Claude → 상세페이지) | Sprint 1 완료 후 |

---

## 6. 남은 작업 (Sprint 1)

- [ ] 사람의 v3 이미지 품질 승인
- [ ] `benchmark/constants.ts` 로컬 ID 확정 (승인 후)
- [ ] 임시 상태 복구 (아래 §7 참고)
- [ ] 변경 사항 커밋
- [ ] `README.md`에 환경 문서 링크 추가 (Sprint 1 완료 후, 승인 필요)

---

## 7. 현재 이슈

### 🔴 임시 상태 — 반드시 복구해야 함

| | 무엇 | 복구 방법 |
| --- | --- | --- |
| 1 | `apps/web/app/benchmark/constants.ts`가 **로컬 사진 ID로 바뀌어 있음** | 백업: `C:\Users\82104\AppData\Local\Temp\constants-backup.ts`. 승인 시 그대로 확정, 아니면 원본 복구 |
| 2 | 로컬 Next.js 3000번이 **꺼져 있고** 3100번이 대신 떠 있음 | `pnpm --filter web dev` 로 복구 |
| 3 | 로컬 API 4100·웹 3100이 떠 있음 | 확인 끝나면 종료 |

### 🔴 미해결 문제

| | 문제 | 상태 |
| --- | --- | --- |
| 1 | `benchmark/constants.ts`가 **원격 DB의 사진 ID**를 가리킴 — 로컬에서 열리지 않음 | 승인 대기 |
| 2 | `TASKS.md`가 **다른 작업 줄기의 내용**이었음 (Sprint 52 출시 저지 항목). 현재 Sprint 1과 무관 | 이번에 현재 Sprint 기준으로 재작성 |
| 3 | **Gemini Raw Response가 항상 비어 있음** — 13장 전부 `null`. 화면 결함인지 Gemini가 원래 텍스트를 안 주는지 **미확인** | 미확인 |
| 4 | ESLint 오류 4건 (`apps/web/app/benchmark/*`, `design-review/*`) — `react-hooks` 규칙 미등록. **이번 변경과 무관, 기존 문제** | 기존 문제 |
| 5 | `apps/api/src/ops/ops.spec.ts` 8건 실패 — **변경 전에도 동일하게 실패함을 확인** | 기존 문제 |
| 6 | 🔴 **C 드라이브 여유 공간이 사실상 0** (2026-08-09, T1-28 중 확인) — 이 저장소·캐시(`node_modules`·`.next`·pnpm store 등) 합계는 3.4GB뿐인데 C: 전체는 112GB 중 정확히 111GB+가 사용 중. **원인은 이 프로젝트 바깥**(사용자 PC의 다른 파일)이다. `pnpm turbo run test` 도중 Jest 워커가 "메모리 부족"으로 죽었는데 실제로는 물리 RAM이 32GB 중 10.9GB 남아 있었다 — 디스크가 없어 페이지파일이 못 늘어난 것으로 추정. `bridge/tasks/T1-30.json`이 0바이트로 잘린 것도 이 문제 때문으로 보인다(§3-4 참고). **긴급 — 사람이 C 드라이브를 정리해야 한다.** (E: 드라이브는 28.9GB 남아 있어 대안이 될 수 있으나 저장소 이전은 결정이 필요하다) | 🔴 긴급 · 승인 필요 |

### ⚠️ 주의

- **SSH 터널(3000/4000 → EC2)은 절대 종료하지 않습니다.**
- 원격 EC2와 원격 DB는 **읽기 외에 건드리지 않습니다.**
- **원격에는 이번 Sprint 변경이 배포되지 않았습니다.**

---

## 8. 중요 결정사항

| 날짜 | 결정 | 이유 |
| --- | --- | --- |
| 2026-08-08 | **제품 동일성 > 이미지 품질** | 사진과 다른 물건이 배송되면 반품·분쟁. 파는 사람의 책임 |
| 2026-08-08 | **Gemini에 원본 사진도 함께 전송**(선택지 B) | 배경 제거본만 보내면 색상·질감 근거를 잃고 상상으로 채움 |
| 2026-08-08 | **한국인 모델 기본값** | 실제 사용자가 한국 소비자. 서양인이 나오면 맥락이 어긋남 |
| 2026-08-08 | **Claude는 이미지 품질을 판단하지 않음** | AI가 만든 것을 AI가 검사하면 검증이 아님 |
| 2026-08-08 | **베란다 호스를 공식 Benchmark로 고정** | 같은 제품으로 반복해야 변화를 비교할 수 있음 |
| 2026-08-08 | **로컬 Benchmark 구축, 원격 DB 의존 제거** | 원격은 배포 전 코드를 모름. 로컬에서 검증해야 함 |
| 2026-08-08 | **환경 문서를 SSOT로 지정** | 포트를 로컬로 착각해 잘못 보고한 사고가 있었음 |
| 2026-08-08 | **`benchmark/constants.ts`는 사람 승인 없이 수정 금지** | 회귀 테스트의 기준점 |
| 2026-08-08 | **OCR을 Product Profile 전에 반드시 실행** | 실행하지 않아 제품 정보가 전부 추측값이 됐음 |

---

## 9. 현재 Benchmark 데이터 (로컬)

```
Project ID          cmskcpy8z0031ulncv49nb0rl
Product Profile ID  cmskff85t0050uldwtre10ah2   (OCR 반영, 2차)
```

**Image ID 7장** — 자세한 것은 `docs/DEVELOPMENT_ENVIRONMENT.md` §5

**생성된 이미지 버전**

| 카테고리 | 전체 | v3 (개선 후) | v2 · v1 (개선 전) |
| --- | --- | --- | --- |
| 대표 썸네일 | 11장 | 3장 | 4 · 4 |
| 사용 장면 | 10장 | 3장 | 4 · 3 |
| 제품 디테일 | 10장 | 3장 | 4 · 3 |
| 특징 강조 | 10장 | 3장 | 4 · 3 |

**v3가 개선 결과이고 v1·v2는 비교용으로 남겨 둡니다. 지우지 않습니다.**

---

## 10. 품질 게이트 상태 (2026-08-08 실측)

| 게이트 | 결과 |
| --- | --- |
| Build | ✅ 6/6 |
| Typecheck | ✅ 10/10, 오류 0 |
| Sprint 1 범위 검사 | ✅ 102개 통과 (core 82 · api 20) |
| ESLint (범위 내) | ✅ 0건 |
| ESLint (전체) | ⚠️ 4건 — 기존 문제, 이번 변경 무관 |
| 전체 Test | ⚠️ `ops.spec.ts` 8건 실패 — 기존 문제, 변경 전에도 동일 |

---

## 11. 커밋 상태

**커밋하지 않았습니다.** 현재 변경된 파일:

```
수정   apps/api/src/image-gen/image-gen.controller.ts
수정   apps/api/src/image-gen/image-gen.service.ts
수정   apps/api/src/image-gen/image-gen.service.spec.ts
수정   apps/web/app/image-studio/category-panel.tsx
수정   apps/web/app/benchmark/constants.ts        ← 임시 상태
수정   packages/core/src/product-profile/index.ts
수정   packages/shared/src/index.ts
수정   AGENTS.md
신규   packages/core/src/product-profile/product-package.ts
신규   packages/core/src/product-profile/product-package.spec.ts
신규   docs/MASTER_GUIDE.md
신규   docs/DEVELOPMENT_ENVIRONMENT.md
신규   docs/PROJECT_STATE.md
신규   docs/PROJECT_MEMORY.md
신규   docs/RECOVERY_GUIDE.md
```

브랜치 `agents/claude-chatbot-integration` · 기준 커밋 `f13f230`
