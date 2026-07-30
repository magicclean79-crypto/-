# AI 비용 거버넌스 (TASK-3101)

단가는 **돈의 기준**입니다. 코드 한 줄을 고쳐 바로 반영하면 ⓐ 누가 왜 바꿨는지
남지 않고 ⓑ 예산·리포트의 숫자가 **어느 시점부터** 달라졌는지 아무도 설명할 수
없습니다. 그래서 CTO 정책 3101이 네 가지를 정했습니다.

| 정책 | 내용 | 코드에서 |
| --- | --- | --- |
| 3101-① | 가격표는 **검토 → 승인 → 적용** 절차를 거친다 | `PRICING_TRANSITIONS`, `POST /ops/pricing/:id/{review,approve,apply,reject}` |
| 3101-② | 비용 기록은 수정하지 않는다 (**Append Only**) | `resolvePricingAt`(시점별 대조), `pricing/append-only.spec.ts` |
| 3101-③ | Forecast는 참고자료다 — **Budget Gate는 실제 비용만** 본다 | `cost-forecast.ts`(차단 경로가 이 파일을 모른다) |
| 3101-④ | Billing Report는 운영 지표다 — **회계 청구서가 아니다** | `BILLING_DISCLAIMER` |

화면은 **관리자 → AI 비용 관리**(`/admin/costs`)입니다. 모두 ADMIN 전용입니다.

## 1. 가격표를 바꾸는 절차 (정책 3101-①)

```bash
# ① 제안 — 사유 없이는 등록되지 않습니다
curl -X POST "http://<api-host>/ops/pricing" -b cookies.txt \
  -H 'content-type: application/json' \
  -d '{"target":"ocr","key":"google-vision","price":{"perUnitUsd":0.002},
       "reason":"2026-07 Google Cloud Vision 단가 공지 반영"}'

# ② 검토 → ③ 승인 → ④ 적용 (순서를 건너뛸 수 없습니다)
curl -X POST "http://<api-host>/ops/pricing/<id>/review"  -b cookies.txt
curl -X POST "http://<api-host>/ops/pricing/<id>/approve" -b cookies.txt
curl -X POST "http://<api-host>/ops/pricing/<id>/apply"   -b cookies.txt

# 어느 단계에서든 반려 — 사유가 필요합니다
curl -X POST "http://<api-host>/ops/pricing/<id>/reject" -b cookies.txt \
  -H 'content-type: application/json' -d '{"reason":"공지 원문 확인 필요"}'
```

지금 무슨 단가로 계산하는지, 그 단가가 **누구의 승인으로** 적용된 것인지:

```bash
curl "http://<api-host>/ops/pricing" -b cookies.txt
```

### 규칙과 그 이유

| 규칙 | 왜 |
| --- | --- |
| **검토 없이 승인·승인 없이 적용 불가** | 단가는 돈의 기준이다 — 한 사람의 오타가 예산 전체를 흔든다 |
| **적용·반려는 끝이다** (되돌릴 수 없다) | 끝난 것을 되살리면 "무엇이 언제 적용됐는가"의 이력이 흐려진다 — 되돌리려면 **새 제안**을 낸다 |
| **사유 필수** (제안·반려 모두) | 사유가 없으면 이력이 있어도 판단을 복원할 수 없고, 제안자는 무엇을 고칠지 모른다 |
| **0은 허용, 음수는 거부** | 무료 모델·엔진은 실제로 있다. 음수 단가는 지출을 줄여 **예산 상한을 무력화**한다 |
| **적용만 계산을 바꾼다** | 승인은 "적용해도 된다"는 뜻이다. 적용 시각이 있어야 "언제부터 이 단가로 계산됐나"에 답할 수 있다 |
| 제안자 = 승인자면 **경고만** | 운영자가 한 명인 환경에서 절차가 막히면 사람은 코드를 고쳐 우회하고, 그러면 이력이 아예 없어진다 (결정 2601-① 교훈) |

적용된 단가는 **이후 호출**에만 쓰입니다. 실효 가격표는 짧게 캐시되므로
(`PRICING_CACHE_TTL_MS`, 30초) 다중 인스턴스에서는 최대 30초 안에 모두 따라옵니다
— 적용한 인스턴스는 즉시 반영합니다.

