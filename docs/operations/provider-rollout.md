# Provider 연결 순서 (실 AI 연결, TASK-2901)

CTO가 실제 Provider 연결 순서를 확정했습니다 (결정 2801-⑤):

```
① OpenAI → ② Anthropic → ③ Gemini → ④ Vision → ⑤ OCR
```

이 순서는 코드에 **값으로** 있습니다(`PROVIDER_ROLLOUT_ORDER`) — 순서가
문서에만 있으면 "지금 어디까지 붙었고 다음에 무엇을 붙여야 하는가"에 아무도
답할 수 없고, 그러면 각자 편한 것부터 붙입니다.

지금 상태는 한 번에 볼 수 있습니다:

```bash
curl "http://<api-host>/ops/providers" -b cookies.txt   # ADMIN 전용
```

화면은 **관리자 → Provider 운영 점검**(`/admin/production`) 상단입니다.

## 1. 단계별 상태가 뜻하는 것

| 상태 | 뜻 | 사람이 할 일 |
| --- | --- | --- |
| `not-configured` | **아직 붙이지 않았다** — 실패가 아닙니다 | 키를 설정합니다 |
| `unverified` | 설정은 됐지만 **실제로 붙는지는 모릅니다** | 실호출 1회로 확인합니다 |
| `invalid` | 키 형식이 틀렸거나 플레이스홀더입니다 | 값을 고칩니다 (운영 기동이 막힙니다) |
| `connected` | 그 Provider로 **성공한 실행 기록이 있습니다** | 다음 단계로 갑니다 |
| `mock` | **가짜가 돌고 있습니다** — 결과는 나오지만 사실이 아닙니다 | 실 엔진을 붙입니다 |
| `dev-only` | 개발용 선택 엔진입니다 (결정 2401-⑤) | 운영 표준으로 바꿉니다 |

**`unverified`를 `connected`로 세지 않습니다.** 키 형식이 맞다는 것은 오타가
없다는 뜻일 뿐입니다. 그것을 연결 완료로 세면 **붙지 않은 시스템이 붙은
것처럼 보고**됩니다.

### 연결됨의 근거는 선언이 아니라 사실입니다

`connected`는 **성공한 실행 기록**이 있을 때만 붙습니다:

| 단계 | 근거 |
| --- | --- |
| OpenAI · Anthropic · Gemini | `executions`의 성공 기록 (mock 제외 · 진단 호출 포함) |
| Vision | `feature=vision-analysis` 성공 기록 |
| OCR | `ocr_results`의 성공 기록 |

그 근거에는 **기한**이 있습니다 — 최근 **30일**입니다(고정값). 2년 전에 한 번
성공했다는 기록으로 "지금도 붙어 있다"고 말할 수는 없습니다. 호출이 멈추면
얼마 뒤 `unverified`로 돌아가고, 그것이 정직한 답입니다.

### 순서를 벗어난 진행은 막지 않습니다

앞 단계가 끝나지 않았는데 뒤 단계가 붙어 있으면 `outOfOrder`에 담아
**사실만 말합니다.** 이미 붙어서 돌아가는 것을 끊으면 잘 되던 것이 멈추고,
그것은 순서를 지키는 것보다 나쁩니다 — 경보와 차단은 다릅니다.

## 2. 단계별로 붙이는 방법

### ①②③ OpenAI · Anthropic · Gemini

```bash
OPENAI_API_KEY=sk-...          # ① (LLM_PROVIDER=openai로 기본 지정)
ANTHROPIC_API_KEY=sk-ant-...   # ②
GEMINI_API_KEY=...             # ③
```

- 키 형식이 틀리면 **기동이 막힙니다**(TASK-1202) — 쓰지 않는 Provider의 키도
  형식은 맞아야 합니다.
- 붙었는지 확인: `POST /ops/checks/run?job=provider-smoke`(실호출 = 과금,
  기본은 꺼짐) 또는 실제 생성 1회.

### ④ Vision — 별도 키가 없습니다

Vision은 **LLM Gateway를 그대로 탑니다**(TASK-0505). 그래서 앞의 세 단계 중
하나가 붙어 있어야 하고, `VISION_PROVIDER`는 **더 이상 읽지 않습니다**
(값이 남아 있으면 환경 검증이 그 사실을 경고합니다).

```bash
LLM_PROVIDER=openai
LLM_MODEL_VISION=gpt-4o     # 선택 — 미지정이면 Provider 기본 모델
```

**이미지 첨부 형식은 Provider마다 다릅니다**(OpenAI는 data URL, Anthropic은
base64 content block, Gemini는 inlineData). 하나만 틀려도 **이미지가 조용히
빠지고 "이미지 없이 추측한 결과"가 정상처럼 기록됩니다.** 그래서 Vision은
반드시 실제 상품 조립을 1회 돌려 확인합니다.

