# 실제 Provider 스모크 테스트 절차 (TASK-0703, Sprint 7)

**운영/스테이징 환경**에서 실제 LLM Provider(OpenAI 등) 연결을 검증하는
공식 절차다 — CTO 결정(TASK-0603 승인 ④): 실키 검증은 운영/스테이징에서
수행한다 (개발 환경은 egress 제한).

## 사전 조건

| 항목 | 값 |
| --- | --- |
| 환경 변수 | `LLM_PROVIDER=openai` + `OPENAI_API_KEY=<실키>` (선택: `LLM_OPENAI_MODEL`) |
| 네트워크 | `api.openai.com` egress 허용 |
| 데이터 | 이미지가 업로드된 상품 1개 이상 (READY Product Object 생성 가능 상태) |

## 실행

```bash
API_BASE=https://<api-host> node scripts/real-provider-smoke.mjs
# 대상 수동 지정: PROJECT_ID=... PRODUCT_ID=... 추가
# 개발 환경 리허설(mock 허용): SMOKE_ALLOW_MOCK=1
```

## 검증 단계 (스크립트가 자동 수행)

1. **Provider 확인** `GET /llm` — mock이면 실패 (리허설 모드 제외)
2. **Health Check** `GET /llm/health` — 실호출 기반 키/네트워크/모델 확인
3. 대상 프로젝트/상품 자동 탐색 (또는 env 지정)
4. **Vision 조립** `POST /projects/:id/product-object` — 이미지 가드 경유,
   visionSummary 생성 확인
5. **READY 전이** `PATCH …/product-object/:version/status` — 생성 전제 조건
6. **분석** `POST /products/:id/analysis` — SUCCESS 확인
7. **상세페이지 생성** `POST /projects/:id/contents/generate` — 201 확인
8. **Execution 지표** `GET /executions/stats?from=<시작 시각>` —
   실행 구간 4건 이상·실패 0 확인, **실 Provider면 cost 산정 여부 검증**

전부 통과 시 `PASS`(exit 0), 하나라도 실패하면 `FAIL`(exit 1).

## 실패 시 확인 포인트

- Health error: 키 유효성·egress 허용 목록·모델 접근 권한
- 분석/생성 FAILED: `GET /executions?limit=10`의 error 메시지,
  API 로그의 재시도 경고
- cost 미산정: 응답 모델명이 가격표(`DEFAULT_LLM_PRICING`, @acos/core)와
  접두사 매칭되는지 확인 — 새 모델은 가격표 1곳에 단가 추가
- 시각화: 웹 `/executions` 대시보드에서 실패율·지연·비용 추이 확인

## 리허설 결과 (개발 환경, mock)

`SMOKE_ALLOW_MOCK=1`로 스크립트 자체는 개발 환경에서 검증되어 있다
(8단계 전부 PASS). 실키 수행 결과는 운영/스테이징 실행 후 이 문서에 기록한다.
