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
| 보고 기준 TASK | **TASK-0702 — Dashboard Filter & Web Testing** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `1f9ab8b` |
| 핵심 성과 | 대시보드 **필터 완성** + **웹이 처음으로 자동화 품질 게이트에 편입** (Playwright 스모크 4종) + hour 31일 제한 |
| 구현 중단 상태 | **TASK-0702 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | Stats API 필터 확장·hour 기본 창 등 → **CTO_REQUEST #28 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ core 122 · api 157(+2) · **web e2e 4 (신규 게이트)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0702 — Dashboard Filter & Web Testing (`1f9ab8b`)

CTO 결정 4항목 전부 이행:

1. **Dashboard Filter** (결정 ②): `/executions`에 **Feature(선택 목록) ·
   Provider · Model · From/To(UTC)** GET 폼 — 서버 컴포넌트 유지(클라이언트
   JS 없음), stats+timeline **양쪽에 동일 적용**, interval 전환 시 필터 유지,
   초기화 버튼. datetime-local 입력은 UTC로 해석해 ISO 변환
   - 이를 위해 **Stats API 필터 확장**: `GET /executions/stats`가
     feature/provider/model 정확 일치 필터 지원 (totals·차원별 표 전부 반영)
2. **hour 31일 제한** (결정 ③): `interval=hour`는 from 미지정 시 **최근
   31일 창을 기본 적용**, 명시 범위가 31일 초과면 400. day/week는 제한 없음
3. **Playwright CI 게이트** (결정 ④): `apps/web`에 `pnpm test` = Playwright
   추가 — 루트 `pnpm test`(turbo)에 포함되어 **품질 게이트로 승격**.
   지시된 3종 + 필터 검증 1종:
   - **Dashboard**: KPI(0~1→% 변환)·차트·테이블·필터 폼 렌더링
   - **Filter**: 화면 쿼리가 stats/timeline API 호출로 정확히 전달되는지
   - **Empty**: 이력 없음 → 빈 상태 안내
   - **Error**: API 실패 → 오류 안내 카드
   - 구현: **모드 전환형 스텁 API**(e2e/stub-api.mjs)로 3개 상태를 결정적으로
     재현 — 실 DB/API 불필요, 사전 설치 chromium 사용(브라우저 다운로드 없음)
4. CSS 차트 유지 (결정 ①) — 변경 없음
- DB 변경 없음. 문서: execution.md(필터·hour 제한·웹 테스트)/README 갱신

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 7 | TASK-0701 — Dashboard Web UI | 승인 (CSS 차트 확정) |
| Sprint 7 | **TASK-0702 — Dashboard Filter & Web Testing** | **완료 (`1f9ab8b`) — 승인 대기** |
| Sprint 1~6 | Foundation ~ Execution 관측 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit | 122 | ✅ (변경 없음) |
| `apps/api` | Service+API — 기존 155 · **stats 필터 1 + hour 제한 1** | 157 | ✅ |
| `apps/web` | **Playwright e2e (신규 게이트)** | 4 | ✅ |
| **합계** | | **283** | **전체 통과** |

신규 테스트가 검증하는 것:
- API: stats의 feature/provider/model where 적용, hour 31일 초과 400 +
  기본 31일 창 적용(day/week는 무제한 유지)
- 웹 e2e: 위 3.의 4개 시나리오 — 특히 Filter 테스트는 화면 쿼리 →
  API 쿼리 전달을 스텁 기록으로 직접 검증

라이브 검증 (실 PostgreSQL + 실데이터 + 브라우저):
- `stats?feature=dev` → totals 4건·byProvider(mock 3/openai 1)로 정확 축소
- hour 31일 초과 범위 → 400 메시지, hour 무지정 → 최근 31일 창 정상
- 브라우저: `/executions?feature=dev&interval=hour` → 필터 폼(선택값 유지)·
  KPI(호출 4·75%)·차트·테이블 전부 필터 반영 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 관측 콘솔 완성 + 웹 품질 게이트 편입**:

```
pnpm test (품질 게이트)
 ├─ core: Jest 122         ├─ /executions 화면
 ├─ api : Jest 157         │   ├ Filter(Feature/Provider/Model/From/To) → stats·timeline 동시 적용
 └─ web : Playwright 4 ←신규│   └ hour ≤ 31일 (API 강제)
     └─ 스텁 API로 Dashboard/Filter/Empty/Error 결정적 재현
```

① 웹이 처음으로 자동화 게이트에 포함 — 이후 모든 TASK의 게이트가 3개
워크스페이스 테스트를 통과해야 함. ② 필터는 API가 원값 처리(정확 일치·
UTC), UI는 표현만 담당 — 기존 역할 분리 원칙 유지. ③ e2e는 스텁 기반이라
DB/외부 의존 없이 CI에서 결정적으로 동작.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증 · Timeline 표준(UTC·ISO Week) · CSS 차트

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 16건(변경 없음), drift 없음, 신규 의존성 @playwright/test(web)

## 6. 데이터 모델

(TASK-0702는 스키마 변경 없음)

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| Execution | `GET /executions/stats?from=&to=&feature=&provider=&model=` (**필터 확장**) · `GET /executions/timeline` (**hour ≤ 31일**) |

웹: `/executions` — **Dashboard Filter 추가** (Feature/Provider/Model/From/To)

## 8. 리스크·기술 부채

1. **0702 해석 미확인** — Stats API 필터 확장(지시는 화면 필터였음)·hour
   기본 31일 창·Provider/Model 자유 입력 방식 (CTO_REQUEST #28)
2. **e2e는 스텁 기반** — 실 API 통합 e2e는 아님 (결정적 CI를 위한 선택 —
   실환경 스모크는 운영/스테이징 실키 테스트와 함께 수행 권장)
3. **웹 e2e 실행 조건** — 로컬에서 dev 서버(3000)와 병행 실행 시 .next 충돌
   가능 (CI에서는 무관, 로컬은 dev 중지 후 테스트)
4. **실키 스모크 테스트(운영/스테이징)** — 대기 (CTO 결정)
5. **Anthropic/Gemini 공식 연결** — 대기

## 9. 다음 권장 사항 (Sprint 7 후속 후보)

1. **CTO_REQUEST #28 확인** — TASK-0702 해석 확인 및 다음 지시
2. **실키 스모크 테스트(운영/스테이징)** — 대시보드+필터로 비용/오류 즉시 관측 가능
3. **Anthropic/Gemini 공식 연결** — OpenAI 5항목 패턴 재적용
4. **Provider/Model 필터 자동완성** — stats 응답의 key 목록으로 datalist 제공
5. **Content 발행 파이프라인** — DRAFT → REVIEW → PUBLISHED (제안 백로그)
