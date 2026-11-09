# 인증/권한 아키텍처 (TASK-0801 Foundation · 0802 전면 쓰기 보호 · 0803 비밀번호/운영 보안 · 0804 로그인 보호, Sprint 8)

User Entity · DB 세션 · RBAC · Actor Audit · Login UI · 사용자 관리 UI ·
비밀번호 관리 · 쿠키 세션 · 로그인 보호(Rate Limit/잠금)로 구성된 인증
체계다.

**적용 범위 (TASK-0802 — CTO 지시 "모든 Write API 인증")**:
- **모든 쓰기(POST/PATCH/PUT/DELETE)**: 전역 `WriteProtectionGuard`(APP_GUARD)
  가 인증 강제 — 기본 **EDITOR 이상**, `@RequireRole`로 개별 지정
  (사용자 관리 ADMIN · 로그아웃 VIEWER)
- **예외(@Public)**: 로그인 · Company Brain 조회(POST지만 읽기) ·
  READY 검증(판정만, 저장 없음) · **`/image-gen/*`(Image Studio 전용,
  T1-90 — 아래 참고)**
- **조회 GET**: 비보호 유지 (CTO 결정, 0801 승인 ①)

## Image Studio 무로그인 예외 (T1-90)

`/image-studio` 화면은 로그인 없이 바로 쓸 수 있어야 한다는 정책에 따라,
`ImageGenController`(`/image-gen/*`)의 **모든 쓰기 엔드포인트**를
`@Public()`으로 표시했다 — `remove-background`·`generate-background`·
`composite`·`hero`·`usage-shots`·`candidates`(POST)·`select`.

- **왜 이 컨트롤러 전체인가**: 이 컨트롤러는 `/image-studio` 화면
  전용이다(다른 화면이 호출하지 않음, T1-90 조사로 확인 —
  `apps/web` 전체에서 `image-gen` 문자열은 `image-studio` 아래
  두 파일에서만 나온다) — 그래서 컨트롤러 단위로 예외를 둬도 다른
  화면·다른 데이터에 영향이 없다.
- **다른 쓰기는 그대로 보호된다**: Product Profile 생성(`POST
  /product-profile`)·사용자 관리(`POST /auth/users`) 등은 여전히
  401(로그인 필요)을 반환한다 — 이번 예외는 이 컨트롤러 한 곳으로
  좁혔다(실측: `docs/PROJECT_STATE.md` T1-90 절 참고).
- **GET 경로는 원래부터 비보호**: `GET /image-gen/candidates`·
  `GET /uploads/images/:id/file`은 이번 변경 이전부터 조회 API
  비보호 원칙(위 "조회 GET")으로 이미 인증이 필요 없었다 — 이번에
  새로 바뀐 것은 이 컨트롤러의 **쓰기** 엔드포인트뿐이다.
- **비용 유의**: `/image-gen/hero`·`/usage-shots`·`candidates`(POST)는
  Gemini 실 호출(과금)로 이어진다. 이 컨트롤러가 공개되면 로컬
  네트워크 접근 권한이 있는 누구나 과금 호출을 트리거할 수 있다 —
  이 프로젝트는 로컬 개발 환경(`localhost:3100`→`localhost:4100`)
  기준으로 운영되고, 인터넷에 공개 배포하는 시나리오는 이번 범위
  밖이다. 인터넷에 노출하는 시점에는 별도 판단이 필요하다.

## Image Studio 무로그인 예외 확장 — Product Profile (T1-110)

T1-90 이후 Image Studio 화면(`/image-studio`)에 사용자 요구사항 저장
(T1-92·T1-99)·Product Story 생성(T1-94) 패널이 추가되면서, 이 화면이
`ProductProfileController`의 쓰기 엔드포인트 3개도 직접 호출하게
됐다 — `POST /product-profile`(사진 분석 실행)·`PATCH
/product-profile/:id/user-requirement`(요구사항 저장)·`POST
/product-profile/:id/story`(Product Story 생성). 이 3개는 T1-90 당시
`@Public()` 목록에 없었기 때문에, 로그인하지 않은 상태로 Image Studio를
테스트하면 이 3개 호출에서만 401("로그인이 필요합니다")이 났다 —
`/image-gen/*`는 이미 되는데 같은 화면의 다른 버튼은 막히는 상태였다.

