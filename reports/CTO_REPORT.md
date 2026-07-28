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
| 보고 기준 TASK | **TASK-1201 — Provider Administration Console** (Sprint 12) |
| 보고일 | 2026-07-28 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **운영 중 설정 조정 콘솔**(Provider·모델·예산·실험 + 감사) — Code-first 원칙은 유지하고 오버라이드 계층으로 구현 |
| 구현 중단 상태 | **TASK-1201 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 오버라이드 계층 방식·다중 인스턴스 지연·라우팅 규칙 미포함 → **CTO_REQUEST #43 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **527** — core 220(+10) · api 265(+9) · **web e2e 42(+6)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1201 — Provider Administration Console

지시 5항목 전부 이행. 설계의 핵심 판단은 **Code-first 원칙을 깨지 않은 것**이다.
그동안 예산(0902-③)·실험 정의(1003-②)를 환경변수로 확정해 왔으므로, 콘솔을
새로운 진실 공급원으로 만들지 않고 **그 위에 얹는 오버라이드**로 두었다:

```
유효값 = 오버라이드(DB) ?? 환경변수 ?? 기본값
```

오버라이드가 하나도 없으면 **기존 동작과 완전히 같다**. 해제하면 환경변수로
되돌아가며, 화면은 각 값의 **출처(콘솔/환경변수/기본값)** 와 "해제하면 무엇으로
돌아가는지"를 함께 보여준다 — 운영자가 지금 무엇이 적용 중인지 헷갈리지 않게.

| 영역 | 설정 키 | 비고 |
| --- | --- | --- |
| **Provider Enable/Disable** | `provider.<name>.enabled` | 끄면 라우팅·실험·Failover 후보에서 제외. **마지막 하나는 끌 수 없다**(400) |
| **Model Management** | `model.<feature>` | `LLM_MODEL_*`보다 우선 |
| **Budget Management** | `budget.daily` · `monthly` · `alertRatio` | `LLM_*_BUDGET_USD`보다 우선 |
| **Experiment Management** | `experiment.<feature>` | 실험 정의 문자열 — 해석 가능한 값만 |
| **Audit Log** | — | 누가·무엇을·이전→이후·시각 |

- **검증은 저장 시점에** 한다. 잘못된 값이 들어가면 다음 호출부터 라우팅이
  깨지므로, 알 수 없는 Provider·음수 예산·해석 불가한 실험 정의·지원하지 않는
  키를 400으로 막는다.
- **읽기 성능**: 설정은 LLM 호출마다 참조되므로 DB 왕복을 넣을 수 없다. 기동 시
  전부 인메모리로 적재하고 쓰기 때 즉시 갱신하며, TTL(기본 10초) 경과 시
  **백그라운드로** 다시 읽는다 — 조회는 끝까지 동기다.
- 네 영역을 **하나의 키 네임스페이스**로 통일했다. 관리 대상은 넷이지만
  저장·검증·감사·조회 경로를 하나로 두는 편이 어긋날 여지가 적다.

**라이브 검증 중 발견해 고친 보안 결함**: `GET /admin/console`과
`/admin/audit`이 **미인증 200**으로 열려 있었다. 전역 WriteProtectionGuard가
쓰기만 막고 조회는 기존 정책상 비보호이기 때문인데, 콘솔의 GET은 예산·모델
구성과 **감사 이력의 수행자 이메일**을 노출한다. 컨트롤러에 `AuthGuard`를 붙여
조회까지 ADMIN 전용으로 만들고(`/llm/health`가 같은 이유로 별도 가드를 쓴
선례), 이 상태를 재현하는 회귀 테스트를 남겼다.

또한 라이브 기동에서 `LlmBudgetService`가 `LlmModule`에서 export되지 않아
콘솔이 뜨지 않는 문제가 드러났다 — 단위 테스트는 테스트 모듈에 직접 provider를
넣어 잡히지 않던 결함이다. export를 추가했다.

### CTO 결정 1102-①·③ 이행