## 2. 과거 기록은 다시 계산하지 않습니다 (정책 3101-②)

단가를 바꿔도 이미 기록된 `Execution.cost` · `OcrResult.cost`는 **그대로**입니다.
대신 비용 검증(`GET /llm/cost-verification`)이 **그 시점에 유효했던 단가**로
대조합니다.

그러지 않으면 단가를 한 번 바꿀 때마다 **과거 전체가 "불일치"로 보고**되고, 그런
경보는 곧 무시됩니다. 무시되는 경보는 없는 경보보다 나쁩니다.

경계는 테스트로 고정돼 있습니다(`apps/api/src/pricing/append-only.spec.ts`):
비용 컬럼을 갱신하는 코드가 생기면 테스트가 깨집니다.

## 3. 예측은 참고자료입니다 (정책 3101-③)

```bash
curl "http://<api-host>/ops/cost-forecast" -b cookies.txt
```

- 방식은 **하루 평균 × 이번 달 일수**(UTC)입니다. 정교한 모델을 쓰지 않은
  이유는 표본이 며칠뿐인 구간에서 정교한 모델이 **더 그럴듯하게 틀리기**
  때문입니다.
- 관측이 **3일**(`FORECAST_MIN_DAYS`, 고정값) 미만이면 **숫자를 만들지
  않습니다** — 이틀 관측으로 월말을 말하면 그것은 예측이 아니라 짐작이고,
  짐작을 화면에 숫자로 띄우면 사람은 그것을 사실로 다룹니다.
- 이 값으로 **호출을 막지 않습니다.** 예측으로 차단하면 아직 쓰지 않은 돈
  때문에 서비스가 멈추고, "왜 막혔나"에 답할 수도 없습니다. 차단은 실제 지출을
  보는 `assertWithinBudget`만 합니다.
- 비용이 빠진 호출(미산정)이 있으면 **추정도 실제보다 작을 수 있다**고 함께
  말합니다.

`projectedExceeds`가 true여도 그것은 **표시**입니다. 예산 상향 판단의 재료이고,
차단 여부와는 무관합니다.

## 4. 운영 비용 리포트 (정책 3101-④)

```bash
curl "http://<api-host>/ops/billing?from=2026-07-01&to=2026-07-31" -b cookies.txt
```

기본 기간은 **이번 달**(UTC — 예산 창과 같은 경계), 최대 366일입니다. 정렬은
비용 큰 것부터입니다 — 리포트를 여는 이유는 대개 "무엇이 돈을 쓰는가"입니다.

**이 리포트는 회계 청구서를 대체하지 않습니다.** 실제 청구와 다를 수 있는
이유가 최소 넷입니다:

| 이유 | 방향 |
| --- | --- |
| **미산정** (가격표에 없는 모델·엔진 → `cost`가 null) | 우리 총액이 **작다** |
| **실패한 호출** (Provider에 따라 과금될 수 있는데 적지 않는다) | 우리 총액이 **작다** |
| **무료 구간** (반영하지 않는다 — TASK-3001) | 우리 총액이 **크다** |
| **환율·세금·단가 변동** | 청구서에는 있고 우리에게는 없다 |

그래서 응답과 화면에 **항상** 면책 문구가 붙습니다. 숫자만 있으면 누군가 그것을
청구서로 다루고, 회계와 어긋나는 순간 리포트 전체가 신뢰를 잃습니다.

미산정이 0이 아니면 "합계는 실제보다 작습니다"라고 명시합니다 — 침묵하면
작은 총액이 사실로 읽힙니다.

## 5. 관련 문서

| 문서 | 내용 |
| --- | --- |
| [provider-rollout.md](provider-rollout.md) | Provider 연결 순서 · AI 비용 예산·관측 (§4) |
| [../architecture/execution.md](../architecture/execution.md) | Execution 원장 구조 |
| [../architecture/ocr.md](../architecture/ocr.md) | OCR Port/Adapter · 비용 기록 |
