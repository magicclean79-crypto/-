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
| 보고 기준 TASK | **TASK-0703 — Real Provider Smoke & Publishing Pipeline** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `1c28a52` |
| 핵심 성과 | **발행 파이프라인 완성**(DRAFT→REVIEW→PUBLISHED→ARCHIVED) + **운영 스모크 테스트 공식 절차·도구** (mock 리허설 8/8 PASS) |
| 구현 중단 상태 | **TASK-0703 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 실키 수행 일정·발행 웹 UI 등 → **CTO_REQUEST #29 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **293** — core 126(+4) · api 163(+6) · web e2e 4 — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0703 — Real Provider Smoke & Publishing Pipeline (`1c28a52`)

**① 발행 파이프라인** (지시 사항):

- `PATCH /projects/:projectId/contents/:contentId/status` `{ status }` —
  **DRAFT → REVIEW → PUBLISHED → ARCHIVED** (+ REVIEW→DRAFT 되돌리기,
  단계별 ARCHIVED 종결, ARCHIVED는 전이 불가)
- 전이 규칙은 **Sprint 1에 선언돼 있던 @acos/core `canTransition`을 공식
  사용** (기존 구현 재사용 원칙 — `content/content-status.ts`로 정리, 공개
  API 불변). 위반 시 400 + 가능한 전이 목록 안내
- **PUBLISHED 전이는 발행 조건 추가 검증** (`isPublishable`): REVIEW 상태 +
  제목/본문 비어 있지 않음. 전이 시 **`publishedAt` 기록** — 이후 ARCHIVED
  되어도 발행 이력 보존
- `Content.publishedAt` 컬럼 추가 — **데이터 보존 마이그레이션**(ADD COLUMN,
  기존 데이터 무영향), drift 없음. `ContentDto.publishedAt`·`CONTENT_STATUSES`
  공유 타입 추가

**② 운영 환경 스모크 테스트** (지시 사항):

- `scripts/real-provider-smoke.mjs` — 운영/스테이징(실키+egress 허용)에서
  실행하는 8단계 자동 판정 도구: Provider 확인(mock이면 실패) → Health(실호출)
  → 대상 자동 탐색 → Vision 조립(이미지 가드 경유) → READY 전이 → 분석 →
  상세페이지 생성 → **Execution 지표 판정**(해당 구간 4건+·실패 0·실
  Provider면 **cost 산정 여부 검증**). PASS/FAIL exit code
- `docs/operations/real-provider-smoke.md` — 공식 절차 문서(사전 조건·실행·
  판정·실패 시 확인 포인트)
- **개발 환경 리허설**: `SMOKE_ALLOW_MOCK=1`로 도구 자체를 검증 — **8/8
  PASS** (실키 수행은 CTO 결정대로 운영/스테이징 — 개발 egress 제한)

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 7 | 0701 Dashboard UI · 0702 Filter & Web Testing | 승인 |
| Sprint 7 | **TASK-0703 — Smoke & Publishing Pipeline** | **완료 (`1c28a52`) — 승인 대기** |
| Sprint 1~6 | Foundation ~ Execution 관측 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 122 · **전이 규칙 4** | 126 | ✅ |
| `apps/api` | Service+API — 기존 157 · **발행 파이프라인 6** | 163 | ✅ |
| `apps/web` | Playwright e2e (게이트 유지) | 4 | ✅ |
| **합계** | | **293** | **전체 통과** |

신규 테스트가 검증하는 것:
- 전이 규칙: 정방향·되돌리기·종결 허용, 건너뛰기·역행·ARCHIVED 이후 거부,
  발행 조건 4케이스
- API: DRAFT→REVIEW→PUBLISHED(publishedAt 기록)→ARCHIVED(이력 보존),
  REVIEW→DRAFT, 건너뛰기 400, 빈 본문 발행 400, 잘못된 값 400/404,
  HTTP 계약(PATCH …/status)

라이브 검증 (실 PostgreSQL — 마이그레이션 적용):
- 발행 파이프라인 전 구간: REVIEW → PUBLISHED(publishedAt 기록) →
  ARCHIVED(발행 이력 보존), ARCHIVED→DRAFT 400,
  DRAFT→PUBLISHED 400("가능한 전이: REVIEW, ARCHIVED" 안내)
- **스모크 리허설 8/8 PASS** — 도구가 전 경로(조립→READY→분석→생성→지표)를
  실제로 구동·판정함을 확인

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 콘텐츠 수명주기 완성 + 운영 전환 준비 완료**:

```
생성 (0502)  →  발행 파이프라인 (0703)                 운영 전환:
Content(DRAFT) → REVIEW → PUBLISHED(publishedAt) → ARCHIVED   scripts/real-provider-smoke.mjs
                   ↺ DRAFT                                     (8단계 판정 — 실키 환경에서 실행)
```

① 파이프라인 전체가 완결: 업로드→OCR→조립→READY 검증→생성→**발행**.
② 전이 규칙·발행 조건은 core 순수 로직(Product Object 상태 전이와 같은 결) —
Sprint 1 선언의 공식화로 새 코드 최소. ③ 실키 전환의 남은 절차가 명문화됨:
운영/스테이징에서 스모크 1회 실행 → 대시보드로 비용·오류 관측.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증 · Playwright 공식 게이트

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 17건**(+1), drift 없음

## 6. 데이터 모델

```
Content: + publishedAt DateTime?  (TASK-0703 — PUBLISHED 전이 시 기록, 이력 보존)
status: DRAFT → REVIEW → PUBLISHED → ARCHIVED (전이 규칙 core 강제)
```

(그 외 변경 없음)

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| 콘텐츠 | 기존 4종 + **`PATCH /projects/:id/contents/:contentId/status`** (발행 파이프라인) |
| 운영 도구 | `scripts/real-provider-smoke.mjs` (API 아님 — 운영 절차 도구) |

웹: 변경 없음 (발행 UI는 스펙 없음 — #29 질문)

## 8. 리스크·기술 부채

1. **0703 해석 미확인** — 전이 규칙 세부(되돌리기·단계별 종결)·publishedAt
   보존·스모크 단계 구성 (CTO_REQUEST #29)
2. **실키 스모크 미수행** — 도구·절차는 완비, 실행은 운영/스테이징 환경 필요
   (API 키 + egress — CTO 지원 필요)
3. **발행 웹 UI 부재** — API만 제공. 웹 추가 시 Playwright 게이트 준수 예정
4. **PUBLISHED 이후 배포 없음** — 채널별 포맷/외부 배포는 스펙 없음(제안 백로그)
5. **Anthropic/Gemini 공식 연결** — 대기

## 9. 다음 권장 사항 (Sprint 7 후속 후보)

1. **CTO_REQUEST #29 확인** — TASK-0703 해석 확인 및 다음 지시
2. **실키 스모크 실행** — 운영/스테이징에서 `real-provider-smoke.mjs` 1회
   (결과를 절차 문서에 기록)
3. **발행 웹 UI** — 프로젝트 화면에서 콘텐츠 상태 전환 (Playwright 포함)
4. **채널별 포맷/배포** — PUBLISHED 콘텐츠의 소비 스펙 (제안 백로그)
5. **Anthropic/Gemini 공식 연결** — OpenAI 5항목 패턴 재적용
