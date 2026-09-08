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

### 1.4 관리자 계정 확인·초기 생성·비밀번호 복구 (T1-213)

**계정이 이미 있는지 확인**: 비밀번호를 알아야 확인하는 것이 아니라
`/admin/health`(또는 `GET /health/ready`)의 "관리자 계정" 항목이
**통과**인지만 본다 — DB에 ADMIN 역할 사용자가 1명 이상 있으면
통과다. 이메일·활성 상태 등 비민감 정보만 필요하면 사람이 DB에서
`SELECT id, email, role, disabled FROM users;`로 직접 조회한다
(`passwordHash` 컬럼은 절대 출력·복사하지 않는다).

**정상 로그인 절차**: `POST /auth/login` (Web은 `/login` 화면)에
`AUTH_ADMIN_EMAIL`로 지정한 이메일과, 최초 부트스트랩 시
`AUTH_ADMIN_PASSWORD`로 지정했던 비밀번호를 입력한다. **고정
비밀번호(`admin1234` 등)는 개발 전용 기본값이며, 운영은 이 두
환경변수가 없으면 애초에 기동하지 않는다**(`apps/api/src/main.ts`의
Startup Validation, `packages/core/src/ops/env-spec.ts`의
`requiredInProduction`) — 즉 운영에 떠 있는 서버는 이미 사람이 지정한
값으로 부트스트랩된 것이지, 하드코딩된 기본값으로 뜬 것이 아니다.

**계정이 없거나(사용자 0명) 비밀번호를 잃어버린 경우** — 두 경로:

1. **최초 기동 전이라면**: 서버를 띄우기 전에 `AUTH_ADMIN_EMAIL`/
   `AUTH_ADMIN_PASSWORD`를 운영 `.env`에 지정한다. `bootstrapAdmin()`이
   기동 시 사용자가 0명일 때만 이 값으로 ADMIN 1명을 자동 생성한다
   (`apps/api/src/auth/auth.service.ts`).
2. **이미 사용자가 있는데 유일한 ADMIN의 비밀번호를 잃었다면**:
   `bootstrapAdmin()`은 이 경우 다시 실행되지 않고(사용자가 0명이
   아니므로), API의 비밀번호 재설정(`POST
   /auth/users/:id/password-reset`)은 **이미 로그인된 ADMIN**이 있어야
   써서 이 상황에는 쓸 수 없다. 이때는 `scripts/admin-provision.mjs`
   (신규, T1-213)를 **DB와 같은 호스트에서** 실행한다:

   ```bash
   ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="<강한 새 비밀번호>" \
     node scripts/admin-provision.mjs
   ```

   - 해당 이메일 사용자가 없으면 새 ADMIN 계정을 만들고, 있으면
     비밀번호를 재설정하고 역할을 ADMIN으로 확정한다 — 기존
     `resetPassword`(TASK-0803)와 같은 정책(잠금 해제·기존 세션 전부
     폐기)을 그대로 따르고, 같은 감사 로그(`UserAuditLog`)에 남긴다.
   - 비밀번호는 `ADMIN_PASSWORD` 환경변수로만 받는다 — 소스·로그·
     결과 어디에도 평문 비밀번호를 남기지 않는다. 실행 결과에는
     이메일과 생성/재설정 여부만 출력된다.
   - **원격(EC2) DB에 대해서는 이 스크립트를 이 저장소(로컬 PC)에서
     원격으로 실행하지 않는다** — `AGENTS.md`의 "원격 EC2·원격 데이터
     직접 수정 금지" 원칙과 같은 이유다. 필요하면 사람이 SSH로 그
     서버에 직접 접속해, 그 서버의 `.env`(`DATABASE_URL`)가 적용된
     상태에서 실행한다.

### 1.5 일반 회원가입·로그인 ID/비밀번호 셀프 재설정 (T1-215)

