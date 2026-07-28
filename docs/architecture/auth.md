# 인증/권한 Foundation 아키텍처 (TASK-0801, Sprint 8)

User Entity · DB 세션 · RBAC · Actor Audit · Login UI로 구성된 인증 기반이다.
**적용 범위는 점진 확대 원칙** — 이번 TASK에서는 발행 파이프라인 전이(Actor
Audit 연계)와 사용자 관리에 강제 적용했고, 전면 강제 범위는 CTO 결정 대기
(CTO_REQUEST 참고).

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
  → { token, expiresAt, user }
이후 보호 요청: Authorization: Bearer <token>
  → AuthGuard: 세션 조회·만료 검사 → request.user 주입
  → @RequireRole("EDITOR") 등: 역할 계층 비교 (ADMIN > EDITOR > VIEWER)
미인증 401 · 권한 부족 403 · 로그아웃(POST /auth/logout) 시 세션 삭제
```

- 비밀번호: Node 내장 **scrypt** (salt 개별 생성, 상수 시간 비교 — 외부
  의존성 없음). 최소 8자
- 세션: **DB 저장형** — 서버에서 즉시 무효화 가능(로그아웃·만료). JWT 미사용
- **부트스트랩**: 사용자가 0명이면 관리자 1명 자동 생성 —
  `AUTH_ADMIN_EMAIL`/`AUTH_ADMIN_PASSWORD` (미설정 시 admin@acos.local /
  admin1234 — **로컬 개발 전용**, 운영은 환경변수 필수)

## RBAC

| 역할 | 권한 |
| --- | --- |
| ADMIN | 전체 — 사용자 생성(`POST /auth/users`) 포함 |
| EDITOR | 발행 파이프라인 전이(`PATCH …/contents/:id/status`) |
| VIEWER | 보호 작업 불가 (조회 전용 — 현재 조회 API는 비보호) |

역할 검사는 계층 비교(`roleAtLeast`) — 상위 역할은 하위 권한을 포함한다.

## Actor Audit (TASK-0704 감사 이력 확장)

발행 전이는 인증 필수가 되었고, 수행자 이메일이
`content_status_history.actor`에 기록된다 (CTO 결정 — Actor는 인증 도입
이후 추가). 인증 도입 전 이력의 actor는 null로 남는다.

## API

| 메서드 | 경로 | 보호 |
| --- | --- | --- |
| `POST` | `/auth/login` | 공개 |
| `POST` | `/auth/logout` | 인증 |
| `GET` | `/auth/me` | 인증 |
| `POST` | `/auth/users` | **ADMIN** |
| `PATCH` | `/projects/:id/contents/:contentId/status` | **EDITOR 이상** + actor 기록 |

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
