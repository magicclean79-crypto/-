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
| 보고 기준 TASK | **TASK-1301 — Real AI Provider Production Integration** (Sprint 13) |
| 보고일 | 2026-07-28 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **실 Provider로 돈이 나가기 전에 확인해야 할 것들을 기계 판정으로** — 키 검증(조건부 필수·플레이스홀더)·비용 검증(예산 상한 무력화 탐지)·운영 모니터링(표본 부족 시 판정 보류)·Vision 3사 회귀 |
| 구현 중단 상태 | **TASK-1301 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | Live Check 정책·모니터링 기준값·진단 호출 분리 → **CTO_REQUEST #45 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **615** — core 275(+36) · api 290(+17) · **web e2e 50(+4)** — 전체 통과 |
| TypeScript | `tsc --noEmit` (4개 워크스페이스) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1301 — Real AI Provider Production Integration

지시 8항목 전부 이행. 이번 TASK의 축은 **"실 Provider로 넘어가는 순간 실패의
성격이 바뀐다"** 는 것이다. mock에서는 잘못된 설정이 테스트 실패로 끝나지만,
실 Provider에서는 **돈이 나가고, 사용자 요청이 깨지고, 그것을 나중에 안다**.
그래서 이번 구현은 전부 "사고가 나기 전에, 사람이 조치할 수 있는 형태로
드러내는" 쪽으로 설계했다.

**1~3. OpenAI / Anthropic / Gemini Production**

세 어댑터의 실 연결 자체는 TASK-0901·0903에서 완료된 상태다. 이번에는 그것을
**운영에서 신뢰할 수 있는가**를 다뤘다 — 키가 진짜인지, 비용이 맞는지, 지금
살아 있는지. 어댑터 코드는 손대지 않았고, 그 위에 판정 계층을 얹었다.

**4. Vision Production** — Vision은 세 Provider의 **이미지 전달 형식이 전부
다르다**.

| Provider | 형식 |
| --- | --- |
| OpenAI | `image_url` content part (data URL) |
| Anthropic | `image` content block (base64 + media_type) |
| Gemini | `inlineData` part (mimeType + data) |

하나만 맞고 나머지가 틀리면, 라우팅·Failover로 Provider가 바뀌는 순간
**이미지가 조용히 사라지고 "이미지 없이 추측한 결과"가 정상처럼 기록된다**.
실패도 아니고 오류도 아니라서 알아차릴 방법이 없다. 그래서 세 Provider에
같은 시나리오를 돌려 ① 이미지가 실제로 요청에 실렸는가 ② 결과 출처가
`llm:<provider>`인가 ③ Execution이 `vision-analysis`로 남는가를 고정했다.
이미지가 없을 때 헛된 첨부를 만들지 않는지도 함께 본다.

**5. API Key Validation** — `GET /llm/providers/validate` (ADMIN).

| 항목 | 의미 |
| --- | --- |
| `format` | `ok` / `missing` / `invalid` / `placeholder` — **형식만** 본다 |
| `required` | 설정에서 이 Provider를 참조하는가 (→ 운영 필수) |
| `instantiated` | 어댑터가 실제로 만들어졌는가 |
| `live` | Live Check 결과 — `?live=1`일 때만 |

- **키 값은 어떤 경로로도 나가지 않는다** — 앞 6자 힌트(`sk-pro…`)와 길이만.
  테스트가 응답 JSON에 키 원문이 없음을 직접 확인한다.
- **플레이스홀더를 별도 상태로 잡는다**: `sk-xxxx…`·`your-api-key`·
  `changeme`. 형식 검사만 하면 통과해 버리는데, 배포 사고의 단골이다.
- **Live Check는 기본으로 하지 않는다** — 실제 API를 호출해 과금되기 때문에
  버튼(또는 `?live=1`)으로만 실행하고, `liveChecked`로 실행 여부를 명시한다.
  형식이 맞아도 유효한 키라는 보장은 없고, 메시지에 그렇게 적는다.

