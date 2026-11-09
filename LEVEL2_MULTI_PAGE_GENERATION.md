# LEVEL 2 다중 상세페이지 이미지 분할 생성 (T1-191)

> 이 문서는 `docs/RECOVERY_GUIDE.md` §2의 문서 지도에 포함되지 않은
> **기능 단위 원칙 문서**다. `LEVEL1_ONE_SHOT_GENERATION.md`(T1-189)
> 위에 얹은 확장이며, 그 문서·산출물은 전혀 수정하지 않았다.

## 무엇을 만들었는가

T1-189가 만든 "사진 업로드 → 완성된 이미지 1장" 원샷 엔진을 확장해,
**상세페이지를 3~6장의 섹션 이미지로 자동 분할**하고, 각 이미지 아래에
**검증된 제품 정보(하단 정보 패널)**를 함께 보여준다.

```
[사진 업로드] → [상세페이지 생성] → 진행률(N/M) → 완성된 여러 장(순서대로) + 제품 정보 패널
```

브라우저 주소: `http://localhost:3100/level2-generate`

기존 `/level1`(T1-188)·`/level1-generate`(T1-189) 화면은 손대지 않고
그대로 둔다. 이 화면은 완전히 새 경로다.

## 핵심 질문 1 — 한 번의 generateContent 호출로 여러 장의 이미지를 안정적으로 받을 수 있는가

**조사 결과: 문서화된 방법이 없다. 그래서 "받을 수 있다"고 구현하지
않았다.**

`@google/genai@2.13.0`(이 저장소가 이미 쓰는 SDK, `apps/api/package.json`)의
타입 선언(`node_modules/.pnpm/@google+genai@2.13.0/.../dist/genai.d.ts`)을
직접 확인했다.

| 설정 | 위치 | 의미 |
| --- | --- | --- |
| `candidateCount` | `GenerateContentConfig` | "응답 변형 개수" — 같은 프롬프트를 N번 독립적으로 샘플링해 후보 N개를 돌려준다. **페이지마다 다른 지시(예: 1번은 HERO, 2번은 SPEC)를 줄 방법이 없다** — 모든 후보가 같은 입력에서 나온다 |
| `imageConfig.aspectRatio`/`imageSize` | `GenerateContentConfig` | 이미지 1장의 비율/크기 설정일 뿐, 장수와 무관 |
| `numberOfImages` | `GenerateImagesConfig` (Imagen 전용, **`generateContent`가 아니라 별도 `generateImages` API**) | 이 프로젝트가 쓰는 멀티모달 입력+이미지 출력 경로(`generateContent`)와 다른 API다. 섞어 쓸 수 있다는 근거가 없다 |

즉 **"한 번의 호출로 서로 다른 내용을 담은 이미지 N장"을 만드는
문서화된 방법은 없다.** `candidateCount`로 후보를 여러 개 받을 수는
있지만, 그건 "같은 지시의 여러 변주"이지 "1페이지=대표, 2페이지=특징"
처럼 서로 다른 역할의 페이지가 아니다 — 이 요청이 원하는 것과 다르다.

**그래서**: 페이지 이미지는 **페이지 수만큼 `generateContent`를
반복 호출**한다(최소 호출 구조, 아래 "호출 수" 참고). 각 호출은
T1-189가 이미 실측 검증한 것과 같은 형태(`config.responseModalities:
[Modality.IMAGE]`)를 그대로 재사용한다(`gemini-page-image.client.ts`).

## 핵심 질문 2 — 분석(제품 이해)과 생성에 필요한 구조화 정보를 같은 응답 계약으로 확보할 수 있는가

**조사 결과: `responseModalities: [TEXT, IMAGE]`를 함께 요청하면 텍스트와
이미지를 한 응답에 같이 받을 수 있다고 SDK가 명시적으로 문서화한다**
(`genai.d.ts` 5595행: `"Optional. The modalities of the response... For
example, if this is set to [TEXT, IMAGE], the response will include both
text and an image."`).

**그런데 이 조합을 실제로 쓰지 않았다.** 이유는 이 프로젝트의 비용
최소화 원칙(`API 비용 최소화` 메모리) 때문이다 — `responseSchema` +
`application/json`(정확한 구조화 출력이 필요한 부분)과
`responseModalities: [..., IMAGE]`를 **함께** 쓰는 조합이 실제로
안정적으로 동작하는지는 이 SDK 문서 어디에도 없고, 이미지 생성
모델(`gemini-2.5-flash-image`)이 아닌 텍스트 모델(`gemini-2.5-flash`)의
JSON 모드만 이 저장소에서 실제로 검증돼 있다(`apps/api/src/llm/
providers/gemini.provider.ts`, TASK-0903). 검증되지 않은 조합을 확인하려면
추가 실 과금 호출이 필요한데, 이는 "실 호출은 꼭 필요할 때 1회만"
원칙과 충돌한다.

