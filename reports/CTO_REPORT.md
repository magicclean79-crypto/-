# CTO_REPORT — AI Product Content OS 공식 기술 보고서

> 이 문서는 AGENTS.md의 TASK 완료 절차에 따라 모든 TASK 완료 시 갱신된다.
> 형식(섹션 구성)은 항상 동일하게 유지한다:
> 1. 보고 요약 → 2. 품질 게이트 → 3. **변경 사항** → 4. **테스트 결과**
> → 5. **아키텍처 변경**(+현황) → 6. 데이터 모델 → 7. API 표면
> → 8. 리스크·기술 부채 → 9. **다음 권장 사항**
> (굵은 항목 4가지는 AGENTS.md가 요구하는 필수 포함 항목)

---

## 1. 보고 요약

| 항목 | 값 |
| --- | --- |
| 보고 기준 TASK | **TASK-2901 — Enterprise AI Provider Production Platform** (Sprint 29) |
| 보고일 | 2026-07-30 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **실 Provider를 순서대로 붙이고, 붙었는지를 사실로 확인한다** — 연결 순서 판정 · OCR 운영 표준 엔진 · 조용한 mock 대체 제거 |
| 구현 중단 상태 | **TASK-2901 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 실키 확보 경로·OCR 엔진 선택·근거 기한 → **CTO_REQUEST #62 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **1,504** — core 780(+34) · api 588(+42) · **web e2e 136(+3)** — 전체 통과 |
| TypeScript | `tsc --noEmit` (4개 워크스페이스) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |
| Major Migration 교차 검증 | `pnpm check:major-migrations` | ✅ 2건 일치 (**이번 주기 마이그레이션 없음** — §6) |

## 3. 변경 사항 (이번 보고 주기)

### TASK-2901 — Enterprise AI Provider Production Platform

**1~4. 유지 결정과 만들지 않기로 한 것 (결정 2801-①②③④)**

승인 결정 넷은 "유지한다"·"만들지 않는다"였습니다. **코드를 바꾸지 않는 대신
그 사실을 테스트로 고정했습니다** — 유지 결정은 코드에 흔적이 남지 않아서
나중에 누가 "정리"하며 없애도 아무도 모릅니다.

| 결정 | 고정한 방법 |
| --- | --- |
| ① 전체 범위 Alert 유지 | 전체 범위에서 경보가 만들어지고 키·제목에 "전체"가 담김 |
| ② 프로젝트별 Alert 유지 | 프로젝트 범위 경보가 **전체와 다른 키**로 남음 |
| ③ 표본 10건 고정 | `NEW_VIOLATION_SAMPLE_LIMIT === 10` + **core에 `process.env`가 없음**을 소스 검사로 확인 |
| ④ 작성자 직접 알림 미구현 | 경보에 수신자 개념이 없음(`author`·`recipient`·`assignee` 부재) + 감지 결과의 필드 목록 고정 |

③을 환경변수로 열지 않은 이유를 명시했습니다: 열면 "일단 늘려 두는" 우회가
생기고 경보가 목록이 됩니다. 건수는 항상 전체를 말하므로 잘린 사실은 감춰지지
않습니다.

**5. 연결 순서를 값으로 (결정 2801-⑤)**

확정된 순서를 주석이 아니라 **값**으로 두었습니다:

```ts
export const PROVIDER_ROLLOUT_ORDER = ["openai","anthropic","gemini","vision","ocr"];
```

`judgeProviderRollout`이 단계별 상태와 **다음에 붙일 단계**를 판정하고,
`GET /ops/providers`(ADMIN)와 관리자 화면이 그대로 보여줍니다.

가장 중요한 판정 규칙은 **`unverified`를 `connected`로 세지 않는 것**입니다:

