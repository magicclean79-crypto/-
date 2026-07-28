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
| 보고 기준 TASK | **TASK-0602 — Execution Dashboard** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `162f165` |
| 핵심 성과 | **운영 지표 집계 완성** — 호출 수·성공/실패율·토큰·비용·지연을 전체 + Feature/Provider/Model별로 제공하는 Dashboard API |
| 구현 중단 상태 | **TASK-0602 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 지표 구성·기간 필터 등 → **CTO_REQUEST #23 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 253/253 통과 (core 113 · api 140) — 이번 주기 +7 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0601 승인 결정 반영

- CTO 결정 6항(feature 4종 유지 · 400 비기록 · 본문 비저장 · 가격표
  Code-first + 미등록 모델 cost null · FK 없는 독립 도메인) 전부 **현행
  구현과 일치** — 변경 없이 확정 사항으로 기록 (CTO_REQUEST #22 → 결정됨)

### TASK-0602 — Execution Dashboard (`162f165`)

- **Dashboard API**: `GET /executions/stats?from=&to=` — 지시된 지표 전부 제공:
  - **호출 수** `count` · **성공률/실패율** `successRate`/`failureRate`
    (0~1, 표본 없으면 null) · **Token** `inputTokens`/`outputTokens` 합계 ·
    **Cost** USD 합계(가격 산정된 호출이 없으면 null — 0601 원칙 유지) ·
    **Latency** `avgLatencyMs`(호출 수 가중 평균) + `maxLatencyMs`
  - 집계 축: **전체(totals) + byFeature + byProvider + byModel** (호출 수
    내림차순 정렬)
- **집계 구조**: DB에서 (차원, status) 단위 `groupBy` 1회씩(총 4쿼리, 병렬) →
  @acos/core의 순수 병합 로직 `buildExecutionStats`/`buildExecutionTotals` —
  성공/실패 병합·비율·가중 평균 규칙이 DB 없이 단위 테스트됨
- **기간 필터**: `from`/`to`(ISO, 미지정 시 전체 기간) — 잘못된 날짜·역전
  기간은 400
- 기록 규칙·Execution 모델은 변경 없음 (DB 변경 없음, 조회 전용 추가)
- 문서: execution.md에 Dashboard 섹션 추가, README 갱신

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 6 | TASK-0601 — Execution Domain | 승인 (6항 결정 확정) |
| Sprint 6 | **TASK-0602 — Execution Dashboard** | **완료 (`162f165`) — 승인 대기** |
| Sprint 5 | 0501~0506 (AI Execution) | 전체 승인 · 공식 종료 |
| Sprint 1~4 | Foundation ~ Company Brain Integration | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 109 · **집계 병합 4** | 113 | ✅ |
| `apps/api` | Service+API — 기존 137 · **stats API 3** | 140 | ✅ |
| **합계** | | **253** | **전체 통과** |

신규 테스트가 검증하는 것:
- 병합 로직: (key, status) 행 → 성공/실패 카운트·비율(0.75/0.25), 호출 수
  가중 평균 지연((10×3+50×1)/4=20), cost 미상 그룹 null, 빈 표본 처리,
  호출 수 내림차순 정렬
- stats API: totals+3축 응답 형태, cost Decimal→숫자 직렬화, 기간 필터가
  DB where로 전달, 잘못된 날짜·역전 기간 400

라이브 검증 (실 PostgreSQL — 0601에서 기록된 실데이터):
- `GET /executions/stats` → totals(5건, successRate 1, 토큰 합계, cost 0) +
  byFeature 4종(content-generation 2 · vision-analysis · dev ·
  product-analysis) + byProvider(mock) + byModel(mock-llm-1)
- **실시간 반영**: `/llm/complete` 호출 직후 totals 6건·dev 2건으로 증가 확인
- 기간 필터 정상, 잘못된 날짜 400

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 관측 계층의 읽기 완성 (기록 0601 → 집계 0602)**:

```
LLM 호출 전부 ─▶ Execution 기록 (0601)
                   ├─ GET /executions        : 원시 이력 (건별)
                   └─ GET /executions/stats  : 운영 지표 (호출/성공률/토큰/비용/지연
                                               × 전체/Feature/Provider/Model)  ← 신설
```

① 집계는 **조회 전용 계층** — 기록 규칙·모델을 건드리지 않고 위에 얹음.
② 병합 규칙은 core 순수 함수로 분리 — DB 집계(groupBy)와 통계 규칙(비율·
가중 평균·cost null)이 각자 테스트됨. ③ 실모델 전환 시 이 API가 곧
비용/성능 모니터링 창구가 된다 (가격표 등록만 남음).

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증 · Execution 6항 결정(#22)

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 16건(변경 없음), drift 없음

## 6. 데이터 모델

(TASK-0602는 스키마 변경 없음 — executions 테이블 재사용, 조회 전용)

```
Execution — LLM 호출 관측 (독립 테이블, FK 없음 — CTO 결정)
  └─ 집계: (feature|provider|model, status) groupBy → 통계 병합 (저장하지 않음)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| Execution | `GET /executions?feature=&limit=` (이력) · **`GET /executions/stats?from=&to=`** (Dashboard 집계) |

웹: 변경 없음 (Dashboard 화면은 스펙 없음 — API만 제공)

## 8. 리스크·기술 부채

1. **0602 해석 미확인** — 지표 구성(가중 평균 지연·최대치)·기간 필터·화면
   부재 (CTO_REQUEST #23)
2. **실모델 단가 미확정** — cost가 mock 0 외에는 null (단가 스펙 확정 시
   가격표 1곳 추가로 활성화 — #22에서 요청 유지)
3. **웹 Dashboard 화면 부재** — API만 제공 (화면은 스펙 없음)
4. **시계열 미제공** — 기간 전체의 합계·평균만 제공, 일별 추이는 후속
5. **실모델 연결 준비 항목** — 이미지 용량 가드·구조화 출력 매핑·스모크
   테스트 — 이전 보고와 동일

## 9. 다음 권장 사항 (Sprint 6 후속 후보)

1. **CTO_REQUEST #23 확인** — TASK-0602 해석 확인 및 다음 지시
2. **웹 Dashboard 화면** — /executions 페이지 (stats API 소비, 표+지표 카드)
3. **일별 시계열 집계** — 추이 그래프용 (기간 × 일 단위 groupBy)
4. **실모델 단가 등록** — #22 요청 유지 (등록 즉시 비용 지표 활성화)
5. **실모델 연결 준비 TASK** — 이미지 용량 가드 + 구조화 출력 매핑 + 스모크
   테스트 묶음 (API 키 스펙 필요, CTO_REQUEST #6)