**해결**: `@Public()`을 그대로 붙이지 않고, 새 데코레이터
`@PublicInDev()`(`write-protection.guard.ts`)를 만들어 이 3개
엔드포인트에만 적용했다.

- **`@Public()`과의 차이**: `@Public()`은 운영에서도 항상 인증을
  건너뛴다(`/image-gen/*`가 이미 이렇게 되어 있음, T1-90). `@PublicInDev()`는
  `isOperationalEnv()`(`session-config.ts` — `NODE_ENV`가
  `production`/`staging`이면 참, `/llm/health`·쿠키 Secure와 같은 판정
  함수를 재사용)가 **거짓일 때만** 통과시키고, 운영/스테이징에서는 기존과
  동일하게 401을 낸다.
- **왜 `@Public()`을 그대로 쓰지 않았는가**: 이 컨트롤러의 `run`·`story`는
  실 OpenAI 호출(과금)로 이어진다. `/image-gen/*`는 "로컬 개발 환경
  기준으로 운영되고, 인터넷에 공개 배포하는 시나리오는 범위 밖"이라는
  전제로 이미 승인된 결정(T1-90)이었지만, 이번 지시(T1-110)는 "운영/외부
  공개 환경의 인증 보안을 약화시키지 말라"를 명시했다 — 그래서 새로
  추가하는 이 3개는 운영에서 보호가 유지되는 쪽(`@PublicInDev()`)을
  선택했다. `/image-gen/*`의 기존 `@Public()`은 이미 승인된 결정이라
  이번 범위에서 되돌리지 않았다.
- **영향받지 않는 것**: `GET /product-profile`류(목록·`/final`·`/html`
  조회)는 원래부터 조회 GET 비보호 원칙으로 인증이 필요 없었다 — 이번에
  바뀐 것은 위 3개 쓰기 엔드포인트뿐이다. `/product-profile` 화면
  (`product-profile-flow.tsx`, Benchmark 검증용)도 같은 컨트롤러를 쓰므로
  개발 환경에서는 함께 로그인 없이 동작한다 — 운영에서는 그대로 보호된다.

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (순수 로직) | scrypt 비밀번호 해시(`hashPassword`/`verifyPassword`) · 세션 토큰(256비트) · RBAC 계층(`roleAtLeast`) | `packages/core/src/auth/auth.ts` |
| DB | `User`(email 유니크·역할) · `AuthSession`(토큰·만료) · `ContentStatusHistory.actor` | `apps/api/prisma/schema.prisma` |
| API | `AuthService`(부트스트랩·로그인·검증·사용자 생성) · `AuthGuard` + `@RequireRole` · `AuthController` | `apps/api/src/auth/` |
| Web | `/login`·`/signup` 페이지 · `AuthGate`(루트 선택 화면) · localStorage 토큰 · 보호 호출에 Bearer 첨부 | `apps/web/app/login/`·`apps/web/app/signup/`·`apps/web/app/auth-gate.tsx` · `lib/auth-client.ts` |

## 인증 흐름

```
POST /auth/login { email, password }
  → scrypt 검증 → AuthSession 생성(토큰 256비트, 기본 7일)
  → { token, expiresAt, user } + Set-Cookie: acos_session (httpOnly)
이후 보호 요청: Authorization: Bearer <token> 우선, 없으면 acos_session 쿠키
  → AuthGuard/WriteProtectionGuard: 세션 조회·만료 검사 → request.user 주입
  → @RequireRole("EDITOR") 등: 역할 계층 비교 (ADMIN > EDITOR > VIEWER)
미인증 401 · 권한 부족 403 · 로그아웃(POST /auth/logout) 시 세션 삭제+쿠키 만료
```

- 비밀번호: Node 내장 **scrypt** (salt 개별 생성, 상수 시간 비교 — 외부
  의존성 없음). 최소 8자
