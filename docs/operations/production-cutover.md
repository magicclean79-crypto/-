# 운영 전환 검증 (TASK-3401 · 3501, Sprint 34~35)

> **지금 붙어 있는 상대가 진짜인가.**
> 연결 순서(`/ops/providers`)가 "어디까지 붙였는가"에 답한다면, 이 문서는
> **"붙은 상대가 Provider였는가, 우리 스텁이었는가"** 에 답합니다.

## 0. 왜 이 판정이 따로 필요한가

우리는 라이브 검증에서 **계약 스텁**을 씁니다 — Vision 스텁(:9100), 가격 공지
스텁(:9200), s3rver(:9000). 스텁은 좋은 도구입니다: 계약이 맞는지 결정적으로
확인할 수 있고, 남의 서비스에 돈을 쓰지 않습니다.

문제는 **성공 기록이 남는다**는 것입니다. 연결 순서 판정(TASK-2901)은 "그
Provider로 성공한 실행 기록이 있으면 `connected`"입니다. 그 기록이 스텁을
상대로 만들어졌다면, 화면은 **연결되지 않은 시스템을 연결됐다고 보고**합니다.

실제로 TASK-3401 라이브 검증 시작 시점의 이 저장소가 그 상태였습니다.

```
/ops/providers  →  ocr = connected  ("최근 30일 OCR 실행 성공 22건")
실제            →  그 22건은 전부 127.0.0.1:9100(우리 스텁)을 상대로 만들어짐
```

**스텁이 결함을 감추면 안 됩니다.** 그래서 판정에 **상대**를 넣었습니다.

## 1. 판정 (`GET /ops/cutover`, ADMIN 전용)

| 판정 | 뜻 |
| --- | --- |
| `verified` | 공식 주소로 최근 성공 기록이 있다 — 운영 전환이 **사실**이다 |
| `not-production` | 돌고는 있지만 **운영의 그것이 아니다** (가짜·스텁 주소·개발용 엔진) |
| `unverified` | 설정은 됐는데 **성공 기록이 없다** — 붙는지 모른다 |
| `not-configured` | 아직 붙이지 않았다 — **실패가 아니다** |
| `invalid` | 설정이 잘못됐다 |
| `unreachable` | 공식 주소에 **닿지 못한다** — 자격 증명 이전의 문제다 |

**`not-production`을 `verified`로 세지 않습니다.** 이 한 줄이 전부입니다.
그리고 **하나라도 `verified`가 아니면 `ready`는 false**입니다 — 운영 전환에
부분 점수는 없습니다: 스텁 하나가 남아 있으면 그 경로의 결과는 여전히 사실이
아닙니다.

근거(`evidence`)가 없으면 통과시키지 않습니다. 성공 기록은 **최근 30일**까지만
근거로 인정합니다(`ROLLOUT_EVIDENCE_WINDOW_DAYS`) — 오래전 한 번의 성공으로
"지금도 붙어 있다"고 말할 수 없습니다.

## 1.1 도달 점검 — 자격 증명 이전의 조건 (TASK-3501, CTO 지시 2·3)

**키를 받아 넣어도 방화벽·프록시가 그 주소를 막고 있으면 전환은 되지
않습니다.** 그리고 그때 나오는 오류는 **키 문제처럼** 보입니다 — 사람은
있지도 않은 키 문제를 몇 시간씩 찾습니다.

그래서 판정 전에 **지금 설정이 가리키는 공식 주소에 닿아 봅니다.**

| 무엇을 보는가 | 판정 |
| --- | --- |
| 200·401·403·404 등 응답이 왔다 | **닿음** — 권한은 다른 판정이 본다 |
| 연결 거부·타임아웃·프록시 차단 | **닿지 못함** → `unreachable` |
| 점검 대상이 없다(`mock` 등) | 판정에 쓰지 않는다 |

두 가지를 지킵니다.

- **인증 실패도 "닿은 것"입니다.** 우리가 보려는 것은 "이 주소까지 패킷이
  가는가"입니다. 키 유효성과 섞으면 "키가 없어서 401"과 "방화벽이 막아서
  실패"가 같은 빨간색이 되고, 그 순간 이 점검은 쓸모가 없어집니다.
- **자격 증명을 보내지 않습니다** — 도달만 보면 되고, 키를 보내면 그 요청이
  과금될 수도 있습니다.

> 실제로 TASK-3501 검증 환경에서 `api.openai.com`이 프록시에 막혀
> 있었습니다(`CONNECT tunnel failed, response 403`). 키를 넣어 보기 전에는
> 드러나지 않았을 사실입니다.

## 1.2 명령 한 줄로 확인하기

```bash
API_BASE=https://<api-host> GATE_EMAIL=... GATE_PASSWORD=... \
  pnpm cutover
```

| 종료 코드 | 뜻 |
| --- | --- |
| 0 | 운영 전환이 끝났다 |
| 1 | 아직 끝나지 않았다 (남은 항목과 다음 할 일을 출력한다) |
| **2** | **판정 불가** — 확인하지 못한 것은 통과가 아닙니다 |

