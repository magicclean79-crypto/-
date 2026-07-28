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
| 보고 기준 TASK | **TASK-0903 — Anthropic & Gemini Provider Integration** (Sprint 9) |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `f9cbda5` |
| 핵심 성과 | **3사(OpenAI·Anthropic·Gemini) 전부 공식 연결** + Registry 기반 Provider Factory + Unified Execution + Provider 비교 대시보드 |
| 구현 중단 상태 | **TASK-0903 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | Anthropic JSON 매핑 방식·가격표 등록 모델 범위 등 → **CTO_REQUEST #37 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **373** — core 142 · **api 210(+11)** · web e2e 21 — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0903 — Anthropic & Gemini Provider Integration (`f9cbda5`)

지시 5항목(Anthropic · Gemini · Provider Factory · Unified Execution ·
Provider Comparison Dashboard) 전부 이행:

1. **Anthropic 공식 연결**: `responseFormat "json"` →
   **JSON 전용 system 지시 강화**로 매핑. Claude 4.6+ 모델은 assistant
   prefill이 400이므로 **prefill 방식을 쓰지 않고**, 지시 + 엄격 파싱
   (기존 재시도 경로)이 공식 매핑이다. 멀티모달 `image` content block,
   테스트용 클라이언트 주입, 잘림 방어(`stop_reason=max_tokens` + json)
2. **Gemini 공식 연결**: `responseFormat "json"` →
   **`responseMimeType: "application/json"`**(Gemini 공식 JSON 모드) 매핑,
   멀티모달 `inlineData` part, 응답 **`modelVersion`(스냅샷) 기록**으로
   접두사 매칭 비용 산정, 잘림 방어(`finishReason=MAX_TOKENS`)
   — 잘림 정책은 **CTO 확정 0901-② 그대로 3사 통일**(JSON은 FAILED,
   텍스트는 부분 결과 허용)
3. **Provider Factory**: `provider.factory.ts` 신설 — Registry
   (`LLM_PROVIDER_REGISTRY`, core) 기반 **테이블 드리븐** 생성.
   키 환경변수는 Registry가 단일 정의, 미설정 시 경고 후 mock 폴백.
   `llm.module.ts`의 switch 팩토리를 대체 — **새 Provider 추가는
   Registry·어댑터 테이블·가격표 3곳**으로 축소
4. **Unified Execution**: 가격표에 claude-opus-5($5/$25) ·
   claude-sonnet-5($3/$15) · claude-haiku-4-5($1/$5) ·
   gemini-2.5-flash($0.3/$2.5) 단가 등록 — 전 Provider가 **동일 Execution
   스키마 + 비용 산정**. **Registry의 모든 모델이 가격표에 있는지 테스트가
   보증**(누락 시 실패)
5. **Provider Comparison Dashboard**: `/providers` 비교 표 확장 —
   호출 수 · **성공률** · **평균 지연** · 토큰 · 비용 · **비용/호출**을
   Provider별로 나란히 비교. Playwright 갱신(다중 Provider 행·지표 검증)
- Registry 연결 상태: anthropic·gemini → **`official`** 승격(3사 전부)

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 9 | 0901 OpenAI Production · 0902 Cost Governance | 승인 (표준 확정) |
| Sprint 9 | **TASK-0903 — Anthropic & Gemini Provider Integration** | **완료 (`f9cbda5`) — 승인 대기** |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit | 142 | ✅ (변경 없음) |
| `apps/api` | Service+API — 기존 199 · **Anthropic 4 · Gemini 4 · Multi-Provider 통합 3** | 210 | ✅ |
| `apps/web` | Playwright e2e (비교 대시보드 검증 확장) | 21 | ✅ |
| **합계** | | **373** | **전체 통과** |

신규 테스트가 검증하는 것:
- **Anthropic 어댑터**: system 분리 매핑 · JSON 지시 강화(**prefill 미추가**
  확인) · image block 첨부 · 잘림(JSON 실패 / 텍스트 부분 허용)
- **Gemini 어댑터**: 스냅샷 모델 매핑 · `responseMimeType` 지정/미지정 ·
  inlineData 첨부 · 잘림(JSON 실패 / 텍스트 부분 허용)
- **Multi-Provider 통합**: Product Analysis@Anthropic(JSON 지시·상한 2048·
  claude-opus-5 단가 정확 일치) · Vision Analysis@Gemini(inlineData·JSON
  모드·상한 2048·스냅샷 접두사 비용) · **Registry 전 모델 가격표 등록 보증**