- 세션: **DB 저장형** — 서버에서 즉시 무효화 가능(로그아웃·만료). JWT 미사용
- **부트스트랩**: 사용자가 0명이면 관리자 1명 자동 생성 —
  `AUTH_ADMIN_EMAIL`/`AUTH_ADMIN_PASSWORD` (미설정 시 admin@acos.local /
  admin1234 — **로컬 개발 전용**, 운영은 환경변수 필수)

## 세션 쿠키 (TASK-0803 — 운영 보안, CTO 결정 0801 승인 ③)

로그인 시 응답 본문 토큰(개발 localStorage용)과 함께 **httpOnly 쿠키
`acos_session`** 을 발급한다. 서버는 **Bearer 헤더 → 쿠키** 순으로 토큰을
인식하므로, 운영에서는 localStorage 없이 쿠키만으로 인증할 수 있다
(XSS 토큰 탈취 방지 — JS에서 쿠키 접근 불가).

| 환경변수 | 기본 | 의미 |
| --- | --- | --- |
| `AUTH_COOKIE_SECURE` | (off) | `1`이면 Secure — HTTPS 전용 전송 (**운영 필수**) |
| `AUTH_COOKIE_SAMESITE` | `lax` | `lax`/`strict`/`none` — `none`은 브라우저 규칙상 Secure 강제(core에서 처리) |
| `AUTH_PROTECT_HEALTH` | NODE_ENV 따름 | `/llm/health` 보호 명시 지정 (아래) |

- 쿠키 수명 = 세션 TTL(7일). 로그아웃 시 `Max-Age=0`으로 즉시 만료
- CORS는 `credentials: true` — 교차 출처에서도 쿠키 전송 허용 (origin은
  `WEB_URL` 단일 지정 유지)
- 순수 쿠키 로직(`buildSessionCookie`/`parseCookieHeader`)은 core, 환경변수
  해석은 `apps/api/src/auth/session-config.ts`

## 회원가입 · 로그인 ID 셀프 변경 (T1-215)

- **회원가입(공개)**: `POST /auth/signup` { email, name, password } —
  항상 **VIEWER** 역할로 생성한다. 관리자 권한은 이 경로로 절대 부여되지
  않는다(ADMIN/EDITOR는 여전히 `POST /auth/users`, ADMIN 전용). 성공 시
  로그인과 동일하게 세션을 발급하고 즉시 로그인 상태가 된다. 이메일 키
  슬라이딩 윈도우로 가입 시도를 제한(`AUTH_SIGNUP_MAX_ATTEMPTS`(5)/
  `AUTH_SIGNUP_WINDOW_SEC`(300초), `session-config.ts`), 이메일 중복은
  409, 비밀번호 정책 위반·형식 오류는 400. 감사 `USER_SIGNED_UP`
- **로그인 ID(이메일) 변경(셀프 서비스, 모든 역할)**: `PATCH /auth/email`
  { currentPassword, newEmail } — 현재 비밀번호 확인 필요(계정 탈취
  방지), 대상 이메일이 이미 다른 계정에 있으면 409. 성공 시 **현재
  세션만 남기고 다른 세션 전부 폐기** + 감사 `EMAIL_CHANGED`
- **Web UI**: `/signup`(가입 폼) · `/account`(이메일 변경 폼, 비밀번호
  변경 폼과 나란히) · 루트 `/`의 `AuthGate`가 비로그인 시 로그인/회원가입
  두 선택지를 보여준다(기존 T1-212의 자동 `/login` 리다이렉트를 대체)
- **이메일 발송 기반 비밀번호 재설정은 구현하지 않았다** — 이 프로젝트에
  사용자 대상 트랜잭션 메일 인프라가 없다(`SMTP_HOST`는 운영자 경보
  전용). 로그인 자체가 안 되는 사용자는 관리자에게 요청해
  `/admin/users`에서 재설정받는다(기존 TASK-0803 기능, ADMIN 전용).
  상세 이유·대체 경로는 `docs/operations/production-runbook.md` §1.5

## 비밀번호 관리 (TASK-0803)