**그래서**: 분석(텍스트 JSON)과 이미지 생성을 **별도 호출로 분리**했다.

- **분석 호출(Call A)** — `gemini-analysis.client.ts`. 모델
  `gemini-2.5-flash`(이 저장소가 이미 운영 중인 `GeminiLlmProvider`의
  기본값과 동일, 추측 아님). `responseMimeType: "application/json"`만
  쓴다(`responseModalities` 지정 없음 — 텍스트 전용). 업로드된 사진
  전체를 한 번에 보고 ① 각 사진의 역할(실제 제품/포장/라벨/사양표/
  바코드/설명서/판단불가) ② 검증된 제품 정보 ③ 페이지 구성(3~6장,
  역할·제목·설계 지침)을 JSON 하나로 받는다.
- **페이지 이미지 호출(Call B × N)** — `gemini-page-image.client.ts`.
  모델 `gemini-2.5-flash-image`(T1-189와 동일). Call A가 정한
  `designBrief`를 그대로 프롬프트에 반영해 페이지 1장씩 생성한다.

## 최소 호출 수 — 1 + 페이지 수(N, 3~6)

```
1회  분석(제품 이해 + 페이지 구성 결정, 텍스트만)
N회  페이지 이미지 생성(페이지당 1회, N = 3~6 — AI가 제품 특성에 따라 결정)
─────
총 4~7회 / 1건의 "상세페이지 생성" 요청
```

원샷(T1-189)보다 호출이 늘어난 것은 사실이다. 다만 이는 **API 자체의
한계**(핵심 질문 1)이지 설계 선택이 아니다 — 위 조사로 확인된 대로,
서로 다른 내용의 이미지 여러 장을 한 호출로 안정적으로 받는 방법이
없는 상태에서 "여러 장 생성"을 정직하게 구현하면 이 구조가 최소치다.
페이지 수 자체는 AI가 제품 특성에 따라 3~6장 사이에서 스스로 정하며,
모든 제품에 같은 장수를 강제하지 않는다(`multi-page-prompt.ts`).

## 원본사진 reference 방식 — 제품 동일성

- Call A가 업로드된 사진마다 역할을 스스로 분류한다
  (`ACTUAL_PRODUCT`/`PACKAGING`/`LABEL`/`SPEC`/`BARCODE`/`MANUAL`/
  `LIFESTYLE`/`UNKNOWN`).
- 사용자가 미리 `PATCH /level1/assets/:id/role`(T1-188 기존 API,
  수정하지 않음)로 역할을 지정해 둔 asset이 있으면 **그 값이 AI 분류보다
  항상 우선**한다(확인된 사실이 AI 추정보다 우선, MASTER_GUIDE 철학 2).
- **모든 페이지 이미지 생성 호출은 `ACTUAL_PRODUCT`로 분류된 사진만
  reference로 받는다.** `PACKAGING`/`LABEL`/`SPEC`/`BARCODE`/`MANUAL`은
  절대 형태 reference로 전달하지 않는다(요청 사양 7, 코드로 강제 —
  `level1-multi.service.ts`의 `NON_SHAPE_REFERENCE_ROLES`).
- `ACTUAL_PRODUCT`로 분류된 사진이 **한 장도 없으면 생성 자체를 하지
  않고 FAILED로 기록한다** — 포장 사진을 제품 형태로 잘못 쓰는 것보다
  "만들지 않는다"가 안전한 쪽이라고 판단했다(무인 실행 시 가장 보수적인
  선택).
- 각 `Level1DetailPage` 레코드에 그 페이지 생성에 **실제로 전달한**
  `referenceAssetIds`를 기록한다(요청 사양 8).
- 원본 업로드(`level1_assets`, T1-188)는 이 기능이 읽기만 한다 —
  수정·삭제하는 코드 자체가 없다. 생성 결과는 완전히 다른 오브젝트 키
  (`level1-multi/{generationId}/{pageIndex}-{uuid}.{ext}`)에 저장해
  원본과 절대 섞이지 않는다.

## 제품 정보 추출·검증·표시 방식

- Call A는 사진에서 **실제로 확인되는 값만** 채우도록 지시받는다
  (`multi-page-prompt.ts`의 `buildAnalysisPrompt`). 값이 없으면
  `null`(단일 필드) 또는 빈 배열/빈 객체다 — AI가 지어내면 안 된다는
  규칙을 프롬프트에 명시했다.
