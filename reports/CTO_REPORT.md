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
| 보고 기준 TASK | **TASK-1102 — Experiment Analytics & Recommendation** (Sprint 11) |
| 보고일 | 2026-07-28 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **변형 성과 비교 + 승자 추천(신뢰도 포함)** · 권한 분리(Promote/Rollback ADMIN) · 재배정 Audit |
| 구현 중단 상태 | **TASK-1102 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 최소 표본·판단 순서·관측 기간 초기화 → **CTO_REQUEST #42 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **502** — core 210(+16) · api 256(+9) · **web e2e 36(+2)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1102 — Experiment Analytics & Recommendation

지시 7항목 전부 이행. 승격은 운영자 수동 절차이므로(CTO 결정 1101-③),
분석은 **결정을 대신하지 않고 근거를 만든다**는 방향으로 설계했다.

**1. Variant Performance Summary** — 변형별 호출·성공/실패·성공률·평균 지연·
비용·호출당 비용·토큰. 성공률에는 **Wilson 95% 신뢰구간**을 함께 준다.
"3/3 성공 = 100%"처럼 적은 표본을 확정처럼 보여주지 않기 위해서다.
근거는 배정이 아니라 **실행(Execution)** 이고(CTO 결정 1003-④), 지연은
호출 수로 **가중 평균**한다(그룹 평균의 단순 평균은 왜곡된다).

**2~4. Success Rate / Latency / Cost Comparison** — 가중치가 가장 큰 변형을
기준(baseline)으로 삼아 성공률 차이(%p)·지연 차이(ms)·호출당 비용 차이(USD)와
**성공률 차이의 신뢰도**를 낸다.

**5~6. Winner Recommendation & Confidence Score**

| 순서 | 판단 | 결과 |
| --- | --- | --- |
| 0 | 전 변형이 **최소 30회**를 채웠는가 | 아니면 **추천하지 않음** |
| 1 | 성공률 1·2위 차이 신뢰도 **≥ 95%** | 1위가 승자 (`success-rate`, **확정**) |
| 2 | 성공률이 통계적으로 동률 | **호출당 비용**이 싼 쪽 (`cost`, 참고) |
| 3 | 비용도 동률 | **평균 지연**이 짧은 쪽 (`latency`, 참고) |
| 4 | 어느 축도 차이 없음 | 추천 보류 |

**품질 우선**이다 — 비용이 싸도 실패하는 변형은 이기지 못한다. 성공률로
결정된 추천만 `conclusive: true`이고 비용·지연 근거는 참고로 표시하며,
모든 추천에 신뢰도와 **사람이 읽는 근거 문장**이 붙는다. 통계 함수
(`normalCdf`·`wilsonInterval`·`proportionConfidence`)는 core 순수 로직이다.

**7. Analytics Dashboard** — 웹 `/experiments` 실험 카드 안에 추천 배지
(확정/참고 색 구분)·근거 문장·기준 대비 비교표를 넣었다. 설정 → 배정 →
성과 → 추천이 한 화면에서 이어진다.

### CTO 결정 1101-④ 이행 — 권한 분리

**Start·Stop = EDITOR 이상**, **Promote·Rollback = ADMIN 전용**
(`@RequireRole("ADMIN")`). 구현 중 Express 5의 path-to-regexp가
`:action(start|stop)` 문법을 더는 지원하지 않아, **4개 명시 라우트**로
분리했다 — 결과적으로 권한 의도가 라우트에 그대로 드러나 더 명확해졌다.

### CTO 결정 1101-⑤ 이행 — 재배정 Audit

실험 정의가 바뀌어 고정 배정이 다시 정해지면 `experiment_assignment_events`에
남긴다: 프로젝트·이전/이후 변형·이전/이후 서명·사유
(`DEFINITION_CHANGED` / `VARIANT_UNAVAILABLE`). Assignment Dashboard에
사유와 함께 표시된다. **최초 배정은 재배정이 아니므로 기록하지 않는다.**