- **변경(셀프 서비스, 모든 역할)**: `PATCH /auth/password`
  { currentPassword, newPassword } — 현재 비밀번호 확인, 최소 8자,
  동일 비밀번호 거부. 성공 시 **현재 세션만 남기고 다른 세션 전부 폐기**
  (탈취 기기 차단) + 감사 `PASSWORD_CHANGED`
- **재설정(ADMIN 전용)**: `POST /auth/users/:id/password-reset`
  { newPassword } — 대상의 **모든 세션 폐기** + 감사 `PASSWORD_RESET`.
  자기 자신은 불가(400 — 변경 기능 사용)
- **Web UI**: `/account`(비밀번호 변경 폼·성공/오류 안내),
  `/admin/users` 행별 "비밀번호 재설정" 인라인 입력. Playwright 3종 포함

## 로그인 보호 (TASK-0804)

로그인은 다음 순서로 보호된다:
**Rate Limit(429) → 잠금 검사 → 비밀번호 검증(실패 카운트) → 비활성 검사**

| 항목 | 동작 | 환경변수 (기본) |
| --- | --- | --- |
| **Rate Limit** | 이메일 키 슬라이딩 윈도우 — 초과 시 429. 인메모리 1차 방어(재시작 시 초기화, core `SlidingWindowRateLimiter`) | `AUTH_LOGIN_MAX_ATTEMPTS`(30) / `AUTH_LOGIN_WINDOW_SEC`(60) |
| **Account Lockout** | 연속 실패 임계 도달 시 DB 잠금(`users.lockedUntil`) — 잠금 중엔 올바른 비밀번호도 거부. 시간 경과로 자동 해제, **ADMIN 비밀번호 재설정 시 즉시 해제**. 성공 로그인은 카운터 초기화 | `AUTH_LOCKOUT_THRESHOLD`(5회) / `AUTH_LOCKOUT_MINUTES`(15분) |
| **Password Complexity** | 최소 8자 + 영문 1자 + 숫자 1자 (core `validatePasswordComplexity`, Code-first) — 생성·변경·재설정 공통 | (코드 정의) |
| **Failed Login Audit** | LOGIN_FAILED(사유·n/임계) · ACCOUNT_LOCKED — 실존 계정만 기록(스팸 방지), 감사 로그·/admin/users 잠김 배지 표시 | — |
| **Cookie 전용 모드** | 로그인 응답에서 본문 토큰 제외 — httpOnly 쿠키만 사용 (CTO 결정 0803-①: 운영은 쿠키 전용). 미지정 시 운영/스테이징 자동 켜짐 | `AUTH_COOKIE_ONLY`(NODE_ENV 따름) |
| **Session Timeout** | 세션·쿠키 수명 지정 (기본 7일) | `AUTH_SESSION_TTL_HOURS`(168) |

웹은 모든 인증 호출에 `credentials: "include"`를 사용해 Bearer(개발
localStorage)와 쿠키(운영) 두 모드를 모두 지원한다.

## /llm/health 보호 (TASK-0803 — CTO 결정 0802-③)

GET이지만 **실 Provider 호출·Execution 기록이 발생**하므로:
- **운영/스테이징**(NODE_ENV `production`/`staging` 또는
  `AUTH_PROTECT_HEALTH=1`): **EDITOR 이상 인증 필수** (401/403)
- **개발**(기본): 비보호 유지 — `AUTH_PROTECT_HEALTH=0`으로 명시 해제도 가능

## RBAC (TASK-0802 확장)

| 역할 | 권한 |
| --- | --- |
| ADMIN | 전체 — **사용자 관리**(목록/생성/역할 변경/비활성화)·감사 로그 포함 |
| EDITOR | **모든 쓰기 API** (업로드·상품·파이프라인·생성·발행 전이·개발용 LLM 호출 등) |
| VIEWER | 조회 전용 (+ 로그아웃) — 쓰기 403 |

역할 검사는 계층 비교(`roleAtLeast`) — 상위 역할은 하위 권한을 포함한다.

## 사용자 관리 (TASK-0802, ADMIN 전용)

