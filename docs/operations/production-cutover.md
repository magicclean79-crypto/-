# 운영 전환 검증 (TASK-3401, Sprint 34 — CTO 지시 4·5·6)

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

**`not-production`을 `verified`로 세지 않습니다.** 이 한 줄이 전부입니다.
그리고 **하나라도 `verified`가 아니면 `ready`는 false**입니다 — 운영 전환에
부분 점수는 없습니다: 스텁 하나가 남아 있으면 그 경로의 결과는 여전히 사실이
아닙니다.

근거(`evidence`)가 없으면 통과시키지 않습니다. 성공 기록은 **최근 30일**까지만
근거로 인정합니다(`ROLLOUT_EVIDENCE_WINDOW_DAYS`) — 오래전 한 번의 성공으로
"지금도 붙어 있다"고 말할 수 없습니다.

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
`pnpm typecheck` → `pnpm lint` → `pnpm test`.
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
