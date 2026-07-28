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
| 보고 기준 TASK | **TASK-1101 — Sticky Assignment & Experiment Lifecycle** (Sprint 11) |
| 보고일 | 2026-07-28 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **Project 기반 고정 배정**(결정적 해시) + 실험 운영 상태(Start/Stop/Promote/Rollback) + Assignment Dashboard |
| 구현 중단 상태 | **TASK-1101 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 배정 주체·기본 상태·승격 후 정리·권한 등급 → **CTO_REQUEST #41 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **475** — core 194(+20) · api 247(+12) · **web e2e 34(+4)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1101 — Sticky Assignment & Experiment Lifecycle

지시 5항목 전부 이행. 실험 **정의**는 환경변수가 원천이라는 결정(1003-②)을
유지하고, 이번 TASK는 **누가 어떤 변형을 받는지**와 **실험의 운영 상태**를 더한다.

**1. Project 기반 Sticky Assignment**

같은 프로젝트는 항상 같은 변형을 받는다. 핵심은 배정을 저장소가 아니라
**결정적 해시**로 정한 것이다:

```
변형 = 가중추첨(변형목록, random = hash(정의서명 + projectId))
```

저장소가 비어 있어도, 재기동해도, 여러 인스턴스에서도 결과가 같다. 저장
(`experiment_assignments`)은 관측·감사용이며 **저장 실패가 호출을 실패시키지
않는다**. 정의 **서명**(`변형=가중치` 목록)이 바뀌면 기존 배정은 무효가 되어
다시 배정되고, 이름·종류만 바꾸면 서명은 그대로다(표시용 메타데이터 —
CTO 결정 1003-③). `projectId`는 Content Generation·Product Analysis·
Vision Analysis 호출 경로에서 전달되며, 없으면 기존 무상태 추첨이다.

**2~4. Start / Stop / Promote / Rollback**

| 상태 | 동작 |
| --- | --- |
| **RUNNING** (기본) | 변형 배정 진행. **행이 없으면 이 상태** — TASK-1003 동작이 보존되어 실험을 켜려고 별도 조작이 필요 없다 |
| **STOPPED** | 실험 미적용, **기존 라우팅**으로 처리. 배정 기록은 보존 |
| **PROMOTED** | 배정 없이 **승자 변형으로 전 트래픽** |

- **Promote**는 승자가 **현재 정의에 있어야** 한다(없으면 400). 승자 Provider를
  쓸 수 없게 되면 라우팅으로 강등된다 — 승격이 장애로 이어지지 않는다.
- **Rollback**은 직전 전이의 **이전 상태**로 되돌린다(이력 없으면 RUNNING).
  ROLLBACK 자체는 되돌리기 대상에서 제외해 무한 왕복을 막았다.
- 상태 갱신과 이력 기록은 **한 트랜잭션** — 감사 이력이 상태와 어긋나지 않는다.
- 전이는 쓰기 API이므로 전역 WriteProtectionGuard가 **EDITOR 이상**을 요구하고
  수행자(actor)가 이력에 남는다.

**5. Assignment Dashboard**

웹 `/experiments`에 상태 배지·조작 버튼(시작/중단/되돌리기/변형별 승격)·
전이 이력이 붙고, 하단에 **프로젝트별 배정 표**가 나온다.
`GET /llm/experiments/assignments`가 원천이다.

**구현 중 발견해 고친 결함**: 해시를 FNV-1a만으로 쓰면 `proj-1`, `proj-2`처럼
**연속적인 프로젝트 ID가 비슷한 값으로 뭉쳐** 배정이 한쪽으로 완전히 쏠렸다
(12개 프로젝트가 전부 한 변형으로 감 — 실제 테스트에서 재현). MurmurHash3의
최종 혼합(fmix32)을 한 단계 더 돌려 해결하고, **이 실패 형태를 그대로 재현하는
회귀 테스트**를 남겼다. 순번 ID를 쓰는 환경에서는 실험이 통째로 무의미해지는
결함이라 조용히 고치지 않고 보고에 남긴다.

### CTO 결정 1003-①~④ 반영