라이브 검증 (실 PostgreSQL + 실스택):
- **Anthropic 배선**: `LLM_PROVIDER=anthropic` 재기동 → `/llm` provider
  anthropic · `/llm/providers` official·models 3종 · **`/llm/health`가 실
  `api.anthropic.com`까지 도달해 401 authentication_error 반환**(무효 키 —
  네트워크·SDK·에러 처리 배선 확인). 실키 검증은 운영/스테이징 스모크
- **Gemini 폴백**: `LLM_PROVIDER=gemini`(키 없음) → Factory가 경고 로그
  "GEMINI_API_KEY가 없어 mock으로 대체합니다" 후 mock 기동
- **비교 대시보드**: anthropic/gemini 실행 이력 시드 → `/executions/stats`
  byProvider 4종 집계 → 브라우저에서 4행 비교 렌더링 확인(성공률 50%/100%,
  지연 1701ms/575ms, 비용/호출 $0.0123/$0.0007 — 스크린샷 첨부), 시드 정리
- **스모크 리허설 10/10 PASS** (회귀 없음)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 멀티 Provider 운영 체계 완성**:

```
LLM_PROVIDER ─▶ Provider Factory (Registry 테이블 드리븐)
                  ├─ mock(기본) · openai · anthropic · gemini  ※키 없으면 mock 폴백
                  └─ 어댑터: 구조화 출력(각 사 공식 옵션) · 멀티모달 · 잘림 방어(통일)
                        └─▶ LlmService(단일 관문) ─▶ Unified Execution
                                 (동일 스키마 · 전 Provider 비용 산정)
                                      └─▶ /providers 비교 (성공률·지연·비용/호출)
```

① Provider 교체가 **환경변수 1개**로 완결되고, 추가는 **3곳 갱신**으로
축소(스위치 분기 제거). ② 각 사의 구조화 출력을 그 사의 공식 방식으로
매핑하되 **실패 정책은 통일**(잘림 = JSON FAILED). ③ Execution이 진짜
Unified — Provider별 성공률·지연·단가 비교가 데이터로 가능해짐.

**유지되는 핵심 결정**: mock 기본 · 단일 관문 기록 · 가격표 Code-first
접두사 매칭 · 잘림 정책(0901-②) · Provider 내 모델 라우팅(0902 승인 ②)

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 21건
(이번 TASK 스키마 변경 없음), drift 없음

## 6. 데이터 모델

변경 없음 — 가격표(`DEFAULT_LLM_PRICING`, core)에 4개 모델 단가 추가

## 7. API 표면

| 영역 | 변경 |
| --- | --- |
| `GET /llm/providers` | anthropic·gemini `connection: "official"`, models 확장 |
| LLM 호출 전반 | Provider 무관 동일 계약 — 구조화 출력·멀티모달·비용이 3사 모두 활성 |
| 그 외 | 변경 없음 |

웹: `/providers` **Provider 비교 표** 확장(성공률·평균 지연·비용/호출 추가)

## 8. 리스크·기술 부채

1. **0903 해석 미확인** — Anthropic JSON을 **지시 강화 방식**으로 매핑한
   판단(prefill 400 제약), 가격표 등록 모델 범위 (CTO_REQUEST #37)
2. **실키 네트워크 검증 미수행** — Anthropic은 401까지 도달해 배선이
   확인됐고, 실 응답 검증은 운영/스테이징 스모크(0901 승인 ③ 정책)
3. **Cross-Provider Routing 미구현** — 0902 승인 ②대로 이번 TASK 이후가
   구현 시점(Registry·Factory 준비 완료)
4. **Anthropic 구조화 출력의 스키마 강제 부재** — 스키마 없는 자유 JSON은
   지시+파싱 재시도에 의존(도구/구조화 출력 API 도입은 스펙 대기)
5. **Rate Limit 인메모리 · 예산 알림 채널** — 기존 부채 유지

## 9. 다음 권장 사항 (Sprint 9 후속 후보)

1. **CTO_REQUEST #37 확인** — TASK-0903 해석 확인 및 다음 지시
2. **Cross-Provider Model Routing** — feature별 Provider 분리 (0902 승인 ②의
   전제 조건인 3사 연결이 이번에 충족됨)
3. **운영/스테이징 실키 스모크** — 3사 각각 1회 (0901 승인 ③ 정책 적용)
4. **Provider Failover** — 장애·rate limit 시 대체 Provider 자동 전환
5. **Sprint 9 종료 여부 판단** — 멀티 Provider 운영 준비 완성도 리뷰