| 결정 | 반영 |
| --- | --- |
| ① 최소 표본 기본 30 유지 + 환경변수 조정 | `LLM_EXPERIMENT_MIN_SAMPLES`로 조정 가능(미설정 시 30) |
| ② 추천 우선순위 성공률→비용→지연 | 현행 유지 — 변경 없이 확정 |
| ③ 관측 기간은 **Definition Signature 변경 시에만** 초기화 | START/STOP은 기간을 이어간다. `experiment_states`에 `signature`·`signatureChangedAt`를 두고, 정의가 바뀔 때만 갱신 |
| ④ 다중 비교 보정 미도입 | 현행 유지 |

③은 지난 보고에서 올린 운영상 불편(권한 테스트로 START를 눌렀더니 관측이
0건이 된 사례)을 그대로 해소한다.

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 12 | **TASK-1201 — Provider Administration Console** | **완료 — 승인 대기** |
| Sprint 11 | 1101~1102 Sticky·Lifecycle·Analytics | 전체 승인 · 공식 종료 |
| Sprint 10 | 1001~1003 라우팅·Failover·실험 | 전체 승인 · 공식 종료 |
| Sprint 9 | 0901~0903 실 Provider 연결·비용 거버넌스 | 전체 승인 · 공식 종료 |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 210 · **설정 검증·해석 10** | 220 | ✅ |
| `apps/api` | Service+API — 기존 256 · **콘솔 9** | 265 | ✅ |
| `apps/web` | Playwright e2e — 기존 36 · **콘솔 6** | 42 | ✅ |
| **합계** | | **527** | **전체 통과** |

신규 테스트가 검증하는 것:
- **core**: 키별 검증(Provider 존재·true/false · feature 유효성 · 예산 양수와
  임계 0~1 · 실험 정의 해석 가능 · 지원하지 않는 키) · 출처 해석(오버라이드 >
  환경변수 > 기본값, 빈 문자열도 오버라이드) · **전부 비활성이면 무시**
- **api**: 콘솔 현황(Provider 활성/후보·모델 출처·예산 기본값) · 변경 시
  오버라이드 우선 + **감사 기록** · 해제 시 환경변수 복귀 + `SETTING_CLEARED` ·
  Provider 토글 · **검증 5종 400 + 저장·감사 미발생** · 실험 정의 저장 ·
  **마지막 Provider 비활성 차단** · ADMIN 전용(EDITOR 403·미인증 401) ·
  **조회 보호 회귀 테스트**(GET 401/403)
- **웹 e2e**: 4개 영역 렌더링·출처 배지 · 변경 → 출처 전환 + 이력 표시 ·
  해제 → 환경변수 복귀 · Provider 토글 · 잘못된 값 안내 · 미인증 안내

라이브 검증 (실 PostgreSQL + 실스택, `LLM_DAILY_BUDGET_USD=10`,
`LLM_MODEL_ANALYSIS=gpt-4o-mini`):

- **Model Management**: `model.product-analysis=gpt-4o` 저장 → `/llm/routing`의
  해당 feature 모델이 **즉시 gpt-4o**(환경변수 gpt-4o-mini보다 우선)
- **Provider Enable/Disable**: openai 비활성 → 사용 가능 Provider가
  `['mock']`으로 축소
- **Budget Management**: `budget.daily=99` → `/llm/budget`의 일 예산 **99**
  (환경변수 10보다 우선)
- **Experiment Management**: 콘솔에서 정의 저장 → `/llm/experiments`에
  `console-canary`(canary, mock·openai) 반영
- **가드레일**: 마지막 Provider 비활성 **400** · 음수 예산 **400** · 잘못된
  실험 정의 **400** · 알 수 없는 키 **400**
- **권한**: EDITOR 설정 변경 **403** · 미인증 `GET /admin/console` **401**
  (수정 전 200 → 수정 후 401 재확인) · 미인증 `GET /admin/audit` **401**
- **감사**: 4건의 조작이 수행자(admin@acos.local)와 이전→이후 값으로 기록
- 브라우저 `/admin/console` 렌더링 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 설정에 오버라이드 계층 추가**:

```
설정 조회 (LLM 호출 경로, 동기)
   AdminSettingsService.get(key)   ← 인메모리 맵 (기동 적재 · 쓰기 즉시 · TTL 백그라운드)
        │  없으면
        ▼
   process.env[…]                  ← Code-first 기본
        │  없으면
        ▼
   기본값

콘솔 쓰기 (ADMIN)
   PUT /admin/settings/:key ─▶ validateSetting(core) ─▶ [DB 저장 + 감사] 한 트랜잭션
                                                    └─▶ 캐시 즉시 갱신
```