**CTO 결정 1202-② 이행** — "실제 AI Provider 연결 시 Provider API Key를
추가하십시오". 이를 필수 목록에 한 줄 더 적는 대신 **조건부 필수**로 구현했다.
`packages/core/src/ops/env-spec.ts`의 세 Provider 키 항목에 `requiredWhen`
(설정에서 참조하면 운영 필수)과 `validate`(형식 검사)를 걸었다. 참조 여부는
`LLM_PROVIDER`·`LLM_ROUTE_*`·`LLM_FAILOVER_PRIORITY`·`LLM_EXPERIMENT_*`를
훑어 판정하며, 부분 문자열 오탐을 막는다(`openai-legacy`가 있다고 `openai`를
참조한 것은 아니다).

이 한 곳의 변경으로 배포 준비 검증(`/health/ready`)과 **Fail Fast 기동**
(1202 승인 ①)에 그대로 반영된다 — **참조하는데 키가 없으면 운영에서 서버가
뜨지 않는다**. 쓰지 않는 Provider의 키는 여전히 없어도 된다.

**6. Provider Smoke Test** — `scripts/real-provider-smoke.mjs` 확장.

- API Key 검증(형식 + `SMOKE_LIVE_CHECK=1`이면 Live Check)
- **키가 설정된 모든 Provider**의 Health Check — 기본 하나만 확인하면
  라우팅·Failover로 전환되는 순간에야 장애를 처음 알게 된다
- **Vision(`vision-analysis`) 커버리지 필수화**
- 비용 검증·운영 모니터링 판정(critical 경보가 있으면 실패)

ADMIN 권한이 없어 건너뛴 항목은 `…`로 표시하고 **실패로 세지 않는다** —
확인하지 못한 것을 통과라고 하지 않기 위해서다(마이그레이션 `manual`과 같은 태도).

**7. Cost Verification** — 기록된 Execution 비용을 가격표로 **다시 계산해**
대조한다.

| 문제 | 뜻 | 조치 |
| --- | --- | --- |
| `unpriced` | 가격표에 없는 모델 | **예산 상한이 무력화된다** — 단가 등록 |
| `mismatch` | 기록 비용 ≠ 재계산 | 단가 변동/기록 시점 차이 확인 |
| `missing-usage` | 토큰이 없어 산정 불가 | Provider 응답의 usage 확인 |

세 가지를 **구분하는 이유는 조치가 다르기 때문**이다. `unpriced`를 가장 크게
다루는 이유는 더 분명하다 — 비용이 `null`로 남으면 예산 합계에서 빠지고,
그러면 **일/월 예산 상한이 조용히 무력화된다**. 화면에서 바로 조치할 수 있도록
응답에 가격표를 함께 싣는다.

**8. Production Monitoring** — `GET /llm/monitoring` (ADMIN).

- **표본이 적으면 판정하지 않는다** — 기본 5회 미만이면 `unknown`. 1회 실패로
  "장애"라고 말하지 않는다(실험 분석의 최소 표본 원칙과 같은 태도).
- **p50/p95/p99**를 함께 낸다 — 평균만 보면 꼬리 지연을 놓친다. 백분위수는
  **최근접 순위**(보간 없음)라 관측되지 않은 값을 지어내지 않는다.
- 상태: `healthy`(≥95%) / `degraded`(≥50%) / `down`(<50%) / `unknown`.
  전체 상태는 **가장 나쁜 Provider**를 따른다 — 하나가 죽었으면 전체가
  정상이 아니다.
- **실패 호출의 `cost=null`은 미산정으로 세지 않는다** — 실패는 usage가 없는
  게 정상이라, 그러지 않으면 "예산 상한 무력화" 경보가 늘 울려 무뎌진다.

**웹 `/admin/production`** (ADMIN 전용, 홈 내비 "📡 Provider 운영 점검") —
키 검증 표(형식 배지·힌트·운영 필수·사용 가능·Live) · Live Check 버튼(과금을
버튼 문구에 명시) · 모니터링(상태·성공률·p50/p95/p99·비용·경보) · 비용 검증
(기록 vs 재계산·문제 목록·등록 단가).