이 스크립트는 전환을 **수행하지 않고 확인만** 합니다. 자격 증명을 넣어 주거나
판정을 통과시키는 우회로는 두지 않았습니다.

## 1.3 승인된 정책 (CTO 정책 3501-①~⑤)

| 정책 | 내용 |
| --- | --- |
| **3501-①** | 실 Provider 전환은 **운영·Staging에서** 수행한다 — 개발에서는 판정을 참고용으로 두고 재촉하지 않는다 |
| **3501-②** | 공지가 밝힌 발효 시각을 **예약 기본값**으로 자동 입력한다 (운영자 수정 가능) |
| **3501-③** | 최종 승인자는 **다른 ADMIN**으로 유지한다 |
| **3501-④** | `executions`·`ocr_results`에 **Provider · Endpoint · Base URL · 호출 시각**을 기록한다 |
| **3501-⑤** | `verified` 판정은 **실제 호출 대상 정보를 근거로** 한다 |

### 개발에서는 재촉하지 않습니다 (정책 3501-①)

개발에서 상시 빨간색을 띄우면 사람은 그 빨간색을 무시하게 되고, **정작
운영에서 떴을 때도 무시합니다.** 그래서 `NODE_ENV`가 `production`·`staging`이
아니면 화면과 `pnpm cutover`가 "이 환경은 전환 대상이 아닙니다"라고 말하고
종료 코드 0으로 끝냅니다. **판정 자체는 감추지 않습니다** — 항목별 상태는
그대로 보여 주고 참고용이라는 사실만 덧붙입니다.

### 근거는 기록에서 옵니다 (정책 3501-④·⑤)

호출할 때 **그 자리에서** 대상을 남깁니다. 나중에 환경변수를 다시 읽어
추정하면, 그 사이에 설정이 바뀐 경우 과거를 잘못 설명하게 되고 **그 잘못된
설명이 "전환 완료" 판정의 근거**가 됩니다(TASK-3501에서 실제로 그럴
뻔했습니다).

```
executions / ocr_results
  provider   openai
  endpoint   https://api.openai.com
  baseUrl    https://api.openai.com     ← 판정은 이 값을 본다
  calledAt   2026-07-30T22:41:03.000Z
```

- **`baseUrl`이 공식 주소인 성공만** `verified`의 근거가 됩니다.
- 옛 기록은 `null`이고, **`null`은 "공식이었다"가 아니라 "모른다"** 입니다.
- 성공은 있는데 공식 주소로 만든 것이 없으면 그 사실을 그대로 말합니다:
  "최근 성공한 OCR 23건이 있지만 공식 주소로 만들어진 것은 없습니다."

## 2. 네 항목

### 2.1 LLM (CTO 지시 4)

`LLM_PROVIDER`가 `mock`이면 `not-production`입니다 — 결과는 나오지만 Provider를
부르지 않습니다.

주의할 것은 **`OPENAI_BASE_URL` · `ANTHROPIC_BASE_URL`** 입니다. 우리 코드는 이
값을 읽지 않지만 **공식 SDK가 읽습니다** — 우리가 모르는 사이에 상대가 바뀔 수
있는 창구입니다. 이 값이 공식 호스트가 아니면 성공 기록이 아무리 많아도
`not-production`입니다.

| Provider | 키 | 공식 호스트 | 주소 재정의 |
| --- | --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `api.openai.com` | `OPENAI_BASE_URL` |
| Anthropic | `ANTHROPIC_API_KEY` | `api.anthropic.com` | `ANTHROPIC_BASE_URL` |
| Gemini | `GEMINI_API_KEY` | `generativelanguage.googleapis.com` | (없음) |

### 2.2 Google Cloud Vision (CTO 지시 4)

`OCR_PROVIDER=google-vision` + `GOOGLE_VISION_API_KEY` + **공식 주소**
(`vision.googleapis.com`) + 최근 성공 기록 → `verified`.

- `mock` → `not-production` (글자를 읽지 않습니다 — 그 텍스트로 조립된 상품은
  사실이 아닙니다)
- `tesseract` → `not-production` (글자는 읽지만 운영 표준이 아닙니다 —
  CTO 결정 2401-⑤)
- `GOOGLE_VISION_ENDPOINT`가 우리 컴퓨터/사설망 → `not-production`

전환 절차:

```bash
# 1) Google Cloud 콘솔에서 Vision API 사용 설정 + API 키 발급
export OCR_PROVIDER=google-vision
export GOOGLE_VISION_API_KEY=<발급한 키>
unset GOOGLE_VISION_ENDPOINT        # 공식 주소로 되돌린다
# 2) 이미지 1장으로 실제 호출 1회
curl -X POST http://localhost:4000/images/<id>/ocr -b cookies.txt
# 3) 확인
curl http://localhost:4000/ops/cutover -b cookies.txt
```