① 검증·해석이 **core 순수 로직**이라 저장소 없이 경계 조건까지 테스트로
고정된다. ② 오버라이드가 없으면 기존 경로와 **완전히 동일**해, 콘솔을 쓰지
않는 환경은 영향을 받지 않는다. ③ 설정 저장소를 전역 모듈로 분리해 LLM 계층과
콘솔 컨트롤러 사이의 **순환 의존을 만들지 않았다**. ④ 조회 경로가 동기로
유지돼 LLM 호출 지연이 늘지 않는다.

**유지되는 핵심 결정**: Code-first 설정 · 단일 관문 · 미설정 시 기존 동작 ·
Failover 오류 분류(1002 승인 ①) · 실험 표기법(1003 승인 ②) · 배정/실행 분리
(1003 승인 ④) · Project 기반 Sticky(1101 승인 ②) · 승격은 수동(1101 승인 ③) ·
Promote/Rollback ADMIN(1101 승인 ④) · 추천 우선순위(1102 승인 ②)

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 25건**
(이번 TASK +2), drift 없음

## 6. 데이터 모델

**마이그레이션 24 — `experiment_states`에 `signature`·`signatureChangedAt` 추가**
(CTO 결정 1102-③ 관측 기간 기준).

**마이그레이션 25 — 콘솔 2개 테이블 신설**:

| 테이블 | 내용 |
| --- | --- |
| `admin_settings` | 설정 오버라이드 (key 기본키·값·수행자·시각). 행이 없으면 환경변수로 동작 |
| `admin_audit_log` | 콘솔 조작 감사 (수행자·동작·키·이전/이후·비고·시각) |

환경변수는 여전히 기본 진실 공급원이며 DB에 복제하지 않는다.

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 콘솔 | **`GET /admin/console`** — Provider·모델·예산·실험 현황 + 각 값의 출처 |
| 설정 | **`PUT /admin/settings/:key`** — 변경/해제(`{value: null}` = 환경변수 복귀) |
| 감사 | **`GET /admin/audit`** — 변경 이력 |

전부 **ADMIN 전용**이며 **조회도 인증을 요구**한다.
웹: **`/admin/console`** (신설 — 홈 내비 "⚙️ Provider 관리 콘솔")

## 8. 리스크·기술 부채

1. **1201 해석 미확인** — 오버라이드 계층 방식·다중 인스턴스 지연·라우팅 규칙
   미포함 (CTO_REQUEST #43)
2. **다중 인스턴스 전파 지연** — 다른 인스턴스의 설정 변경이 최대 TTL(기본
   10초)만큼 늦게 보인다. 조회를 동기로 유지하기 위한 선택이며, 즉시 전파가
   필요하면 Redis pub/sub 등이 필요하다
3. **라우팅 규칙(`LLM_ROUTE_*`)은 콘솔 범위 밖** — 지시 5항목에 없어 넣지
   않았다. Provider 활성/모델/실험으로 대부분 조정 가능하나, feature→Provider
   매핑 자체는 여전히 환경변수 전용이다(#43 ③)
4. **오버라이드와 환경변수의 이중 관리** — 배포로 환경변수를 바꿔도 오버라이드가
   남아 있으면 계속 우선한다. 화면이 출처를 보여주는 것으로 완화했으나,
   운영 규칙(예: 배포 시 오버라이드 정리)이 필요할 수 있다
5. **실키 스모크·Rate Limit 인메모리·건강 상태 인스턴스별 학습** — 기존 부채

## 9. 다음 권장 사항 (Sprint 12 후속 후보)

1. **CTO_REQUEST #43 확인** — TASK-1201 해석 확인 및 다음 지시
2. **설정 변경 알림** — 예산·Provider 비활성 같은 영향 큰 변경을 운영 채널로
   알림(현재는 감사 이력만)
3. **오버라이드 일괄 정리** — 배포 후 남은 오버라이드를 한 번에 해제하는 절차
4. **라우팅 규칙 콘솔 편입** — 필요하다면 `LLM_ROUTE_*`도 같은 계층으로
5. **운영/스테이징 실키 스모크** — 3사 각 1회 (0901 승인 ③ 정책)