**API 3종 전부 ADMIN 전용** — 조회도 보호한다. 결정 1201-⑤와 같은 판단으로,
이 GET들은 어떤 Provider를 쓰는지·예산이 얼마나 나갔는지·키가 어떤 상태인지
같은 **운영 설정 지형을 드러내기** 때문이다. 전역 WriteProtectionGuard는 쓰기만
막으므로 컨트롤러에 `@UseGuards(AuthGuard)`를 명시했고, 회귀 테스트로 고정했다.

### CTO 결정 1202-①~④ 반영

| 결정 | 반영 |
| --- | --- |
| ① 운영 필수 오류 시 Fail Fast | 현행 유지 — Provider 키 조건부 필수가 여기에 그대로 편입 |
| ② 운영 필수 목록 + **실 Provider 연결 시 키 추가** | **이번 TASK에서 이행** — 목록 추가가 아니라 `requiredWhen` 조건부 필수로 구현(쓰지 않는 키는 계속 불필요) |
| ③ 스모크·백업은 Manual 유지 | 현행 유지 — 스모크 스크립트를 강화하되 체크리스트 판정은 `manual` 그대로 |
| ④ 다음 Sprint에서 CI/CD가 `/health/ready` 자동 판정 | 미착수 — Sprint 14 지시 대기 |

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 13 | **TASK-1301 — Real AI Provider Production Integration** | **완료 — 승인 대기** |
| Sprint 12 | 1201~1202 관리 콘솔·운영 준비 | 전체 승인 · 공식 종료 |
| Sprint 11 | 1101~1102 Sticky·Lifecycle·Analytics | 전체 승인 · 공식 종료 |
| Sprint 10 | 1001~1003 라우팅·Failover·실험 | 전체 승인 · 공식 종료 |
| Sprint 9 | 0901~0903 실 Provider 연결·비용 거버넌스 | 전체 승인 · 공식 종료 |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 239 · **API Key 12 · 비용 검증 9 · 모니터링 11 · 조건부 필수 4** | 275 | ✅ |
| `apps/api` | Service+API — 기존 273 · **운영 점검 12 · Vision Production 4 · 권한 1** | 290 | ✅ |
| `apps/web` | Playwright e2e — 기존 46 · **운영 점검 4** | 50 | ✅ |
| **합계** | | **615** | **전체 통과** |

신규 테스트가 검증하는 것:

- **core(API Key)**: 형식 정상이어도 "Live Check 필요"를 명시 · Provider별
  접두사(openai 키를 anthropic에 넣은 전형적 실수 탐지) · 미설정은 `missing` ·
  **플레이스홀더 5종** · 공백 섞임/길이 부족 · **키 값 비노출(원문 문자열이
  응답에 없음)** · 알 수 없는 Provider는 길이만 · 참조 판정(기본/라우팅/
  Failover/실험) · **부분 문자열 오탐 방지** · mock은 키 불필요
- **core(비용 검증)**: 가격표 일치 시 무문제 · `unpriced`가 **"예산 상한이
  적용되지 않습니다"** 를 말함 · `mismatch` 기록·기대 합계 제시 · **토큰 없음은
  `unpriced`가 아니라 `missing-usage`**(조치가 다르므로) · 스냅샷 모델 접두사
  매칭 · 반올림 오차 허용 · 모델·Provider 단위 묶음 · 빈 표본 통과
- **core(모니터링)**: 최근접 순위 백분위수(관측 안 된 값 미생성) · Provider별
  성공률·지연·비용 · **표본 부족 시 `unknown`** · degraded/down 임계 ·
  p95 경고 · **성공했는데 비용 없음 = 예산 상한 무력화 경보** · 전체 상태는
  최악을 따름 · **호출이 없으면 정상이라고 말하지 않음** · 기준값 조정 가능
- **core(조건부 필수)**: 쓰지 않는 Provider 키는 운영에서도 불필요 · 참조하는데
  없으면 error · 형식 오류는 환경 무관 error · **설정 현황에도 조건부 필수 반영**
