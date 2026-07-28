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
| 보고 기준 TASK | **TASK-0901 — Real Provider Integration: OpenAI Production** (Sprint 9) |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `8d095e3` |
| 핵심 성과 | 3개 엔진(Content/Analysis/Vision) **OpenAI 실연결 전 경로 검증** + 운영 출력 상한 + JSON 잘림 방어 + Production Smoke 10단계 |
| 구현 중단 상태 | **TASK-0901 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 실키 스모크 수행 주체·상한 기본값 등 → **CTO_REQUEST #35 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **348** — core 138 · **api 192(+4)** · web e2e 18 — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0901 — Real Provider Integration: OpenAI Production (`8d095e3`)

지시 6영역(Content Generation · Product Analysis · Vision Analysis ·
Execution Log · Dashboard · Production Smoke)의 실제 OpenAI 연결 상태:

**이미 연결되어 있던 것 (구조 확인)** — 3개 엔진은 모두 LLM Gateway
단일 진입점(LlmService)을 경유하므로 `LLM_PROVIDER=openai` +
`OPENAI_API_KEY`만으로 전 기능이 OpenAI로 전환된다(0504~0603의 설계 효과).
Execution Log·Dashboard도 Provider 무관하게 이미 동작한다.

**이번 TASK에서 운영 수준으로 보강한 것**:

1. **feature별 운영 출력 상한**: OpenAI 어댑터 기본 1024토큰은 상세페이지
   생성이 잘릴 위험 — LlmService 단일 관문에서 미지정 시 feature 기본값을
   주입: **content-generation 4096 · product-analysis 2048 ·
   vision-analysis 2048** (`LLM_CONTENT/ANALYSIS/VISION_MAX_TOKENS` 조정)
2. **JSON 잘림 방어**: `finish_reason=length` + `responseFormat json`이면
   잘린 JSON을 파싱 시도하는 대신 **명확한 오류로 실패** → Execution에
   FAILED로 기록 (운영 원인 추적 용이). 텍스트 출력은 부분 결과 허용
3. **통합 검증 (실 응답 형태 재현)**: 주입 클라이언트(OpenAiChatClient)로
   스냅샷 모델명·usage·finish_reason을 재현해 **3개 엔진 전 경로** 검증 —
   `openai-production.spec.ts` 4종 (아래 테스트 결과)
4. **Production Smoke 10단계 확장**:
   - **쿠키 전용 운영 모드 로그인 지원** — 운영은 본문 토큰이 없으므로
     (0804) Set-Cookie의 `acos_session`을 자동 인식해 이후 요청에 첨부
   - **운영 판정 단계 신설** — byProvider에 현재 Provider 포함 +
     byFeature에 product-analysis·content-generation 포함 확인,
     실 Provider면 **cost > 0** 검증(기존 null 검사 강화)
5. **운영 런북 갱신**: 사전 조건 환경 세트(Provider·출력 상한·인증/쿠키·
   스모크 계정·egress) 표준화 — `docs/operations/real-provider-smoke.md`

**실키 네트워크 검증**: 개발 샌드박스는 api.openai.com egress 차단 —
CTO 확정(0603 승인 ④)대로 **운영/스테이징에서 스모크 스크립트로 수행**
(모든 준비 완료: 환경변수 세트 + 10단계 자동 판정)

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 9 | **TASK-0901 — OpenAI Production** | **완료 (`8d095e3`) — 승인 대기** |
| Sprint 8 | 0801~0804 인증/보안 체계 | 전체 승인 · 공식 종료 |
| Sprint 1~7 | Foundation ~ Publishing/관측 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit | 138 | ✅ (변경 없음) |
| `apps/api` | Service+API — 기존 188 · **OpenAI Production 통합 4** | 192 | ✅ |
| `apps/web` | Playwright e2e | 18 | ✅ (변경 없음 — UI 무변경) |
| **합계** | | **348** | **전체 통과** |

신규 통합 테스트(주입 클라이언트, `openai-production.spec.ts`)가 검증하는 것:
- **Content Generation**: 텍스트 경로 — 운영 상한 4096이 어댑터로 전달,
  스냅샷 모델(gpt-4o-2024-08-06) 기록, **접두사 매칭 비용 산정**
  (1200/640 토큰 → $0.0094 정확 일치)
