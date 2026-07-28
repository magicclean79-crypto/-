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
| 보고 기준 TASK | **TASK-0603 — Provider Integration (OpenAI)** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `34d1426` |
| 핵심 성과 | OpenAI Provider **공식 연결** — 지시된 5개 항목(API Key·Health Check·responseFormat·Multimodal·Execution Cost) 전부 활성화 |
| 구현 중단 상태 | **TASK-0603 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | **실키 호출 미검증(환경 제약)** 등 → **CTO_REQUEST #24 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 261/261 통과 (core 115 · api 146) — 이번 주기 +8 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0602 승인 결정 반영

- 지표 구성·비율 0~1 API 반환(%는 UI)·from/to 공식 채택 — 현행 확정 (변경 없음)
- Dashboard 화면(다음 Sprint)·일별 시계열(Sprint 6 후반) — 백로그 기록

### TASK-0603 — Provider Integration: OpenAI (`34d1426`)

지시된 5개 활성화 항목:

1. **API Key**: `LLM_PROVIDER=openai` + `OPENAI_API_KEY` 조합으로 활성화
   (키 없으면 mock 폴백 — 기존 안전 원칙 유지), .env.example 가이드 갱신
2. **Health Check**: `GET /llm/health` 신설 — **실제 최소 완성 호출**("ping",
   maxTokens 16)로 키·네트워크·모델 접근을 확인. 실패 시 예외 대신
   `{ status: "error", error }` 반환. 점검 호출도 Execution(feature "dev")으로
   기록되어 실패 이력이 대시보드에 남음
3. **responseFormat**: OpenAI 어댑터가 `"json"`을
   `response_format { type: "json_object" }`로 매핑 — 프롬프트 지침과 이중
   강제 (CTO 결정 0504 승인 ②의 "실연결 시 매핑" 적용)
4. **Multimodal**: `image_url`(data URL) 매핑 유지 + **테스트용 클라이언트
   주입** 구조 추가로 요청 파라미터 계약(모델·토큰·이미지·구조화 출력)을
   단위 테스트로 고정
5. **Execution Cost**: 가격표(Code-first 중앙 정의)에 OpenAI 공식 공개 단가
   등록 — `gpt-4o` $2.5/$10, `gpt-4o-mini` $0.15/$0.6 (USD/1M). 응답 모델이
   버전 스냅샷(`gpt-4o-2024-08-06`)이어도 **최장 접두사 일치**로 단가 매칭
   (`gpt-4o-mini-…`가 `gpt-4o`로 오매칭되지 않도록 더 긴 key 우선)

- Anthropic/Gemini는 이번 TASK 범위 아님 — responseFormat 매핑은 해당
  Provider 연결 시 (CTO 지시: "우선 OpenAI")
- DB 변경 없음. 문서: llm.md(Health Check·OpenAI 연결)/execution.md(단가)/
  README/.env.example 갱신

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 6 | 0601 Execution Domain · 0602 Dashboard | 승인 |
| Sprint 6 | **TASK-0603 — Provider Integration (OpenAI)** | **완료 (`34d1426`) — 승인 대기** |
| Sprint 1~5 | Foundation ~ AI Execution | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 113 · **단가 2** (gpt-4o 계산·접두사 매칭) | 115 | ✅ |
| `apps/api` | Service+API — 기존 140 · **OpenAI 어댑터 4 + Health 2** | 146 | ✅ |
| **합계** | | **261** | **전체 통과** |

신규 테스트가 검증하는 것:
- OpenAI 어댑터(가짜 클라이언트 주입): 응답→LlmResult 매핑(스냅샷 모델·usage),
  json 시에만 response_format 전달, 이미지 image_url 첨부 순서, 모델/maxTokens
- Health: mock ok + Execution(dev) 기록, 실패 Provider면 error 상태 +
  FAILED Execution (예외 미발생)
- 단가: gpt-4o 1M/1M → $12.5, 스냅샷 접두사 매칭(gpt-4o-mini 우선순위 포함)

라이브 검증:
- mock 구성: `GET /llm/health` → ok (latency 포함), Execution dev SUCCESS 기록
- **openai 구성(무효 테스트 키)**: `GET /llm` → openai/gpt-4o 선택 확인,
  `/llm/health` → **실제 API 호출 시도** 후 error 반환, Execution에
  `dev | openai gpt-4o | FAILED` 기록 — 배선 전체가 실호출까지 도달함을 실증
- ⚠️ **실키 검증 불가**: 이 개발 샌드박스의 네트워크 egress 허용 목록에
  `api.openai.com`이 없어(403 Host not in allowlist) 유효 키가 있어도 호출이
  차단됨 — 환경 설정 또는 다른 환경에서의 스모크 테스트 필요 (#24)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 첫 실제 Provider 공식 연결**:

```
LLM_PROVIDER=openai + OPENAI_API_KEY
   └─▶ OpenAiLlmProvider: json_object 구조화 출력 + image_url 멀티모달
         ├─ GET /llm/health : 실호출 상태 점검 (실패도 Execution 기록)
         └─ Execution Cost  : gpt-4o 계열 단가 자동 산정 (접두사 매칭)
```

① mock 기본 원칙은 그대로 — 키를 설정한 환경에서만 실호출. ② 관측 루프
완성: 연결(0603) → 기록(0601) → 집계(0602)가 한 흐름 — 실키 투입 즉시
비용/성능 지표가 대시보드에 나타난다. ③ 어댑터 테스트 패턴 수립(클라이언트
주입) — Anthropic/Gemini 연결 시 동일 패턴 적용 예정.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증 · Execution 6항 결정

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 16건(변경 없음), drift 없음

## 6. 데이터 모델

(TASK-0603은 스키마 변경 없음 — 가격표는 코드 선언, Health는 기존 Execution으로 기록)

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| LLM Gateway | `GET /llm` · **`GET /llm/health`** (신설) · `POST /llm/complete` |
| Execution | `GET /executions` · `GET /executions/stats` — 변경 없음 (openai 호출도 자동 집계) |

웹: 변경 없음

## 8. 리스크·기술 부채

1. **실키 스모크 테스트 미수행** — 개발 환경 egress 제한(`api.openai.com`
   차단)으로 유효 키 검증 불가. 무효 키로 배선(실호출 도달·오류 기록)은
   실증 완료 (CTO_REQUEST #24)
2. **이미지 용량 가드 미구현** — CTO 결정(0505 승인 ④): 실제 Provider 연결
   전 구현 — **다음 TASK 후보로 이행 필요** (Vision을 openai로 실행하기 전)
3. **단가 변동 추적** — 가격표는 코드 선언(승인 ④ 유지) — OpenAI 단가 변경
   시 수동 갱신 필요
4. **Anthropic/Gemini responseFormat 미매핑** — 해당 Provider 연결 TASK에서
5. **Dashboard 화면·일별 시계열** — CTO 일정대로 대기 (다음 Sprint / Sprint 6 후반)

## 9. 다음 권장 사항 (Sprint 6 후속 후보)

1. **CTO_REQUEST #24 확인** — TASK-0603 해석 확인 및 다음 지시
2. **실키 스모크 테스트** — 운영/스테이징 환경(egress 허용)에서 유효 키로
   health→생성→분석→Vision 1회씩 + /executions/stats 비용 확인
3. **이미지 용량 가드·리사이즈** — CTO 결정상 실제 Provider 연결 전 구현
   항목 — openai로 Vision을 돌리기 전에 필요
4. **일별 시계열 집계** — CTO 예고(Sprint 6 후반)
5. **Anthropic/Gemini 공식 연결** — OpenAI와 동일 5항목 패턴 재적용