### ⑤ OCR — 운영 표준은 Google Cloud Vision

```bash
OCR_PROVIDER=google-vision
GOOGLE_VISION_API_KEY=AIza...
OCR_LANGUAGE_HINTS=ko,en          # 선택 (기본 ko,en)
```

| 값 | 성격 |
| --- | --- |
| `google-vision` | **운영 표준** — Google Cloud Vision `images:annotate`(TEXT_DETECTION) |
| `tesseract` | 개발용 선택 엔진 (CTO 결정 2401-⑤) — 운영 연결로 세지 않습니다 |
| `mock` | 개발 기본 — **글자를 읽지 않고 지어냅니다** |

**알 수 없는 값은 조용히 mock으로 대체되지 않습니다.** 운영에서는 기동이
중단됩니다:

```
알 수 없는 OCR_PROVIDER "google" — 구현된 엔진은 mock, tesseract, google-vision입니다.
운영에서는 mock으로 대체하지 않고 기동을 중단합니다 — 가짜 OCR로 조립된 상품은 사실이 아닙니다.
```

`google-vision`을 골랐는데 키가 없으면 **기동 시점에** 실패합니다 — 첫 호출까지
기다리면 그때는 이미 이미지가 올라가 있고, 사용자는 OCR이 되는 줄 압니다.

붙었는지 확인:

```bash
curl -X POST "http://<api-host>/uploads/images" -F "files=@사진.jpg" -b cookies.txt
curl -X POST "http://<api-host>/images/<imageId>/ocr" -b cookies.txt
```

#### 신뢰도를 지어내지 않습니다

Google의 텍스트 감지는 응답에 따라 신뢰도를 주지 않습니다. 그때
`confidence`는 **`null`**입니다 — 1.0으로 채우면 "확신한다"는 거짓이고,
0으로 채우면 실패처럼 읽힙니다. 평균 신뢰도 계산은 `null`을 제외하므로
모른다는 사실이 뒤까지 그대로 전달됩니다.

#### 오류를 한 덩어리로 뭉치지 않습니다

| 상태 | 문구 | 사람이 할 일 |
| --- | --- | --- |
| 400 | 요청 거절 | 이미지 형식·크기 확인 |
| 401 · 403 | 인증 실패 | 키 확인 · Cloud Vision API 사용 설정 |
| 429 | 할당량 초과 | 잠시 후 재시도 · 한도 상향 |
| 5xx | Google 장애 | **우리 설정 문제가 아닙니다** |
| JSON 아님 | 응답을 읽을 수 없음 | 엔드포인트 설정 확인 |

**글자가 없는 이미지는 실패가 아닙니다** — 빈 텍스트로 성공합니다. 반대로
형식이 다른 응답을 빈 텍스트로 넘기지 않습니다: 그러면 OCR이 성공했다고
기록되고 상품이 빈 재료로 조립됩니다.

#### 엔드포인트를 바꿀 때 (스테이징 프록시)

```bash
GOOGLE_VISION_ENDPOINT=https://proxy.example.com/v1/images:annotate
```

**API 키는 쿼리에 실려 그 주소로 전송됩니다.** 운영에서 공식 주소가 아니면
환경 검증이 경고합니다 — 의도한 프록시인지 반드시 확인하십시오.

## 3. 지금까지 확인한 것과 확인하지 못한 것

| 항목 | 상태 |
| --- | --- |
| 요청 계약(base64 이미지 · TEXT_DETECTION · 언어 힌트) | **계약 스텁으로 확인** |
| 응답 파싱 · 신뢰도 · 빈 이미지 | **확인** |
| 상태 코드별 오류 문구(403 · 429 · 5xx · JSON 아님) | **확인** |
| 키가 기록·로그·오류 문구에 남지 않음 | **확인** |
| 알 수 없는 엔진·키 없음에서 기동 차단 | **확인** |
| **실제 Google Cloud Vision 응답 품질과 키 유효성** | **미확인** — 실 키와 외부 네트워크가 필요합니다 |
| **실 OpenAI·Anthropic·Gemini 호출** | **미확인** — 실 키 필요 (과금) |

마지막 두 줄은 **이 저장소에서 확인할 수 없습니다.** 그래서 `/ops/providers`가
`unverified`로 남기고, 운영자가 실호출로 확인해야 `connected`가 됩니다.

## 4. 관련 문서

| 문서 | 내용 |
| --- | --- |
| [../architecture/ocr.md](../architecture/ocr.md) | OCR Port/Adapter 구조 |
| [../architecture/vision.md](../architecture/vision.md) | Vision 엔진 구조 |
| [deployment-checklist.md](deployment-checklist.md) | 배포 게이트 (환경 검증 포함) |
| [production-runbook.md](production-runbook.md) | 배포 실행 절차 |