- **Product Analysis**: `response_format json_object` 강제 + 상한 2048,
  **실 모델 응답(초안 echo가 아닌 보강된 JSON)** 엄격 파싱, Execution
  SUCCESS·cost>0
- **Vision Analysis**: 이미지가 **image_url(data URL)** 로 마지막 user
  메시지에 첨부, JSON 파싱, source=llm:openai
- **잘림 방어**: finish_reason=length + json → "출력 한도에서 잘려" 오류,
  재시도 후 **Execution FAILED 1건**(error 메시지 포함)

라이브 검증 (실 PostgreSQL + 실스택):
- **스모크 리허설 10/10 PASS** — 신설 운영 판정 단계에서
  byFeature=[vision-analysis, dev, content-generation, product-analysis]
  전 기능 커버리지 확인
- **쿠키 전용 모드 스모크 10/10 PASS** — `AUTH_COOKIE_ONLY=1` 재기동 후
  "로그인 — 쿠키 전용 모드"로 전 단계 통과 (운영 모드 호환 입증)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 실 Provider 운영 안전장치**:

```
엔진 3종 ─▶ LlmService (단일 관문)
              ├─ feature별 출력 상한 주입 (미지정 시: 4096/2048/2048)
              └─ ExecutionTracker → 스냅샷 모델명·접두사 매칭 비용
                   OpenAI 어댑터: json_object · image_url · 잘림 방어(length+json→FAILED)
운영 스모크: 쿠키 전용 로그인 → 10단계 → 운영 판정(커버리지·cost>0)
```

① 코드 변경 없는 Provider 전환 원칙 재확인 — 환경변수 2개(LLM_PROVIDER +
키)로 전 기능 전환. ② 실패를 명확하게: 잘림은 파싱 오류가 아닌 원인이
보이는 오류로. ③ 스모크가 운영 구성(쿠키 전용·health 보호)과 완전 호환 —
운영 배포 후 즉시 실행 가능.

**유지되는 핵심 결정**: mock 기본 원칙 · 단일 관문 Execution 기록 ·
가격표 Code-first·접두사 매칭 · 실키 검증은 운영/스테이징(0603 승인 ④)

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 21건
(이번 TASK 스키마 변경 없음), drift 없음

## 6. 데이터 모델

변경 없음

## 7. API 표면

변경 없음 — 내부 동작 보강만:
- 3개 엔진 호출의 max tokens 기본값 상향 (운영 상한)
- OpenAI JSON 잘림 시 오류 메시지 명확화 (Execution error에 기록)
- 스모크 스크립트(`scripts/real-provider-smoke.mjs`) 10단계 — CLI 계약
  동일 (exit 0/1)

## 8. 리스크·기술 부채

1. **0901 해석 미확인** — 출력 상한 기본값(4096/2048/2048)·잘림 시 실패
   정책(텍스트는 부분 허용) 등 (CTO_REQUEST #35)
2. **실키 네트워크 검증 미수행** — 개발 egress 차단(구현 문제 아님, 0603
   확정). 운영/스테이징에서 스모크 1회 실행이 남은 마지막 단계
3. **비용 상한/알림 부재** — Execution cost는 기록·대시보드 표시되지만
   예산 초과 알림·차단은 없음 (스펙 대기)
4. **Anthropic/Gemini** — responseFormat 구조화 매핑 등 공식 연결 대기
   (OpenAI 패턴 재적용 가능)
5. **Rate Limit 인메모리** — 다중 인스턴스 시 Redis 확장 (0804 확정 유지)

## 9. 다음 권장 사항 (Sprint 9 후속 후보)

1. **CTO_REQUEST #35 확인** — TASK-0901 해석 확인 및 다음 지시
2. **운영/스테이징 실키 스모크 실행** — 준비 완료 상태. 실행 주체/시점
   지정 요청 (스크립트·런북·판정 자동화 모두 구비)
3. **비용 거버넌스** — 일/월 예산 상한·초과 알림 (Execution 데이터 기반)
4. **Anthropic/Gemini 공식 연결** — OpenAI 패턴(구조화 출력·상한·잘림
   방어·통합 검증) 재적용
5. **모델 라우팅** — feature별 모델 지정(예: vision은 gpt-4o, 분석은
   gpt-4o-mini)으로 비용 최적화