- **api(운영 점검)**: 환경변수를 읽어 보고 · **키 값 비노출** · blocker 산출 ·
  **Live Check 기본 미실행(과금 방지)** · 어댑터가 만들어진 Provider만 실호출 ·
  **Live Check 예외도 보고서로 회수** · 성공 Execution만 조회 · 구간 1시간~30일
  제한 · 모니터링은 실패도 조회(성공률 계산에 필요) · 호출 없으면 `unknown`
- **api(Vision Production)**: OpenAI data URL · Anthropic base64 block(+vision
  상한 2048) · Gemini `inlineData` · **이미지 없으면 헛된 파트 미생성**
- **api(권한)**: 3개 엔드포인트 전부 **미인증 401 · EDITOR 403**(조회도 보호)
- **웹 e2e**: 정상 상태 3영역 렌더링(키 힌트만·Live 미실행 표시) · 문제 상태
  (blocker·경보·예산 상한 문구) · **Live Check는 눌러야 실행** · 미인증 안내

라이브 검증 (실 PostgreSQL + s3rver + 실스택):

- **접근 제어**: `/llm/providers/validate`·`/llm/cost-verification`·
  `/llm/monitoring` 미인증 **401 3/3**
- **조건부 필수 + 플레이스홀더 (CTO 결정 1202-②)**: `LLM_PROVIDER=openai`,
  `OPENAI_API_KEY=sk-xxxx…`, `LLM_FAILOVER_PRIORITY=openai,anthropic`로 기동 →
  `openai: format=placeholder, required=true` · `anthropic: missing,
  required=true` · `gemini: required=false`, **blocker 2건**
  ("실제 키로 교체하세요" / "설정에서 참조하는데 ANTHROPIC_API_KEY가 없습니다")
- **Live Check**: `?live=1` → 어댑터가 만들어진 openai만 실호출,
  `403 Host not in allowlist: api.openai.com`(샌드박스 egress 차단)을
  **예외로 죽지 않고 `live.status=error` + blocker로 회수**
- **모니터링**: mock 호출 6건 → `healthy` · 성공률 1.0 · p50/p95/p99 산출.
  실패한 Live Check 1건이 섞인 openai는 표본 1건이라 **`unknown`(판정 보류)**
- **비용 검증**: 6건 검사 · 기록/재계산 일치 · 미산정 0 · 가격표 7종 동봉
- **스모크**: `SMOKE_ALLOW_MOCK=1` → **13/13 PASS**, `byFeature`에
  `vision-analysis` 포함 확인, 키 없는 Provider Health는 `…`로 건너뜀
- 브라우저 `/admin/production` 렌더링 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 운영 점검 계층 추가** (전부 core 순수 로직 + api 어댑터):

```
환경변수 ──▶ api-key.ts ──▶ validateApiKeyFormat / providerKeyRequired
                 │              ├─▶ ProviderProductionService (GET /llm/providers/validate)
                 │              └─▶ env-spec.ts requiredWhen ─▶ Fail Fast 기동 · /health/ready
                 │
Execution ──┬─▶ cost-verification.ts  ─▶ verifyCosts        ─▶ GET /llm/cost-verification
            └─▶ production-monitor.ts ─▶ monitorProduction  ─▶ GET /llm/monitoring
```

① 키 형식 규칙이 **한 곳에만** 선언되어 검증 API·환경 검증·기동 차단이 같은
판정을 쓴다(Provider Registry·env-spec와 같은 결). ② 판정이 **core 순수 로직**
이라 DB·네트워크 없이 경계 조건까지 테스트로 고정된다. ③ **모르는 것을 통과로
처리하지 않는다** — 표본 부족은 `unknown`, 권한이 없어 못 본 스모크 항목은
건너뜀 표시. ④ **과금되는 동작은 기본으로 하지 않는다**(Live Check).