| 상태 | 뜻 |
| --- | --- |
| `not-configured` | **아직 붙이지 않았다** — 실패가 아닙니다 |
| `unverified` | 설정은 됐지만 **실제로 붙는지는 모릅니다** |
| `invalid` | 키 형식이 틀렸습니다 (운영 기동이 막힙니다) |
| `connected` | 그 Provider로 **성공한 실행 기록이 있습니다** |
| `mock` | **가짜가 돌고 있습니다** |
| `dev-only` | 개발용 선택 엔진입니다 (결정 2401-⑤) |

- **연결됨의 근거는 선언이 아니라 사실입니다** — `executions`·`ocr_results`의
  성공 기록(mock 제외)이 있어야 `connected`입니다. 진단 호출(Live Check)의
  성공도 근거로 셉니다: 실제로 키가 통했다는 증거이기 때문입니다.
- 그 근거에는 **기한**이 있습니다(최근 30일 고정). 2년 전에 한 번 성공했다는
  기록으로 "지금도 붙어 있다"고 말할 수는 없습니다 — 키는 회수되고 할당량은
  끊깁니다. 창을 두면 판정이 **스스로 낡습니다.**
- **순서 이탈은 말하되 막지 않습니다.** 이미 붙어서 돌아가는 것을 끊으면 잘
  되던 것이 멈추고, 그것은 순서를 지키는 것보다 나쁩니다.

**6. OCR 운영 표준 엔진 (순서의 마지막 단계)**

지금까지 **운영에서 쓸 수 있는 OCR 엔진이 없었습니다.** `mock`은 글자를 읽지
않고 지어내고, `tesseract`는 개발용 선택 엔진입니다(결정 2401-⑤).
`GoogleVisionOcrProvider`(`OCR_PROVIDER=google-vision`)가 그 자리를 채웁니다.

- **신뢰도를 지어내지 않습니다.** Google의 텍스트 감지는 응답에 따라 신뢰도를
  주지 않습니다. 없으면 `null`입니다 — **1.0은 "확신한다"는 거짓이고, 0은
  실패처럼 읽힙니다.** `OcrRecognition.confidence`를 `number | null`로
  넓혔고, 평균 신뢰도 계산이 이미 `null`을 제외하므로 모른다는 사실이 뒤까지
  전달됩니다.
- **오류를 한 덩어리로 뭉치지 않습니다.** 400(이미지) · 401·403(키·API 사용
  설정) · 429(할당량) · 5xx(**우리 설정 문제가 아닙니다**) · JSON 아님
  (엔드포인트)이 각각 사람이 할 일을 말합니다.
- **글자가 없는 이미지는 실패가 아닙니다**(빈 텍스트로 성공). 반대로 형식이
  다른 응답을 빈 텍스트로 넘기지 않습니다 — 그러면 OCR이 성공했다고 기록되고
  **상품이 빈 재료로 조립**됩니다.
- **키를 남기지 않습니다.** 키는 URL 쿼리로 나가므로 로그·오류 문구·`rawJson`
  어디에도 URL을 그대로 쓰지 않습니다(라이브에서 0건 확인).
- **재시도하지 않습니다** — `OcrExecutionService`가 이미 지수 백오프로
  재시도합니다. 여기서 또 하면 횟수가 곱해집니다.

**7. 조용한 mock 대체 제거 (자체 발견 결함)**

> `createOcrProvider`는 **알 수 없는 `OCR_PROVIDER`를 경고 한 줄만 남기고
> mock으로 대체**했습니다. 즉 운영에서 `OCR_PROVIDER=google`(오타·미구현)로
> 뜨면 **가짜 OCR로 서비스가 돌아갑니다.** 이미지에서 읽지도 않은 텍스트로
> 상품이 조립되고, 그 상품이 READY 검수를 통과합니다 — 이 프로젝트에서 가장
> 위험한 조용한 실패입니다.

- 운영에서는 **기동을 차단**합니다(Fail Fast). 개발에서는 경고 후 mock을
  유지합니다 — 개발자의 로컬을 못 뜨게 할 이유는 없고, 그때는 mock이 정상
  기본값입니다.