**회원가입**: `POST /auth/signup`(Web `/signup`)은 인증 없이 호출 가능한
공개 API다. 생성되는 계정은 **항상 VIEWER 역할**이며, 이 경로로 ADMIN·
EDITOR 권한이 부여되는 일은 없다(권한 상향은 여전히 `/admin/users`에서
ADMIN이 직접 해야 한다). 이메일 키 슬라이딩 윈도우로 가입 시도를
제한한다(`AUTH_SIGNUP_MAX_ATTEMPTS`(기본 5)/`AUTH_SIGNUP_WINDOW_SEC`(기본
300초), `apps/api/src/auth/session-config.ts`). IP 키를 쓰지 않은 이유:
현재 nginx 리버스 프록시 뒤에서 Express가 `X-Forwarded-For`를 신뢰하도록
설정돼 있지 않아(`apps/api/src/main.ts`, 이번 작업이 건드리지 않음) IP
키를 쓰면 모든 사용자가 같은 프록시 IP로 묶여 서로를 막을 위험이 있다.

**로그인 ID(이메일) 셀프 변경**: `PATCH /auth/email`(Web `/account`) —
로그인된 사용자 본인이 현재 비밀번호를 확인한 뒤 이메일을 바꾼다. 다른
계정이 이미 쓰는 이메일은 거부(409)하고, 성공 시 비밀번호 변경과 동일하게
현재 세션만 남기고 다른 기기의 세션은 전부 폐기한다.

**비밀번호 셀프 변경**: 기존 `PATCH /auth/password`(Web `/account`, TASK-0803)
그대로 — 변경 없음.

**이메일 기반("비밀번호를 잊으셨나요?" 메일 링크) 비밀번호 재설정을
구현하지 않은 이유**: 이 프로젝트에는 사용자에게 트랜잭션 메일(재설정
링크 등)을 보낼 인프라가 없다. `SMTP_HOST`/`ALERT_EMAIL_TO`
(`packages/core/src/ops/env-spec.ts`)는 **운영자 경보 전용**(Enterprise
Governance/Alerting)이며 사용자 대상 템플릿 메일 발송 기능이 아니다. 이
상태에서 "이메일로 재설정 링크 발송"을 구현하면 실제로는 아무 메일도
가지 않거나, 검증되지 않은 외부 메일 서비스를 추측해 끼워 넣어야 한다 —
둘 다 이 프로젝트의 "추측하지 않는다" 원칙(`docs/MASTER_GUIDE.md` 철학
2)에 어긋난다. 그래서 T1-215는 이메일 발송 없이도 안전한 두 경로만
구현했다:

1. **로그인은 되지만 비밀번호/이메일을 바꾸고 싶은 사용자**: 위
   셀프서비스 두 API(현재 비밀번호로 본인 확인)로 충분하다.
2. **로그인 자체가 안 되는(비밀번호를 완전히 잊은) 일반 회원**: 이메일
   인증 없이 "본인 확인"을 대체할 안전한 방법이 없으므로, **관리자에게
   요청**하는 것이 유일한 안전한 경로다. ADMIN은 `/admin/users`
   화면(또는 `POST /auth/users/:id/password-reset`)에서 해당 사용자의
   비밀번호를 즉시 재설정할 수 있다 — 이미 구현·테스트돼 있는 기존
   기능이며 이번 작업이 새로 만들지 않았다. `/signup` 화면과 로그인
   실패 시 안내에 이 경로(관리자 문의)를 명시한다.
3. **유일한 ADMIN이 잠겨 로그인 자체가 안 되는 경우**: 위 §1.4의
   `scripts/admin-provision.mjs`(T1-213)가 유일한 공식 복구 경로다 — 이
   스크립트는 웹 화면이 아니라 DB가 있는 호스트에서 사람이 직접
   실행해야 한다(§1.4 참고, 이번 작업도 변경하지 않았다).

이메일 발송 인프라(트랜잭션 메일 서비스)가 실제로 생기면, 그때 "이메일
재설정 링크" 흐름을 추가하는 것이 다음 단계다 — 이번 작업 범위 밖이며
임의로 구현하지 않았다.

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