- `gemini-analysis.client.ts`는 모델이 스키마를 완벽히 지키지 않을
  경우를 대비해 **응답을 방어적으로 재검증**한다 — 문자열이 아니면
  버리고, 배열이 아니면 빈 배열로, 역할 값이 8종 enum 밖이면 버린다.
  즉 "모델이 뭐라고 답했든 그대로 믿지 않는다."
- 검증된 정보는 `Level1MultiGeneration.verifiedProductFacts`(JSON)에
  저장되고, `/level1/multi-generations/:id` 응답에 그대로 노출된다.
- 화면(`multi-view.tsx`)은 이 값을 **하단 "제품 정보" 패널**에
  제품명·브랜드·모델명·제조사·제조국/원산지·소재·규격/크기·구성품·
  주요 사양·주의사항 순서로 표시하고, 값이 없으면 **"확인되지 않음"**
  이라고 명시적으로 보여준다(빈칸으로 두거나 지어내지 않는다).

## 한글 처리 — 왜 이미지 안에 텍스트를 넣지 않는가

T1-189의 실측(`LEVEL1_ONE_SHOT_GENERATION.md`)에서 생성 이미지 안
한글 캡션이 깨지는 현상("펀리한 물 뷰사")이 관측됐다. 이 문제를
두 방향에서 다룬다.

1. **페이지 이미지 프롬프트(Call B)에 "이 이미지 안에 어떤 글자도
   그려 넣지 마세요" 규칙을 명시적으로 추가했다**
   (`multi-page-prompt.ts`의 `PAGE_IDENTITY_RULES`). T1-189의
   프롬프트에는 이 규칙이 없었다 — 이번에 추가했다. 다만 이것도
   **모델에게 지시만 한 것**이며 코드로 강제되지 않는다(이미지 생성
   모델이 지시를 완전히 따른다는 보장은 없다) — 사람이 브라우저에서
   실제로 확인해야 하는 항목이다.
2. **정확한 제품 정보는 애초에 이미지 픽셀이 아니라 실제 DOM
   텍스트로 렌더링한다** — 위 "표시 방식"의 하단 정보 패널이 그것이다.
   서버가 가진 정확한 문자열을 Next.js가 그대로 그리므로, 이미지 생성
   모델의 한글 렌더링 실패와 무관하게 항상 정확하다.

## 저장 구조

```
level1_multi_generations   1건의 "상세페이지 생성" 요청 (분석 결과 + 상태)
  └─ level1_detail_pages   페이지별 이미지 결과(N건, pageIndex 순서)
```

- 마이그레이션: `20260908000000_level1_multi_generation`(신규 테이블
  2개 + enum 2개만 추가, 기존 테이블 무수정).
- `Level1MultiGeneration.productId`→`Level1Product`, `Level1DetailPage.
  generationId`→`Level1MultiGeneration`은 DB 외래키로만 걸었다(전자는
  T1-189와 같은 이유로 `Level1Product`를 수정하지 않기 위해 Prisma
  relation 미선언, 후자는 이번에 새로 만든 두 테이블 사이라 Prisma
  relation을 정상 선언했다).
- 원본 업로드(MinIO `level1/...`)·페이지 결과(`level1-multi/...`)는
  키 프리픽스로 완전히 분리된다.
- 메타데이터 계약(요청 사양 8) — `Level1DetailPage`에 `pageIndex`·
  `pageRole`·`referenceAssetIds`·`outputObjectKey`·`provider`·`model`·
  `createdAt`/`updatedAt`을 저장한다. `verifiedProductFacts`는 페이지가
  아니라 생성(`Level1MultiGeneration`) 단위로 저장한다(모든 페이지가
  같은 제품 정보를 공유하므로 중복 저장하지 않는다) — API 응답에서는
  각 조회 결과에 함께 노출된다.

## API

```
POST /level1/products/:id/multi-generate
  → 즉시 반환(비동기 시작). status: PENDING→ANALYZING→GENERATING→
    SUCCEEDED|PARTIAL|FAILED

GET  /level1/multi-generations/:id
  → 폴링용. pages 배열의 각 항목 status로 진행률(N/M)을 계산한다.

GET  /level1/multi-generations/pages/:pageId/file
  → 페이지 이미지 바이트.
```

`POST`가 비동기인 이유: 분석 1회 + 페이지 N회(최대 6회)를 순차 실행하면
수십 초~수 분이 걸릴 수 있다. Bridge의 `/run`(즉시 202 + 폴링,
`bridge/README.md` §3-2)과 같은 이유로 요청과 실행을 분리했다.

## 실패 처리

- 분석 호출이 실패하면(정책 거부·JSON 파싱 실패·페이지 계획 3장 미만
  등) 전체를 `FAILED`로 기록하고 페이지는 하나도 만들지 않는다.