| 결정 | 반영 |
| --- | --- |
| ① `unknown` 오류는 Failover 대상 아님 | **현행 유지 — 공식 표준으로 확정**(코드 변경 없음) |
| ② 표기법 `이름\|종류\|변형=가중치` 유지 | 현행 유지. 정의는 계속 환경변수가 원천이고, 이번 TASK의 상태는 별도 계층으로 분리 |
| ③ kind는 운영 메타데이터 (알고리즘 무영향) | 현행 유지. **배정 서명에서 kind·이름을 제외**해 "표시용"임을 코드로 못박음 |
| ④ 배정과 실행 분리 | Assignment(실험 결과)와 Execution(수행 결과)을 각각 저장·표시. 대시보드가 둘을 나란히 유지 |

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 11 | **TASK-1101 — Sticky Assignment & Experiment Lifecycle** | **완료 — 승인 대기** |
| Sprint 10 | 1001~1003 라우팅·Failover·실험 | 전체 승인 · **공식 종료** |
| Sprint 9 | 0901~0903 실 Provider 연결·비용 거버넌스 | 전체 승인 · 공식 종료 |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 174 · **Sticky·Lifecycle 20** | 194 | ✅ |
| `apps/api` | Service+API — 기존 235 · **Lifecycle·배정 12** | 247 | ✅ |
| `apps/web` | Playwright e2e — 기존 30 · **배정·전이 4** | 34 | ✅ |
| **합계** | | **475** | **전체 통과** |

신규 테스트가 검증하는 것:
- **core**: 해시 결정성·범위·분포 · **연속 키 뭉침 회귀 테스트** · 서명
  (변형 변경 시 달라짐 / 이름·종류 변경 시 동일) · Sticky(같은 프로젝트 20회
  동일 · 프로젝트별 분산 · 저장 배정 재사용 · 서명 불일치 시 재배정 · 사용 불가
  변형이면 재배정 · 전부 불가면 null) · 전이 규칙 4종(START 승자 해제 · STOP
  승자 보존 · PROMOTE 검증 · ROLLBACK 복원/기본값) · 상태별 적용 판정
- **api**: Sticky 15회 동일 변형·배정 1건만 저장 · 40개 프로젝트 분산 ·
  projectId 없으면 저장 안 함 · **STOP → 라우팅으로 전환** · START 재개 ·
  **Promotion → 1% 변형도 전 트래픽** · 정의에 없는 변형 400 · **Rollback** ·
  전이 감사 이력 · Assignment Dashboard(목록·분포) · **정의 변경 시 재배정** ·
  experiments()에 운영 상태 동반
- **웹 e2e**: 배정 표 렌더링 · **중단 → 상태 배지·이력 갱신** · **승격 →
  승자 표시** · 미인증 전이 안내

라이브 검증 (실 PostgreSQL + 실스택, `LLM_EXPERIMENT_ANALYSIS=
sonnet-canary|canary|mock=70,openai=30`, `LLM_ROUTE_ANALYSIS=anthropic`):

- **Sticky**: 같은 상품(프로젝트) 분석 **6회 연속 모두 배정 변형(openai)로
  호출**, 배정 행은 1건만 저장(서명 `mock=70,openai=30`)
- **프로젝트별 분산**: 서로 다른 두 프로젝트가 각각 `openai` / `mock`으로 배정
- **STOP** → 다음 호출이 **라우팅 규칙(anthropic)** 으로 나감
- **PROMOTE(mock)** → 다음 호출이 **mock으로 SUCCESS** · 정의에 없는
  `gemini` 승격은 **400**(`변형 "gemini"은 현재 실험 정의에 없습니다`)
- **ROLLBACK** → `PROMOTED → STOPPED`로 직전 상태 복원, 이력 3건 확인
- **미인증 전이** → **401**
- 브라우저 `/experiments` 렌더링 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 실험에 "주체"와 "상태"가 생김**:

```
호출(feature, projectId) ─▶ LlmService (단일 관문)
                              ├─ 예산 → 라우팅(1001)
                              ├─ 실험(1003) 있으면:
                              │    ├─ Lifecycle(1101)  STOPPED → 미적용 / PROMOTED → 승자 고정
                              │    └─ RUNNING → projectId 있으면 Sticky(결정적 해시), 없으면 추첨
                              ├─ Failover 체인(1002)
                              └─ Execution 기록 ─▶ byVariant (실행 결과)
                                   ※ 배정(Assignment)은 별도 저장 — 결정 1003-④
```