구현 중 스텁이 살아 있는 객체 참조를 돌려주는 바람에 "이전 배정"이 갱신
후 값으로 오염되는 것을 테스트가 잡아냈다. 스텁을 Prisma와 같게(복사본
반환) 고치고, 서비스에서도 갱신 전 값을 명시적으로 붙잡도록 했다.

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 11 | **TASK-1102 — Experiment Analytics & Recommendation** | **완료 — 승인 대기** |
| Sprint 11 | TASK-1101 — Sticky Assignment & Experiment Lifecycle | 승인 (`5514b33`) |
| Sprint 10 | 1001~1003 라우팅·Failover·실험 | 전체 승인 · 공식 종료 |
| Sprint 9 | 0901~0903 실 Provider 연결·비용 거버넌스 | 전체 승인 · 공식 종료 |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 194 · **분석·통계 16** | 210 | ✅ |
| `apps/api` | Service+API — 기존 247 · **분석 6 · 권한 3** | 256 | ✅ |
| `apps/web` | Playwright e2e — 기존 34 · **분석·재배정 2** | 36 | ✅ |
| **합계** | | **502** | **전체 통과** |

신규 테스트가 검증하는 것:
- **core(통계)**: `normalCdf` 기준값(0/±1.96/3) · Wilson 구간(**3/3 성공에도
  하한이 1이 아님**·표본이 크면 좁아짐) · 2-비율 신뢰도(차이·표본이 클수록
  높아짐, 동률·표본 0이면 0)
- **core(분석)**: 성공률·호출당 비용·신뢰구간 계산 · **가중치 최대 변형이
  기준** · 기준 대비 3축 차이 · 가격표 없는 변형은 비용 null · 승자 추천
  5경로(표본 부족 / **성공률 확정** / **비싸도 성공률 우선** / 비용 / 지연 /
  전부 동률 보류) · 최소 표본 기준 조정
- **api**: Execution 집계(**실험과 무관한 변형 제외**, 지연 호출 수 가중
  평균) · 기준 대비 비교 · 근거·신뢰도 동반 추천 · 표본 부족 시 보류 ·
  대상 아닌 feature 400 · **권한 3종**(Start/Stop EDITOR 200 · Promote/
  Rollback EDITOR 403·ADMIN 200 · 미인증 401) · **재배정 Audit**(최초 배정은
  미기록, 정의 변경 시 사유·from/to 기록, 재사용 시 중복 기록 없음)
- **웹 e2e**: 추천 배지·신뢰도·근거 문장·기준 대비 비교(부호 포함) ·
  재배정 이력 사유 표시

라이브 검증 (실 PostgreSQL + 실스택, `LLM_EXPERIMENT_ANALYSIS=
sonnet-canary|ab|mock=50,openai=50`, openai는 무효 키):

- **표본 부족 단계**: mock 1회·openai 3회에서 **추천 보류**, mock 성공률
  100%지만 Wilson 구간 **0.21~1.00**으로 과신하지 않음을 확인
- **표본 축적 후**: mock 34회(100%)·openai 102회(0%) → 추천 **mock**,
  근거 `success-rate`, **신뢰도 1.0000·확정**, 비교 −100.0%p
- **재배정 Audit(결정 ⑤)**: 정의를 `mock=70,openai=30` → `mock=50,openai=50`
  으로 바꾸자 두 프로젝트 모두 `DEFINITION_CHANGED` 이력 기록
- **권한(결정 ④)**: EDITOR — stop 200 · start 200 · **promote 403 ·
  rollback 403** / ADMIN — **promote 200 · rollback 200**
- 브라우저 `/experiments` Analytics 렌더링 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 실험에 "판단 근거" 계층 추가**:

```
Execution(실제 수행) ──▶ groupBy(provider, model, status)  ※ 마지막 START 이후
                             │
실험 정의(환경변수) ─────────┤
                             ▼
                    analyzeExperiment (core 순수 로직)
                      ├─ Variant Performance (+ Wilson 구간)
                      ├─ Baseline 대비 비교 (성공률/지연/비용)
                      └─ recommendWinner  성공률 → 비용 → 지연
                             ▼
                    GET /llm/experiments/:feature/analytics ─▶ 웹 대시보드
                             ※ 승격은 사람이 판단 (결정 1101-③)
```

