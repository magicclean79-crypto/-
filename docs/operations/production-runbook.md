# Production Runbook (TASK-1202, Sprint 12)

운영 배포·점검·일상 운영 절차입니다. 장애 대응은
[recovery-guide.md](recovery-guide.md)를 참고하세요.

> 이 문서의 체크 항목은 대부분 **화면에서 자동 판정**됩니다 —
> `/admin/health`(배포 준비 상태, ADMIN)를 먼저 열어 보세요.
> 자동으로 확인할 수 없는 항목만 "직접 확인"으로 남습니다.

---

## 1. 배포 전 준비

### 1.1 환경변수

환경변수 선언은 `packages/core/src/ops/env-spec.ts`가 **단일 원천**입니다.
설정 목록·설명·운영 필수 여부는 `/admin/health`의 "설정 현황"에서 확인합니다.

운영 필수(누락 시 **기동 실패**):

| 분류 | 변수 |
| --- | --- |
| 기본 | `WEB_URL` |
| DB | `DATABASE_URL` |
| 저장소 | `S3_ENDPOINT` · `S3_BUCKET` · `S3_ACCESS_KEY` · `S3_SECRET_KEY` |
| 인증 | `AUTH_ADMIN_EMAIL` · `AUTH_ADMIN_PASSWORD` |

운영 권고(누락 시 **경고**, 기동은 됨):

- `LLM_PROVIDER` — mock이면 실제 호출이 일어나지 않습니다
- `LLM_DAILY_BUDGET_USD` — 없으면 비용 상한이 없습니다
- `LLM_FAILOVER_PRIORITY` — 없으면 단일 Provider 장애가 곧 서비스 중단입니다
- `AUTH_COOKIE_SECURE` — 꺼져 있으면 세션 쿠키가 평문 전송될 수 있습니다

### 1.2 마이그레이션

```bash
pnpm --filter api exec prisma migrate deploy
```

`/admin/health`의 "마이그레이션 적용"이 **통과**인지 확인합니다.
`확인 불가`로 나오면 DB 접근 권한을 점검하세요 — 모르는 것을 통과로
처리하지 않으므로, 이 상태에서는 직접 확인해야 합니다.

### 1.3 배포 전 체크리스트

`/admin/health`에서 **배포 차단** 항목이 하나도 없어야 합니다:

| 항목 | 판정 |
| --- | --- |
| 환경변수 검증 | 자동 |
| 데이터베이스 연결 | 자동 |
| 마이그레이션 적용 | 자동 (확인 불가 시 수동) |
| 이미지 저장소 접근 | 자동 |
| 관리자 계정 | 자동 |
| 실제 Provider 연결 | 자동 (운영에서 mock만이면 차단) |
| 비용 예산 · Failover | 자동 (경고) |
| **실 Provider 스모크** | **직접 확인** |
| **DB 백업·복구 확인** | **직접 확인** |

---

## 2. 배포

```bash
# 1) 빌드·검증 (전체 게이트)
pnpm build && pnpm test && pnpm lint

# 2) 마이그레이션
pnpm --filter api exec prisma migrate deploy

# 3) 기동 — 환경 검증이 먼저 돌고, 운영에서 오류가 있으면 기동하지 않는다
pnpm --filter api start
```

기동 로그에서 다음을 확인합니다:

```
[ReadinessService] 환경 검증 통과 (22개 항목, production)
[Bootstrap] API server is running on http://localhost:4000
```

`환경 오류 [...]`가 찍히고 기동이 중단되면, 로그의 변수명을 그대로 고친 뒤
다시 시작합니다. **경고만 있으면 기동은 됩니다** — 다만 배포 전에 해소하는
것이 원칙입니다.

---

## 3. 배포 직후 확인

1. **생존 확인** — `GET /health` → `OK`, `GET /health/live` → `{status:"ok"}`
2. **배포 준비 상태** — `/admin/health`에서 **배포 가능**
3. **실 Provider 스모크** (0901 승인 ③ — 필수)

```bash
node scripts/real-provider-smoke.mjs
```

- 운영/스테이징 배포 직후 **1회 필수**
- **모델 변경 시** 재실행
- **인증/쿠키 설정 변경 시** 재실행

절차: [real-provider-smoke.md](real-provider-smoke.md)

---

## 4. 일상 운영

| 상황 | 조치 |
| --- | --- |
| 비용이 예산에 근접(80% 경고) | `/providers`에서 지출 확인 → 필요 시 `/admin/console`에서 예산 조정 |
| 특정 Provider 장애 | `/routing`에서 건강 상태 확인 → `/admin/console`에서 해당 Provider 비활성 |
| 모델 교체 | `/admin/console` 모델 관리에서 변경 → **스모크 재실행** |
| 실험 운영 | `/experiments`에서 시작·중단, 승자 확정은 ADMIN |
| 설정 변경 이력 | `/admin/console` 변경 이력 (누가·무엇을·이전→이후) |

**설정 우선순위**(CTO 결정 1201-①): `DB 오버라이드 → 환경변수 → 기본값`.
콘솔에서 바꾼 값은 배포해도 **자동으로 지워지지 않습니다**(결정 1201-④) —
환경변수를 바꿨는데 반영되지 않으면 `/admin/console`에서 해당 항목의 출처가
`콘솔`인지 확인하고 **직접 해제**하세요.

---

## 5. 모니터링 지점

| 대상 | 위치 |
| --- | --- |
| 호출·성공률·지연·비용 | `/executions` (실행 대시보드) |
| Provider별 비교 | `/providers` |
| 라우팅·Failover 건강 상태 | `/routing` |
| 실험 성과·승자 추천 | `/experiments` |
| 배포 준비·구성 요소 | `/admin/health` |

---

## 6. 권한 요약

| 대상 | 필요 권한 |
| --- | --- |
| `GET /health` · `/health/live` | 없음 (프로브용, 내부 정보 비노출) |
| `GET /health/ready` | **ADMIN** |
| `/admin/*` (콘솔·감사) — 조회·변경 모두 | **ADMIN** (결정 1201-⑤) |
| 실험 시작·중단 | EDITOR 이상 |
| 실험 승격·되돌리기 | **ADMIN** (결정 1101-④) |
| 그 외 쓰기 API | EDITOR 이상 |