- `google-vision`을 골랐는데 키가 없으면 **기동 시점에** 실패합니다. 첫 호출까지
  기다리면 그때는 이미 이미지가 올라가 있고, 사용자는 OCR이 되는 줄 압니다.
- 운영에서 `mock`인 것은 **막지 않습니다**(경보와 차단은 다릅니다) — 다만
  로그·환경 검증·`/ops/providers`가 모두 그 사실을 말합니다.

**8. 환경 검증에 OCR·Vision 엔진 편입**

`OCR_PROVIDER`는 **어느 화면에도 없었습니다.** 운영에서 가짜 OCR이 돌아도
환경 검증·대시보드가 침묵했습니다. 이제 등록되어 있습니다:

| 환경변수 | 판정 |
| --- | --- |
| `OCR_PROVIDER` | 운영에서 `mock`이면 경고("사실이 아닙니다"), `tesseract`면 개발용 안내 |
| `GOOGLE_VISION_API_KEY` | `google-vision`일 때 **조건부 운영 필수**(결정 1202-② 방식) · 형식 검사 |
| `GOOGLE_VISION_ENDPOINT` | 공식 주소가 아니면 경고 — **API 키가 그 주소로 전송됩니다** |
| `VISION_PROVIDER` | **더 이상 읽지 않음** — 값이 남아 있으면 경고(조용히 무시하지 않습니다) |

운영 최소 구성(`PRODUCTION_ENV`)에도 OCR 엔진이 들어왔습니다 — 그전에는
**"운영 최소 구성"이 곧 "가짜 OCR로 도는 구성"**이었고 경고가 없었습니다.

## 4. 테스트 결과

| 워크스페이스 | 결과 | 이번 증분 |
| --- | --- | --- |
| `@acos/core` | **780 통과** (61 suites) | +34 |
| `api` | **588 통과** (56 suites) | +42 |
| `web` (Playwright) | **136 통과** | +3 |

**core 신규 — `provider-rollout.spec.ts`(24) · `governance-alert-boundary.spec.ts`(7)
· `env-spec.spec.ts`(+3, 기준선 갱신 1건)**

- 순서: 확정 순서를 **값으로** 고정 · 판정에도 같은 순서 · 근거 기한 30일 고정
- 상태 구분: 키 없음은 **미구성(실패 아님)** · 형식 오류는 invalid(값 미노출) ·
  **형식만 맞으면 연결됨이 아니라 모르는 것** · 성공 기록이 있으면 연결됨(근거
  문구) · **키를 지운 뒤에는 옛 성공 기록으로 연결됨을 유지하지 않음**
- Vision: `LLM_PROVIDER=mock`이면 가짜 · 실 Provider인데 vision 성공 기록이
  없으면 모르는 것(**이미지가 조용히 빠질 수 있다**는 이유까지) · 성공 기록이
  있으면 연결됨
- OCR: 기본 mock("사실이 아닙니다") · tesseract는 **dev-only**(성공 기록은
  숨기지 않음) · 알 수 없는 이름은 invalid + "기동이 차단됩니다" · 키 없음은
  미구성 · 형식만 맞으면 모르는 것
- 다음 단계·순서 이탈: 첫 단계부터 진행 · 앞이 끝나면 다음으로 · **이탈은
  말하되 막지 않음** · 전부 끝나면 다음이 없음
- 경계(유지 결정): 전체·프로젝트별 Alert 둘 다 남아 있음 · 표본 10건이 고정값
  이고 core가 환경을 읽지 않음 · 작성자 알림 흔적 없음
- 환경: 운영 mock OCR 경고 · 개발용 엔진 안내 · **더 이상 읽지 않는
  `VISION_PROVIDER`를 조용히 무시하지 않음**

**api 신규 — `google-vision.provider.spec.ts`(24) · `ocr-provider-selection.spec.ts`(11)
· `provider-production.spec.ts`(+6) · `ops.spec.ts`(+2)**