### 2.3 Amazon S3 (CTO 지시 5)

절차 자체는 [s3-migration.md](s3-migration.md)에 있습니다. 이 판정이 추가로
막는 것은 **어중간한 전환**입니다.

- `S3_ENDPOINT` 미설정 → `not-configured` (개발 기본값 `localhost:9000`으로
  돕니다 — 아직 전환하지 않은 상태이며 실패가 아닙니다)
- `localhost`·MinIO·s3rver → `not-production`
- 주소는 Amazon인데 **자격 증명이 비었거나 `minioadmin`** → `invalid`
  (이 상태의 인증 실패는 "S3 장애"처럼 보입니다)
- **이미지 버킷과 백업 버킷이 같음** → `invalid` (그 버킷이 사라지면 이미지와
  백업이 함께 사라집니다 — CTO 결정 1701-②)
- 주소·자격 증명은 맞는데 **버킷에 닿지 못함** → `invalid` (IAM `s3:ListBucket`)
- 접근 점검 결과 자체가 없음 → `unverified` (설정과 접근 가능은 다릅니다)

### 2.4 GitHub Actions (CTO 지시 6)

**파일에 적혀 있는 것**과 **초록으로 끝나는 것**은 다른 사실입니다. 그래서 둘을
따로 봅니다.

| 판정 | 보는 것 |
| --- | --- |
| `judgeCiWorkflow` | 워크플로 **파일** — 필수 게이트가 순서대로 있는가 |
| `judgeCiRuns` | 최근 **실행 결과** — 그 게이트가 실제로 초록인가 |

필수 게이트(순서 고정): `pnpm build` → `pnpm check:major-migrations` →
`pnpm check:ci-gates` → `pnpm typecheck` → `pnpm lint` → `pnpm test`.
교차 검증이 build 뒤인 이유는 검증 로직이 `@acos/core`에 있어 빌드 산출물이
필요하기 때문입니다(CTO 결정 2101-③).

**실행 이력이 없으면 `unverified`입니다** — "실패한 적이 없다"와 "한 번도 안
돌았다"를 같은 초록으로 보여 주면, 아무도 CI를 켜지 않은 저장소가 가장
건강해 보입니다.

```bash
export GITHUB_REPOSITORY=<owner>/<repo>
export GITHUB_TOKEN=<비공개 저장소일 때만>
```

미설정이면 이력을 읽지 않고 **모르는 것으로 둡니다**(통과로 세지 않습니다).

**게이트가 게이트를 검증합니다** (TASK-3501, CTO 지시 4). 워크플로에서 게이트
한 줄이 사라져도 CI는 여전히 초록으로 끝납니다 — 없어진 검사는 실패하지 않기
때문입니다. TASK-3401에서 본 실패의 다른 얼굴입니다: 그때는 게이트가 적혀
있는데 돌지 않았고, 이번에 막는 것은 **적혀 있지도 않게 되는 것**입니다.
`pnpm check:ci-gates`가 워크플로 파일을 읽어 필수 게이트·순서·브라우저 설치
단계를 확인하고, **그 단계 자체가 워크플로 안에** 있습니다.

안정화도 함께 했습니다: 같은 브랜치의 앞선 실행을 접고(`cancel-in-progress`),
작업 시간 상한(20분)을 두고, 권한을 `contents: read`로 좁혔습니다.

## 3. 이 판정이 실제로 잡은 것 (TASK-3401)

| 발견 | 사실 |
| --- | --- |
| OCR "연결됨" | 성공 22건이 전부 **Vision 계약 스텁**을 상대로 만들어짐 |
| CI 초록 아님 | GitHub Actions **13회 실행이 전부 실패** — 러너에 Playwright 브라우저가 없어 `pnpm test`가 통째로 죽고 있었음 |
| TypeScript 게이트 | CTO가 매 TASK 요구하는 게이트인데 **워크플로에 없었음** |

두 번째가 특히 중요합니다. 우리는 매 TASK "게이트 전부 통과"를 보고해 왔지만,
그것은 **로컬에서만** 통과한 것이었습니다. 로컬에서만 통과하는 게이트는
게이트가 아닙니다.

## 4. Live Verification은 CI에서 돌리지 않습니다

실 PostgreSQL·Redis·S3와 실 Provider 자격 증명이 필요하고, 그것을 CI에 넣으면
**남의 서비스에 돈이 나가는 테스트가 매 푸시마다** 돕니다(CTO 결정 1301-① 계열).
Live Verification은 사람이 돌리고 보고서에 남깁니다.

## 5. 관련 문서

- [s3-migration.md](s3-migration.md) — Amazon S3 전환 절차
- [real-provider-smoke.md](real-provider-smoke.md) — 실 Provider 스모크
- [deployment-checklist.md](deployment-checklist.md) — 배포 체크리스트
- [ai-cost-governance.md](ai-cost-governance.md) — 가격 공지·감지