① 배정 규칙·전이 규칙이 **core 순수 로직**으로 분리돼 저장소 없이 단위
테스트로 고정된다. ② 배정이 **해시로 결정**되므로 저장소는 관측용 부가물이
되고, DB 장애가 배정 일관성을 깨지 않는다. ③ 정의(환경변수)와 상태(DB)를
분리해, Code-first 원칙을 지키면서도 운영 중 조작이 가능해졌다. ④ 상태 계층이
추가돼도 **행이 없으면 RUNNING**이라 기존 동작이 그대로 유지된다.

**유지되는 핵심 결정**: 단일 관문 · Code-first 정의 · 미설정 시 기존 동작 ·
Failover 오류 분류(1002 승인 ①) · Health 표준 3회/60초(1002 승인 ③) ·
실험 표기법(1003 승인 ②) · kind는 메타데이터(1003 승인 ③) · 배정/실행 분리
(1003 승인 ④)

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 22건**
(이번 TASK +1), drift 없음

## 6. 데이터 모델

**마이그레이션 22 — 실험 운영 상태·배정 3개 테이블 신설** (기존 테이블 변경 없음):

| 테이블 | 내용 |
| --- | --- |
| `experiment_states` | feature별 상태(RUNNING/STOPPED/PROMOTED)·승자 변형·수행자 (feature 유니크) |
| `experiment_events` | 전이 이력 — action·from/to 상태·from/to 변형·actor·note (Rollback 근거 겸 감사) |
| `experiment_assignments` | Project → 변형 고정 배정 + 정의 서명 (`feature+projectId` 유니크) |

실험 **정의**는 여전히 환경변수이며 DB에 저장하지 않는다.

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 배정 | **`GET /llm/experiments/assignments`** — Project별 배정·변형 분포 (`?feature=`) |
| 전이 | **`POST /llm/experiments/:feature/:action`** — `start`/`stop`/`promote`/`rollback` (EDITOR 이상, promote는 `variantKey`) |
| 실험 | `GET /llm/experiments` — 응답에 **`lifecycle`** 추가 |
| 그 외 | 변경 없음 (호출 계약 동일) |

웹: `/experiments`에 상태 배지·조작 버튼·전이 이력·배정 표 추가

## 8. 리스크·기술 부채

1. **1101 해석 미확인** — 배정 주체·기본 상태·승격 후 정리·권한 등급
   (CTO_REQUEST #41)
2. **배정 주체가 Project 하나** — 사용자별·상품별 실험은 불가하다(지시대로
   Project 기반). 다른 축이 필요하면 스펙 필요
3. **승격 후에도 실험 정의가 남는다** — PROMOTED 상태로 승자만 쓰지만,
   환경변수의 변형 목록은 그대로다. "승격 → 라우팅으로 확정 → 실험 제거"의
   마지막 단계는 여전히 수동이다(#41 ③)
4. **전이 권한이 EDITOR** — 승격·되돌리기는 트래픽 100%를 바꾸는 조작이라
   ADMIN이 적절할 수 있다(#41 ④)
5. **통계적 유의성 판정 없음** — 승자 선택은 사람이 지표를 보고 판단한다
6. **다중 인스턴스** — 배정은 해시라 일관되지만, 상태 캐시 없이 매 호출
   DB를 조회한다(현재 규모에선 문제 없으나 캐시 여지)
7. **실키 스모크·Rate Limit 인메모리·건강 상태 인스턴스별 학습** — 기존 부채

## 9. 다음 권장 사항 (Sprint 11 후속 후보)

1. **CTO_REQUEST #41 확인** — TASK-1101 해석 확인 및 다음 지시
2. **실험 승격 완료 절차** — 승자를 라우팅 기본값으로 확정하고 실험 정의를
   비우는 절차의 자동화(현재 수동)
3. **실험 지표 요약** — 변형별 성공률·비용·지연의 기간 비교와 승자 추천
   (판정은 사람이 하되 근거를 한 화면에)
4. **Provider 설정 ADMIN 화면** — 라우팅·우선순위·예산·실험 정의의 화면 관리
5. **운영/스테이징 실키 스모크** — 3사 각 1회 (0901 승인 ③ 정책)
