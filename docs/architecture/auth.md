# 인증/권한 아키텍처 (TASK-0801 Foundation · 0802 전면 쓰기 보호 · 0803 비밀번호/운영 보안, Sprint 8)

User Entity · DB 세션 · RBAC · Actor Audit · Login UI · 사용자 관리 UI ·
비밀번호 관리 · 쿠키 세션으로 구성된 인증 체계다.

**적용 범위 (TASK-0802 — CTO 지시 "모든 Write API 인증")**:
- **모든 쓰기(POST/PATCH/PUT/DELETE)**: 전역 `WriteProtectionGuard`(APP_GUARD)
  가 인증 강제 — 기본 **EDITOR 이상**, `@RequireRole`로 개별 지정
  (사용자 관리 ADMIN · 로그아웃 VIEWER)
- **예외(@Public)**: 로그인 · Company Brain 조회(POST지만 읽기) ·
  READY 검증(판정만, 저장 없음)
- **조회 GET**: 비보호 유지 (CTO 결정, 0801 승인 ①)

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (순수 로직) | scrypt 비밀번호 해시(`hashPassword`/`verifyPassword`) · 세션 토큰(256비트) · RBAC 계층(`roleAtLeast`) | `packages/core/src/auth/auth.ts` |
| DB | `User`(email 유니크·역할) · `AuthSession`(토큰·만료) · `ContentStatusHistory.actor` | `apps/api/prisma/schema.prisma` |
| API | `AuthService`(부트스트랩·로그인·검증·사용자 생성) · `AuthGuard` + `@RequireRole` · `AuthController` | `apps/api/src/auth/` |
| Web | `/login` 페이지 · localStorage 토큰 · 보호 호출에 Bearer 첨부 | `apps/web/app/login/` · `lib/auth-client.ts` |

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
  USER_DISABLED / USER_ENABLED / PASSWORD_CHANGED / PASSWORD_RESET
  1건당 1레코드(actor·대상·상세), `GET /auth/audit`(최신순 100건)
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
| `POST` | `/auth/logout` | 인증 (모든 역할) — 쿠키 만료 |
| `GET` | `/auth/me` | 인증 |
| `PATCH` | `/auth/password` | 인증 (모든 역할 — 본인 비밀번호 변경) |
| `GET/POST` | `/auth/users` · `PATCH /auth/users/:id` · `POST /auth/users/:id/password-reset` · `GET /auth/audit` | **ADMIN** |
| `GET` | `/llm/health` | 운영/스테이징 **EDITOR 이상** · 개발 비보호 |
| 그 외 **모든 쓰기** | POST/PATCH/PUT/DELETE 전체 | **EDITOR 이상** (전역 가드) |
| 예외 | `POST /company-brain/query` · `POST …/ready-validation` | 공개(@Public — 읽기 성격, CTO 확정 0802-①) |

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
