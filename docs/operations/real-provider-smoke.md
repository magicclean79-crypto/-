# 실제 Provider 스모크 테스트 절차 (TASK-0703 · Production 확장 TASK-0901)

**운영/스테이징 환경**에서 실제 LLM Provider(OpenAI 등) 연결을 검증하는
공식 절차다 — CTO 결정(TASK-0603 승인 ④): 실키 검증은 운영/스테이징에서
수행한다 (개발 환경은 egress 제한).

## 사전 조건 — OpenAI Production 환경 세트 (TASK-0901)

| 항목 | 값 |
| --- | --- |
| Provider | `LLM_PROVIDER=openai` + `OPENAI_API_KEY=<실키>` (선택: `LLM_OPENAI_MODEL`, 기본 gpt-4o) |
| 출력 상한 | 선택: `LLM_CONTENT_MAX_TOKENS`(4096) · `LLM_ANALYSIS_MAX_TOKENS`(2048) · `LLM_VISION_MAX_TOKENS`(2048) — 미지정 시 기본값 |
| 인증 (운영) | `AUTH_ADMIN_EMAIL`/`AUTH_ADMIN_PASSWORD`(부트스트랩) · 쿠키: `AUTH_COOKIE_SECURE=1`(HTTPS) — 운영은 쿠키 전용 모드 자동(`AUTH_COOKIE_ONLY`) |
| 스모크 계정 | `SMOKE_EMAIL`/`SMOKE_PASSWORD` (EDITOR 이상) — 쿠키 전용 모드도 스크립트가 자동 처리 |
| 네트워크 | `api.openai.com` egress 허용 |
| 데이터 | 이미지가 업로드된 상품 1개 이상 (READY Product Object 생성 가능 상태) |

## 실행

```bash
API_BASE=https://<api-host> SMOKE_EMAIL=... SMOKE_PASSWORD=... \
  node scripts/real-provider-smoke.mjs
# 대상 수동 지정: PROJECT_ID=... PRODUCT_ID=... 추가
# 개발 환경 리허설(mock 허용): SMOKE_ALLOW_MOCK=1
```

## 검증 단계 (스크립트가 자동 수행)

1. **Provider 확인** `GET /llm` — mock이면 실패 (리허설 모드 제외)
2. **로그인** `POST /auth/login` — Bearer 또는 **쿠키 전용 모드**(운영,
   Set-Cookie) 자동 인식
3. **Health Check** `GET /llm/health` — 실호출 기반 키/네트워크/모델 확인
   (운영/스테이징은 EDITOR 이상 인증 — 로그인 후 호출되므로 통과)
4. 대상 프로젝트/상품 자동 탐색 (또는 env 지정)
5. **Vision 조립** `POST /projects/:id/product-object` — 이미지 가드 경유,
   visionSummary 생성 확인 (**Vision Analysis 실연결**)
6. **READY 전이** `PATCH …/product-object/:version/status` — 생성 전제 조건
7. **분석** `POST /products/:id/analysis` — SUCCESS 확인
   (**Product Analysis 실연결**)
8. **상세페이지 생성** `POST /projects/:id/contents/generate` — 201 확인
   (**Content Generation 실연결**)
9. **Execution 지표** `GET /executions/stats?from=<시작 시각>` —
   실행 구간 4건 이상·실패 0 확인
10. **운영 판정 (TASK-0901)** — byProvider에 현재 Provider 포함 +
    byFeature에 product-analysis·content-generation 포함 확인,
    **실 Provider면 cost > 0 검증** (미산정/0이면 실패)

전부 통과 시 `PASS`(exit 0), 하나라도 실패하면 `FAIL`(exit 1).
통과 후 웹 `/executions` 대시보드에서 Provider=openai 필터로 비용·지연
추이를 확인한다.

## 실패 시 확인 포인트

- Health error: 키 유효성·egress 허용 목록·모델 접근 권한
- 분석/생성 FAILED: `GET /executions?limit=10`의 error 메시지,
  API 로그의 재시도 경고
- "출력 한도에서 잘려" 오류: `LLM_*_MAX_TOKENS` 상향 (JSON 출력이
  max tokens에서 잘리면 명확한 오류로 실패 처리된다 — TASK-0901)
- cost 미산정: 응답 모델명이 가격표(`DEFAULT_LLM_PRICING`, @acos/core)와
  접두사 매칭되는지 확인 — 새 모델은 가격표 1곳에 단가 추가
- 시각화: 웹 `/executions` 대시보드에서 실패율·지연·비용 추이 확인

## 리허설 결과 (개발 환경, mock)

`SMOKE_ALLOW_MOCK=1`로 스크립트 자체는 개발 환경에서 검증되어 있다
(10단계 전부 PASS — 쿠키 전용 모드 포함). 실키 수행 결과는 운영/스테이징
실행 후 이 문서에 기록한다.

## 실키 통합 검증 (개발 환경에서 수행된 범위 — TASK-0901)

실 OpenAI 응답 형태(스냅샷 모델명·usage·finish_reason)를 주입 클라이언트로
재현해 3개 엔진 전 경로를 검증했다
(`apps/api/src/llm/openai-production.spec.ts`):
- Content Generation: 텍스트 경로 + 운영 상한 4096 전달 + 비용 산정
- Product Analysis: response_format json_object + 실 모델 JSON 엄격 파싱
- Vision Analysis: image_url(data URL) 첨부 + JSON 파싱
- 잘림 방어: finish_reason=length + JSON → 명확한 오류 + Execution FAILED