① 통계·판단이 **core 순수 로직**이라 DB 없이 경계 조건까지 테스트로
고정된다. ② 분석은 **실행(Execution)** 을 근거로 삼아, 배정(의도)과 결과를
분리한 결정 1003-④를 그대로 따른다. ③ 추천은 **확정(`conclusive`)과 참고를
구분**해, 통계적 근거가 없는 제안을 확정처럼 보이지 않게 했다. ④ 권한이
라우트 단위로 드러나 승격 같은 고위험 조작의 등급이 코드에서 읽힌다.

**유지되는 핵심 결정**: 단일 관문 · Code-first 정의 · 미설정 시 기존 동작 ·
Failover 오류 분류(1002 승인 ①) · 실험 표기법(1003 승인 ②) · kind는
메타데이터(1003 승인 ③) · 배정/실행 분리(1003 승인 ④) · 기본 RUNNING
(1101 승인 ①) · Project 기반 Sticky(1101 승인 ②) · 승격은 수동(1101 승인 ③)

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 23건**
(이번 TASK +1), drift 없음

## 6. 데이터 모델

**마이그레이션 23 — `experiment_assignment_events` 신설** (기존 테이블 변경 없음):
feature·projectId·사유·이전/이후 변형·이전/이후 서명·시각. 재배정이 조용히
일어나지 않도록 남기는 감사 기록이다(CTO 결정 1101-⑤).

분석은 **별도 저장 없이** Execution 집계로 계산한다 — 지표를 이중으로
저장하면 실행 이력과 어긋날 수 있기 때문이다.

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 분석 | **`GET /llm/experiments/:feature/analytics`** — 변형 성과·비교·추천·신뢰도 |
| 전이 | `POST /llm/experiments/:feature/start` · `/stop` — **EDITOR 이상** |
| 전이 | `POST /llm/experiments/:feature/promote` · `/rollback` — **ADMIN 전용** (결정 ④) |
| 배정 | `GET /llm/experiments/assignments` — **`reassignments`** 추가 (결정 ⑤) |

웹: `/experiments` 실험 카드에 Analytics 영역, 배정 표에 재배정 이력 추가

## 8. 리스크·기술 부채

1. **1102 해석 미확인** — 최소 표본·판단 순서·관측 기간 초기화
   (CTO_REQUEST #42)
2. **관측 기간이 START마다 초기화된다** — STOP→START를 하면 그 전에 모은
   근거가 분석에서 빠진다. 라이브 검증 중 실제로 겪었다(권한 테스트로
   START를 호출하자 관측 0건). 의도된 설계이나 운영상 불편할 수 있다(#42 ③)
3. **다중 비교 보정 없음** — 변형이 3개 이상이면 1·2위만 검정하므로
   다중 비교로 인한 위양성 가능성이 있다. 2변형 A/B에서는 문제없다
4. **비용 비교는 가격표가 있는 변형끼리만** — 미등록 모델은 비용 null이라
   비용 근거 판단에서 제외된다(성공률·지연은 정상 비교)
5. **승격은 여전히 수동** — 결정 1101-③에 따른 것이며, 추천은 근거만 제공
6. **실키 스모크·Rate Limit 인메모리·건강 상태 인스턴스별 학습** — 기존 부채

## 9. 다음 권장 사항 (Sprint 11 후속 후보)

1. **CTO_REQUEST #42 확인** — TASK-1102 해석 확인 및 다음 지시
2. **실험 종료 워크플로** — 추천 확정 → 승격 → 라우팅 기본값 반영 →
   실험 정의 정리까지의 절차를 화면에서 한 흐름으로
3. **기간 지정 분석** — 현재는 관측 시작 이후 전체. 최근 N일 비교가 있으면
   품질 변화 추적이 쉬워진다
4. **Provider 설정 ADMIN 화면** — 라우팅·우선순위·예산·실험 정의의 화면 관리
5. **운영/스테이징 실키 스모크** — 3사 각 1회 (0901 승인 ③ 정책)
