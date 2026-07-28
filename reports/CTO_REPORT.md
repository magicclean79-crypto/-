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
| 보고 기준 TASK | **TASK-0704 — Publishing Web UI & Audit History** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `dcc4817` |
| 핵심 성과 | 발행 파이프라인의 **화면·감사 완성** — 상태 변경 UI + Status Badge + publishedAt + Audit History, Playwright 게이트 포함 |
| 구현 중단 상태 | **TASK-0704 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 감사 이력 범위(actor 없음) 등 → **CTO_REQUEST #30 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **298** — core 126 · api 166(+3) · **web e2e 6(+2)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0703 승인 결정 반영

- **publishedAt 최초 발행 시점 보존** (결정 ②): 재발행이 가능해지는 미래
  경로에서도 최초 시점이 덮어써지지 않도록 `!record.publishedAt` 조건 반영
- 전이 규칙 공식 표준(결정 ①)·스모크 환경 정책(결정 ③) — 현행 확정

### TASK-0704 — Publishing Web UI & Audit History (`dcc4817`)

지시된 4개 구성 요소 전부 + Playwright:

1. **Audit History**: `content_status_history` 테이블 신설 — 상태 전이
   1건당 1레코드(fromStatus→toStatus·시각), **전이와 한 트랜잭션**으로 기록
   (누락 불가), 콘텐츠 삭제 시 Cascade. 조회:
   `GET /projects/:id/contents/:contentId/history` (최신순).
   마이그레이션 1건(신규 테이블, 기존 데이터 무영향), drift 없음
2. **상태 변경 UI** (`/projects/[id]` 상세페이지 목록): 현재 상태에서
   **가능한 전이만 버튼으로 노출** — 규칙 원천은 @acos/core
   `allowedTransitions` 하나(웹에 core 의존성 추가), 최종 검증은 API.
   실패 시 오류 메시지 표시, ARCHIVED는 "종결됨 (전이 불가)" 표기
3. **Status Badge**: 상태별 색상 고정 — DRAFT 황색 · REVIEW 청색 ·
   PUBLISHED 녹색 · ARCHIVED 회색
4. **PublishedAt**: 발행 시각(UTC) 표기 — ARCHIVED 후에도 유지(결정 ②)
5. **Playwright** (지시 사항): `publishing.spec.ts` 2종 — ① DRAFT→REVIEW→
   PUBLISHED(publishedAt·감사 이력 확인)→ARCHIVED(종결) 전 구간
   ② REVIEW→DRAFT 되돌리기. 스텁 API에 발행 시나리오(상태 유지형)+CORS 추가.
   **루트 pnpm test 게이트에 포함** (웹 e2e 총 6종)

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 7 | 0701 Dashboard UI · 0702 Filter & Testing · 0703 Smoke & Publishing | 승인 |
| Sprint 7 | **TASK-0704 — Publishing Web UI & Audit History** | **완료 (`dcc4817`) — 승인 대기** |
| Sprint 1~6 | Foundation ~ Execution 관측 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit | 126 | ✅ (변경 없음) |
| `apps/api` | Service+API — 기존 163 · **감사 이력 3** | 166 | ✅ |
| `apps/web` | Playwright e2e — 기존 4 · **발행 UI 2** | 6 | ✅ |
| **합계** | | **298** | **전체 통과** |

신규 테스트가 검증하는 것:
- API: 전이마다 이력 기록(from→to 최신순), 재발행 시 publishedAt 보존,
  없는 콘텐츠 이력 404, HTTP 계약(GET …/history)
- 웹 e2e: 배지 상태 변화·발행 버튼 강조·publishedAt 표기·감사 이력 표시·
  종결 상태·되돌리기 — 브라우저에서 전 구간 자동 검증

라이브 검증 (실 PostgreSQL + 실스택 브라우저):
- 실제 프로젝트 화면에서 DRAFT→REVIEW 클릭 → 배지 즉시 전환 + **감사 이력
  실시간 표시** ("DRAFT → REVIEW", UTC 시각)
- 0703에서 ARCHIVED된 콘텐츠: 발행 시각 유지 표기 + "종결됨" 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 발행 파이프라인의 조작·감사 완성**:

```
/projects/[id] 화면                 API                        DB
 Status Badge(색상 고정)     PATCH …/status ─┬─ contents.status 갱신
 전이 버튼(allowedTransitions)               └─ content_status_history 기록
 publishedAt(UTC)·감사 이력  GET …/history      (한 트랜잭션 — 누락 불가)
      └─ Playwright e2e 6종 (공식 게이트)
```

① 전이 규칙의 단일 원천: core 함수 하나를 API(검증)와 웹(버튼 노출)이 공용 —
규칙 변경 시 한 곳만 수정. ② 감사 이력은 전이와 원자적 — 수동 기록 없음.
③ CTO 결정(모든 웹 기능 Playwright 통과) 이행 — 발행 UI가 게이트에 포함됨.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Playwright 공식 게이트 · 발행 전이 표준

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 18건**(+1), drift 없음

## 6. 데이터 모델

```
Content ──< ContentStatusHistory (신설 — 전이 1건당 1레코드)
  id · contentId(FK, Cascade) · fromStatus · toStatus · createdAt
  인덱스: (contentId, createdAt)
```

(그 외 변경 없음 — publishedAt은 0703 컬럼 유지)

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| 콘텐츠 | 기존 5종 + **`GET /projects/:id/contents/:contentId/history`** (감사 이력) |

웹: `/projects/[id]` — **발행 UI 추가** (배지·전이 버튼·publishedAt·감사 이력)

## 8. 리스크·기술 부채

1. **0704 해석 미확인** — 감사 이력에 actor(수행자) 없음(인증 부재 전제)·
   프로젝트 화면 통합 위치 (CTO_REQUEST #30)
2. **감사 이력 표시는 전이 발생 콘텐츠만** — 생성 직후(전이 0건)는 이력
   섹션 미표시 (생성 이벤트 기록은 스펙 없음)
3. **실키 스모크(운영/스테이징)** — 대기 (CTO 결정: 해당 환경에서만)
4. **Anthropic/Gemini 공식 연결** — 대기
5. **채널별 포맷/배포** — PUBLISHED 소비 스펙 없음 (제안 백로그)

## 9. 다음 권장 사항 (Sprint 7 후속 후보)

1. **CTO_REQUEST #30 확인** — TASK-0704 해석 확인 및 다음 지시
2. **Sprint 7 종료 검토** — 0701~0704 완료 (Dashboard UI·필터·웹 게이트·
   스모크·발행 파이프라인·발행 UI) — 회고/종료 또는 잔여 지시 요청
3. **채널별 포맷/배포** — PUBLISHED 콘텐츠 소비 스펙 (제안 백로그)
4. **Anthropic/Gemini 공식 연결** — OpenAI 5항목 패턴 재적용
5. **인증/권한** — 감사 이력 actor 기록의 전제 (스펙 필요)