**유지되는 핵심 결정**: Code-first 설정 + DB Override(1201-①) · TTL 전파
(1201-②) · `/admin/*` ADMIN 전용(1201-⑤) · Fail Fast(1202-①) · 스모크/백업
Manual(1202-③) · 단일 관문(LlmService) · mock 기본 · 미설정 시 기존 동작

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 25건
(이번 TASK 스키마 변경 없음), drift 없음

## 6. 데이터 모델

**변경 없음.** 검증·비용 대조·모니터링은 모두 **기존 Execution 이력에서 매번
계산**한다 — 판정 결과를 저장하면 실제와 어긋난 값을 보고 안심하는 사고가 난다
(1202의 준비 상태 미저장과 같은 판단).

## 7. API 표면

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | **`/llm/providers/validate`** | **API Key 검증 (ADMIN)** — 형식·조건부 필수·어댑터 생성 여부. `?live=1`이면 Provider마다 실호출 1회(**과금**) |
| `GET` | **`/llm/cost-verification`** | **비용 검증 (ADMIN)** — `?hours=`(기본 24, 1~720). 기록 vs 재계산·문제 목록·가격표 |
| `GET` | **`/llm/monitoring`** | **운영 모니터링 (ADMIN)** — `?minutes=`(기본 60, 1~10080). 성공률·p50/p95/p99·비용·경보 |

웹: **`/admin/production`** (신설 — 홈 내비 "📡 Provider 운영 점검")

기존 API 계약 변경 없음. 스모크 스크립트에 `SMOKE_LIVE_CHECK` 환경변수 추가.

## 8. 리스크·기술 부채

1. **1301 해석 미확인** — Live Check 정책·모니터링 기준값·진단 호출 분리
   (CTO_REQUEST #45)
2. **진단 호출이 운영 지표에 섞인다** — Health Check·Live Check도 Execution
   (feature `dev`)으로 기록되고 DB에 진단 표식이 없어, 모니터링이 이를
   사용자 트래픽과 함께 센다. 결정 1002-④는 **Failover 계측**에 한정된
   분리였으므로 현재는 포함을 유지했다. 표본 부족 시 판정 보류가 급한 왜곡은
   막지만, 분리 여부는 CTO 판단이 필요하다(#45-③)
3. **형식 검사는 유효성 보장이 아니다** — 폐기된 키·권한이 없는 키·할당량이
   소진된 키는 형식상 정상이다. Live Check만이 확인 수단인데 과금된다(#45-①)
4. **실키 검증은 여전히 운영/스테이징 전용** — 샌드박스는 `api.openai.com`
   egress가 차단되어(403 Host not in allowlist) 실키 경로를 여기서 확인할 수
   없다. 배선·오류 회수까지는 확인했다(0603 승인 ④ · 0901 승인 ③ 정책 유지)
5. **모니터링 기준값이 코드 고정** — 성공률 95%/50%, p95 20초, 최소 표본 5회는
   현재 환경변수가 아니다. Provider·모델에 따라 적정값이 다를 수 있다(#45-②)
6. **가격표 갱신은 수동** — Provider 단가가 바뀌면 `DEFAULT_LLM_PRICING`을
   사람이 고쳐야 하고, 그 전까지는 `mismatch`로 드러난다(탐지는 되나 자동
   반영은 아님)
7. **백업 자동화·Rate Limit 인메모리·건강 상태 인스턴스별 학습** — 기존 부채

## 9. 다음 권장 사항 (Sprint 13 후속 후보)

1. **CTO_REQUEST #45 확인** — TASK-1301 해석 확인 및 다음 지시
2. **CI/CD `/health/ready` 자동 판정** — 1202 승인 ④에서 다음 Sprint 과제로
   지시된 항목(미착수)
3. **운영/스테이징 실키 스모크** — 3사 각 1회 + `SMOKE_LIVE_CHECK=1`
   (0901 승인 ③ 정책)
4. **모니터링 기준값 환경변수화** — 성공률·지연·최소 표본을 운영에서 조정
5. **경보 전달 경로** — 현재 경보는 화면·스모크에서만 보인다. 사람이 보고 있지
   않을 때 알리려면 알림 채널(메일·웹훅)이 필요하다