- 어댑터: 키 없이 **생성 자체가 실패** · 공식 엔드포인트에 TEXT_DETECTION +
  base64 이미지 · 언어 힌트 유무 · 엔드포인트 교체 가능
- 신뢰도: 페이지 평균 사용 · **주지 않으면 `null`(1.0도 0도 아님)** · 범위 밖 값
  가둠
- 응답: 빈 결과는 성공 · **JSON 아님/`responses` 없음/200 속 error/`text`가
  문자열 아님은 실패**(빈 텍스트로 넘기지 않음)
- 오류: 400·401·403·429·5xx·기타가 각각 다른 문구 · 네트워크 실패와 구분
- 키: `describe()`·`raw`·오류 문구·네트워크 실패 문구 어디에도 키 없음
- 재시도: 어댑터는 1회만 호출(실행 계층과 곱해지지 않음)
- 엔진 선택: **운영에서 알 수 없는 값은 기동 차단**(이유까지 문구에) · 개발에서는
  mock 대체 · 운영 표준은 키 있으면 생성/없으면 기동 실패 · 운영 mock은 막지
  않음 · 대소문자·공백 관대
- 연결 판정: 성공 기록 없으면 연결됨 아님 · 있으면 근거 붙음 · **근거를 셀 때
  실패 호출·mock·기간을 조건으로 실제 적용** · Vision은 `vision-analysis`로 셈 ·
  OCR은 실행 이력으로 셈 · 어떤 상태에서도 키 미노출
- API: `GET /ops/providers`가 순서·다음 단계를 돌려주고 **ADMIN 전용**

> **스텁이 결함을 감추지 않게 했습니다.** `groupBy` 목업이 `status: SUCCESS`·
> `provider != mock`·기간 조건을 **실제로 적용**합니다 — 무시하면 "실패한
> 호출도 연결 근거로 세는" 결함이 구조적으로 검증되지 않습니다.

**web e2e 신규 — `production-ops.spec.ts` 3건**