- `GET /auth/users` — 목록 · `POST /auth/users` — 생성 ·
  `PATCH /auth/users/:id` — **역할 변경/비활성화** (자기 자신 변경 불가 400)
- **비활성화(disable)**: 로그인 401("비활성화된 계정") + 기존 세션 전부
  즉시 폐기 + 토큰 검증 거부. 활성화로 복구 가능
- **감사 확장**: `user_audit_log` — USER_CREATED / ROLE_CHANGED /
  USER_DISABLED / USER_ENABLED / PASSWORD_CHANGED / PASSWORD_RESET /
  LOGIN_FAILED / ACCOUNT_LOCKED 1건당 1레코드(actor·대상·상세),
  `GET /auth/audit`(최신순 100건)
- **Web UI**: `/admin/users` — 목록·생성 폼·역할 select·비활성화 토글·감사
  로그. 미로그인/권한 부족 시 안내. Playwright 3종 포함

## Actor Audit (TASK-0704 감사 이력 확장)

발행 전이는 인증 필수가 되었고, 수행자 이메일이
`content_status_history.actor`에 기록된다 (CTO 결정 — Actor는 인증 도입
이후 추가). 인증 도입 전 이력의 actor는 null로 남는다.

## API

| 메서드 | 경로 | 보호 |
| --- | --- | --- |
| `POST` | `/auth/login` | 공개(@Public) — httpOnly 쿠키 발급 |
| `POST` | `/auth/signup` | 공개(@Public) — 항상 VIEWER로 생성, 로그인과 동일하게 쿠키 발급 (T1-215) |
| `POST` | `/auth/logout` | 인증 (모든 역할) — 쿠키 만료 |
| `GET` | `/auth/me` | 인증 |
| `PATCH` | `/auth/password` | 인증 (모든 역할 — 본인 비밀번호 변경) |
| `PATCH` | `/auth/email` | 인증 (모든 역할 — 본인 로그인 ID 변경, 현재 비밀번호 확인 필요, T1-215) |
| `GET/POST` | `/auth/users` · `PATCH /auth/users/:id` · `POST /auth/users/:id/password-reset` · `GET /auth/audit` | **ADMIN** |
| `GET` | `/llm/health` | 운영/스테이징 **EDITOR 이상** · 개발 비보호 |
| 그 외 **모든 쓰기** | POST/PATCH/PUT/DELETE 전체 | **EDITOR 이상** (전역 가드) |
| 예외 | `POST /company-brain/query` · `POST …/ready-validation` | 공개(@Public — 읽기 성격, CTO 확정 0802-①) |
| 예외 | `POST /image-gen/*`(remove-background·generate-background·composite·hero·usage-shots·candidates·select) | 공개(@Public — Image Studio 무로그인 정책, T1-90) |
| 예외 | `POST /product-profile`·`PATCH /product-profile/:id/user-requirement`·`POST /product-profile/:id/story` | 개발 환경에서만 공개(@PublicInDev — Image Studio 무로그인 정책 확장, T1-110). 운영/스테이징은 그대로 EDITOR 이상 인증 필요 |

## Web

- `/login` — 로그인 폼(오류 표시), 로그인 상태 표시·로그아웃. 토큰은
  localStorage(`acos_token`) 보관, 보호 호출에 Bearer 첨부
- 발행 전이 실패(401/403) 시 오류 메시지 + 로그인 링크 표시
- Playwright e2e 3종(auth.spec.ts): 로그인 성공/실패, 미로그인 전이 안내 —
  발행 e2e도 토큰 주입으로 갱신 (총 9종, 공식 게이트)

## 테스트

- Unit: `packages/core/src/auth/auth.spec.ts` — 해시 왕복·거부, 토큰, 역할 계층
- API: `apps/api/src/auth/auth.controller.spec.ts` — 부트스트랩·로그인·me·
  로그아웃·사용자 생성 RBAC(403/409/400)
- API: `apps/api/src/contents/contents.controller.spec.ts` — 전이 401/403 +
  actor 기록
- Web e2e: `apps/web/e2e/auth.spec.ts` + publishing.spec 갱신