- 분석은 성공했지만 실제 제품 사진이 하나도 없으면 `FAILED`(위
  "원본사진 reference 방식" 참고) — 이미지 생성 호출 자체를 시도하지
  않는다(불필요한 과금 방지).
- 페이지별 이미지 생성은 **서로 독립**이다 — 한 페이지가 실패해도
  나머지 페이지는 계속 시도한다. 전부 성공하면 `SUCCEEDED`, 일부만
  성공하면 `PARTIAL`, 전부 실패하면 `FAILED`.
- 실패해도 예외를 던지지 않고 항상 `Level1DetailPage.status: FAILED`
  + `errorMessage`로 기록한다(T1-189와 같은 패턴) — 재시도 가능성을
  보존한다. 화면에는 "다시 시도" 버튼이 있다.

## 실제 검증에서 발견한 것 — Gemini API 계정 결제 차단 (코드 문제 아님)

Benchmark 원본 3장(T1-189·T1-190이 검증에 쓴 것과 같은 자산,
`productId cmt55ahn60003ult8299sh1g3`)으로 실 E2E를 시도했다. 분석
호출(Call A)이 **HTTP 403 `PERMISSION_DENIED`**로 즉시 실패했다.

```
{"error":{"code":403,"message":"Lightning dunning decision is deny for
project: projects/1003927393781","status":"PERMISSION_DENIED"}}
```

**이것이 이번 구현의 버그가 아니라는 것을 실측으로 확인했다** — T1-189가
이미 실 과금으로 검증했던 **기존** `/level1/products/:id/generate`
엔드포인트(이번 작업이 전혀 건드리지 않은 코드)를 같은 제품으로 다시
호출했더니 **똑같은 403 에러**가 났다. 즉 이 GEMINI_API_KEY가 속한
Google Cloud 프로젝트의 결제(dunning = 미납 등으로 인한 청구 보류)가
막힌 상태다 — 이 워크트리의 어떤 코드 변경과도 무관한 **계정 상태
문제**다.

**이후 대응**: 이 프로젝트의 비용 최소화 원칙("실 호출은 꼭 필요할 때
1회만")에 따라, 같은 계정으로 재시도하지 않았다(재시도해도 같은
결과가 나올 것이 이미 확인됐다). 대신:

- 실 Chromium(Playwright)으로 `/level2-generate`에서 사진 3장을 실제로
  업로드→클릭→분석 대기→오류 화면까지 **전체 UI 흐름을 실행**해,
  업로드·API 호출·폴링·오류 표시·"다시 시도" 버튼이 전부 정상 배선돼
  있음을 확인했다(console/page error 0건). 화면이 뜬 것 자체는 이번
  작업이 만든 코드지만, **성공한 이미지가 실제로 원본과 같은 제품인지는
  이번에 검증하지 못했다** — 이는 이 작업의 미완료 항목이다.
- 원본 3장이 이번 시도로 전혀 변경되지 않았음을 재조회로 재확인했다
  (objectKey·크기 동일).
- 실패 시나리오(분석 실패)의 DB 기록·오류 메시지 보존·페이지 0건 생성
  자체는 이번 실 호출로 실제로 검증됐다(코드가 설계대로 동작함).

**사람이 판단·조치해야 하는 것**: 이 GEMINI_API_KEY가 연결된 Google
Cloud 프로젝트(`1003927393781`)의 결제 상태를 Google Cloud Console에서
확인해야 한다. Claude Code는 결제 정보에 접근할 수 없고 이 문제를
직접 해결할 수 없다.

## 건드리지 않은 것

- `apps/api/src/level1/*`(T1-188)·`apps/api/src/level1-generate/*`
  (T1-189)·그 컨트롤러/서비스 파일 — 전혀 수정하지 않았다. 새 모듈
  `apps/api/src/level1-multi/*`만 추가했다.
- `apps/web/app/level1/*`·`apps/web/app/level1-generate/*` — 전혀
  수정하지 않았다. 새 화면 `apps/web/app/level2-generate/*`만 추가했다.
- `packages/core`·`packages/shared` — 새 타입을 추가하지 않고 이
  모듈 안에 로컬로 정의했다(T1-189와 같은 이유 — 동시 진행 작업과의
  충돌 회피, 이번 세션은 T1-188/189/190이 전부 `READY_FOR_REVIEW`
  상태임을 `bridge/bridge-cli.mjs status`로 미리 확인해 실제 동시
  수정 충돌은 없었다).
- `benchmark/constants.ts`·`bridge/` 전부·원격 EC2·SSH 터널.
  reset/clean/checkout/stash/commit/push 하지 않았다.