- 단계별 상태와 **다음 단계를 글자로**(색만으로 구분하지 않음)
- **모르는 것을 연결됨으로 보여주지 않음**(확인 안 됨 · 미구성은 "실패가
  아닙니다" · 가짜는 "가짜 텍스트")
- 연결됨에 **근거**가 붙고, 순서 이탈은 "막지는 않습니다"라고 말함

### 라이브 검증 (실 PostgreSQL + 실 Redis + 실 S3 + Google Cloud Vision **계약 스텁**)

| 확인 | 결과 |
| --- | --- |
| **기동 차단 ①** | `OCR_PROVIDER=google` → `알 수 없는 OCR_PROVIDER "google" … 기동을 중단합니다 — 가짜 OCR로 조립된 상품은 사실이 아닙니다` |
| **기동 차단 ②** | `OCR_PROVIDER=google-vision` + 키 없음 → `GOOGLE_VISION_API_KEY가 없습니다` |
| **엔드포인트 경고** | 기동 로그에 `API 키가 그 주소로 전송됩니다 — 의도한 프록시인지 확인하세요` |
| **실 HTTP 경로 OCR** | provider `google-vision` · status `SUCCESS` · 신뢰도 `0.94` · 텍스트 3줄 추출 · attempts 1 |
| **요청 계약** | 스텁이 받은 요청: `hasKey: true` · `features: [{type: TEXT_DETECTION}]` · `imageBytes: 70` · `languageHints: [ko, en]` |
| **오류 5종** | 403 인증 실패 / 429 할당량 / 503 "우리 설정 문제가 아닙니다" / JSON 아님 "엔드포인트 설정" / **빈 결과는 SUCCESS + 빈 텍스트 + 신뢰도 null** |
| **키 유출** | `ocr_results.rawJson`에 키 포함 행 **0건** |
| **`/ops/providers` 4상태** | OpenAI `connected`(근거 "최근 30일 실 호출 성공 7건") · Anthropic `unverified`(형식 OK인데 DB에는 **실패 7건뿐**) · Gemini `not-configured` · Vision `mock` · OCR `connected`(OCR 성공 기록) |
| **순서 이탈** | `outOfOrder: ["ocr"]` + "막지는 않습니다" — 차단 없음 |
| **형식 오류는 기동 차단** | `GEMINI_API_KEY=short` → 환경 검증 실패로 기동 중단(기존 1202 동작 확인) |

**확인하지 못한 것을 분명히 적습니다**: **실제 Google Cloud Vision과 실
OpenAI·Anthropic·Gemini 호출은 검증하지 못했습니다** — 실 키와 외부 네트워크가
필요하고 과금이 발생합니다. 위 검증은 **계약 스텁**(요청/응답 형식을 흉내 낸
로컬 서버)으로 한 것이며, 확인된 것은 요청 형식·응답 파싱·오류 분기·기록이고
**키의 유효성과 Google의 인식 품질은 아닙니다.** 그래서 판정도 그 사실을 그대로
말합니다(`unverified`).

**자체 발견 결함 1건 수정 + 라이브에서 드러난 판정 한계 1건.**

| # | 내용 | 조치 |
| --- | --- | --- |
| ① | **알 수 없는 `OCR_PROVIDER`가 조용히 mock으로 대체**돼 운영에서 가짜 OCR이 돌 수 있었다 | 운영은 기동 차단(Fail Fast), 개발은 경고 후 mock · 회귀 테스트 11건 · 라이브 확인 |
| ② | 근거를 "성공 기록이 있는가"로만 보면 **오래전 성공이 영원히 연결됨을 유지**한다 (라이브에서 옛 시딩 이력으로 OpenAI가 `connected`로 판정됨 — 개발 DB의 실제 상황) | 근거에 **기한(최근 30일)**을 도입해 판정이 스스로 낡게 함 · 근거 문구에 기한 명시 · 테스트로 고정 |

② 의 라이브 판정은 **틀린 것이 아닙니다**(그 DB에는 실제로 openai 성공 기록이
있습니다) — 다만 그 기록이 다른 스프린트의 검증 과정에서 생긴 것이어서, "언제
성공했는가"를 묻지 않는 규칙의 한계가 드러났습니다.

화면: 관리자 → Provider 운영 점검 상단 스크린샷 첨부 — **연결됨·확인 안 됨·
미구성·가짜·다음 단계**가 한 화면에 있습니다.

## 5. 아키텍처 변경 및 현황

```
GET /ops/providers (ADMIN)
   └─ ProviderProductionService.rollout()
        ├─ executions.groupBy(SUCCESS · provider≠mock · 최근 30일)   ← 근거
        ├─ executions.count(feature=vision-analysis · SUCCESS · …)
        ├─ ocr_results.groupBy(SUCCESS · provider≠mock · 최근 30일)
        └─ judgeProviderRollout(env, 근거)          ← core 순수 판정
             ① openai ② anthropic ③ gemini ④ vision ⑤ ocr
             connected / unverified / invalid / not-configured / mock / dev-only

OCR_PROVIDER → createOcrProvider(env)
   ├─ 알 수 없는 값 → **운영: 기동 차단** · 개발: 경고 + mock
   ├─ google-vision → GoogleVisionOcrProvider (키 없으면 생성 실패)
   ├─ tesseract     → 개발용 (운영에서는 표준 아님을 경고)
   └─ mock          → 운영에서는 경고 (차단하지 않는다)

GoogleVisionOcrProvider.recognize()
   ├─ POST images:annotate  TEXT_DETECTION + base64 + languageHints
   ├─ 상태 코드별 오류 분기 (400 / 401·403 / 429 / 5xx / 기타)
   └─ fullTextAnnotation → { text, confidence: number|null, raw(키 없음) }
```

① **"붙었다"는 관찰이지 선언이 아닙니다.** 설정 파일은 의도를 적을 뿐이고,
   실제로 붙었는지는 성공한 호출만 증명합니다.
② **모르는 것에는 이름이 필요합니다.** `unverified`가 없으면 "형식은 맞다"가
   곧 "연결됐다"로 읽히고, 그 순간 대시보드는 거짓이 됩니다.
③ **근거는 낡습니다.** 기한이 없는 증거는 시간이 지나면 증거가 아닙니다.
④ **조용한 대체는 오류보다 나쁩니다.** 오류는 보이지만 대체는 보이지 않고,
   가짜 재료로 만든 결과가 진짜처럼 검수를 통과합니다.
⑤ **엔진 선택은 운영 설정입니다.** 어느 화면에도 없는 설정은 관리되지 않습니다.
⑥ **신뢰도를 지어내면 뒤쪽 판정이 왜곡됩니다.** 모른다는 것도 값입니다.

**유지되는 핵심 결정**: Alert 정책 4종(1302-①) · 보관 90일·삭제 금지
(1302-④·1501-③·2501-⑤) · 자동 폴백 없음(1401-①) · Live Check 기본 꺼짐
(1301-①) · 복원 대상 강제 분리(1601-②) · 백업 1시간 간격(1701-①) ·
Versioning 운영 필수(1701-③) · 요구 삭제 금지(1901-②) · 자동 대조 주 1회
(2001-②) · 스키마는 운영 담당자가(2201-①) · 자동 복구 없음(2201-②) ·
우회 플래그 없음(2201-③) · 복구 판정 단일 원천(2301-①) · **tesseract는 개발용
(2401-⑤)** · 금지어 부분 일치(2501-②) · 규칙 스코프 GLOBAL만(2501-④) ·
증가 시에만 경보(2601-③) · 되살리기 EDITOR 유지(2701-①) · 최초 발행 시각
보존(2701-②) · **전체·프로젝트별 Alert 둘 다 유지(2801-①②)** ·
**표본 10건 고정(2801-③)** · **작성자 직접 알림 없음(2801-④)** ·
`/ops/*` ADMIN 전용

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 38건**
(이번 주기 신규 없음), drift 없음

## 6. 데이터 모델

**이번 주기 마이그레이션 없음.** 스키마는 그대로입니다 —
`ocr_results.confidence`는 이미 nullable(`Float?`)이었고, 이번 변경은 **그
nullable을 실제로 쓰기 시작한 것**입니다(그전에는 항상 숫자가 채워졌고,
Provider가 신뢰도를 주지 않아도 값을 만들어 넣었습니다).

| 기존 컬럼 | 의미가 명확해진 것 |
| --- | --- |
| `ocr_results.confidence` | **`null` = Provider가 신뢰도를 주지 않았다** (0 = "확신이 없다"와 다릅니다) |
| `executions.provider` · `status` · `createdAt` | Provider 연결 판정의 **근거**로 쓰입니다 (최근 30일 성공) |

`OcrRecognition.confidence` 타입을 `number` → `number | null`로 넓혔습니다.
평균 신뢰도 계산(`ProductObjectBuilder`)은 이미 `null`을 제외하고 있었으므로,
모른다는 사실이 상품 조립까지 그대로 전달됩니다.

## 7. API 표면

**새 엔드포인트 1개**:

- `GET /ops/providers` — Provider 연결 순서 현황. **ADMIN 전용**(키 상태가
  드러나는 화면입니다). 응답: `order` · `stages[]`(상태·근거·설정할 환경변수) ·
  `next` · `outOfOrder` · `summary` · `detail`

**새 환경변수**:

| 이름 | 뜻 |
| --- | --- |
| `OCR_PROVIDER` | `mock` · `tesseract`(개발용) · `google-vision`(운영 표준) |
| `GOOGLE_VISION_API_KEY` | `google-vision`일 때 필수 |
| `GOOGLE_VISION_ENDPOINT` | 스테이징 프록시·계약 검증용 (기본은 공식 주소) |
| `OCR_LANGUAGE_HINTS` | 언어 힌트 (기본 `ko,en`) |

**shared DTO 추가**: `ProviderRolloutDto` · `ProviderRolloutStageDto`

**동작이 바뀐 것**:

- `OCR_PROVIDER`에 알 수 없는 값이면 **운영에서 기동이 중단됩니다**(이전에는
  경고 후 mock). 개발 환경은 그대로입니다.
- `POST /images/:id/ocr`의 `confidence`가 **`null`일 수 있습니다** — Provider가
  주지 않는 경우입니다(스키마는 이미 nullable이었습니다).

## 8. 리스크·기술 부채

1. **2901 해석 미확인** — 실키 확보 경로·OCR 엔진 선택·근거 기한
   (CTO_REQUEST #62)
2. **실 Provider 호출은 여전히 미검증입니다** — OpenAI·Anthropic·Gemini·
   Google Cloud Vision 모두 실 키가 없고 외부 네트워크가 차단되어 있습니다.
   이 저장소에서 확인할 수 있는 것은 **계약**까지입니다(#62 ①)
3. **OCR 엔진을 Google Cloud Vision 하나로 골랐습니다** — 포트 문서가 언급한
   Azure·Textract·CLOVA는 만들지 않았습니다. 한국어 상품 라벨이 주 대상이라
   CLOVA가 더 나을 수 있고, 그 판단은 실측이 필요합니다(#62 ②)
4. **근거 기한 30일은 고정값입니다** — 환경변수로 열지 않았습니다(열면 "길게
   잡아 두는" 우회가 생깁니다). 호출이 드문 운영에서는 붙어 있는데도
   `unverified`로 보일 수 있습니다(#62 ③)
5. **`GOOGLE_VISION_ENDPOINT`는 키가 전송되는 주소를 바꿉니다** — 운영에서
   공식 주소가 아니면 경고하지만 **막지는 않습니다.** 계약 검증·프록시를
   위해 남겨 두었습니다
6. **OCR 신뢰도가 `null`이면 READY 검수는 그 항목을 판정에서 제외합니다** —
   평균이 null이 되는 경우 검수 기준이 약해질 수 있습니다. 현재는 "모른다"를
   통과로 세지 않는 쪽이 안전하다고 판단했습니다
7. **Vision은 실 Provider를 붙여도 이미지 첨부가 조용히 빠질 수 있습니다** —
   세 Provider의 형식을 테스트로 고정했지만(TASK-1301), 라이브 확인은 실 키가
   필요합니다
8. **운영 저장소가 아직 S3가 아닙니다** — 전환은 운영 담당자 몫(결정 2101-④)
9. **백업 성능 기준은 개발 규모에서만 검증됐습니다**(결정 1901-④ 대기)
10. **GitHub Actions 실제 실행은 확인하지 못했습니다** — 워크플로 순서는
    테스트로 고정했습니다

## 9. 다음 권장 사항 (Sprint 29 후속 후보)

1. **CTO_REQUEST #62 확인** — TASK-2901 해석 확인 및 다음 지시
2. **실 키 확보와 스테이징 스모크** — 순서 ①부터 실제로 붙이는 작업.
   `/ops/providers`가 `connected`로 바뀌는 것이 완료 판정입니다(#62 ①)
3. **OCR 엔진 선택 확정** — Google Cloud Vision을 표준으로 둘지, 한국어
   라벨에 CLOVA를 검토할지(#62 ②)
4. **Vision 실 Provider 확인** — 이미지가 실제로 첨부되는지 라이브 1회
5. **OCR 비용 관측** — LLM처럼 OCR 호출도 비용이 발생합니다. 지금은 예산·
   모니터링 대상이 아닙니다
6. **Amazon S3 전환 실행** — 완료 판정 기준은 TASK-2401에서 확정됨
