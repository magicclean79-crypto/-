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
| 보고 기준 TASK | **TASK-0801 — Authentication & Authorization Foundation** (Sprint 8 첫 TASK) |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `400b4ae` |
| 핵심 성과 | 지시 5요소(User Entity·Session·RBAC·Actor Audit·Login UI) 전부 구현 — **감사 이력에 수행자 기록 시작** |
| 구현 중단 상태 | **TASK-0801 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | **인증 전면 강제 범위**·역할 정책 등 → **CTO_REQUEST #31 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **310** — core 130(+4) · api 171(+5) · **web e2e 9(+3)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### Sprint 7 종료 반영

- CTO 결정: TASK-0704 승인 (Audit from/to/timestamp 공식 표준 — **Actor는
  인증 도입 이후 추가** → 본 TASK에서 이행, Publishing UI 위치 확정),
  **Sprint 7 공식 종료** — TASKS.md 기록

### TASK-0801 — Authentication & Authorization Foundation (`400b4ae`)

1. **User Entity**: `users` 테이블 — email 유니크·이름·scrypt 해시·역할
   (ADMIN/EDITOR/VIEWER). **관리자 부트스트랩**: 최초 기동 시 사용자 0명이면
   관리자 1명 자동 생성(`AUTH_ADMIN_EMAIL/PASSWORD`, 기본값은 로컬 전용).
   사용자 생성 API `POST /auth/users`(ADMIN 전용, 중복 409·짧은 비밀번호 400)
2. **Session**: `auth_sessions` — **DB 저장형** 256비트 토큰(기본 7일),
   `Authorization: Bearer`. 로그인/로그아웃/me, 로그아웃·만료 시 즉시 무효화
   (JWT 미사용 — 서버 폐기 가능성 우선). 비밀번호는 Node 내장 **scrypt**
   (salt 개별·상수 시간 비교 — 외부 의존성 없음, core 순수 로직)
3. **RBAC**: `AuthGuard` + `@RequireRole` — **역할 계층 비교**(ADMIN >
   EDITOR > VIEWER, core `roleAtLeast`). 미인증 401 · 권한 부족 403.
   적용: 발행 전이 **EDITOR 이상**, 사용자 생성 **ADMIN**
4. **Actor Audit**: `content_status_history.actor` 컬럼 추가 — 발행 전이가
   인증 필수가 되면서 **수행자 이메일이 감사 이력에 기록**됨 (기존 이력은
   null 유지 — 데이터 보존)
5. **Login UI**: `/login` — 로그인 폼(오류 표시)·로그인 상태·로그아웃.
   토큰은 localStorage, 발행 전이 호출에 Bearer 첨부, 401 시 로그인 링크
   안내. 홈 내비게이션 추가
6. **Playwright** (공식 게이트 준수): auth e2e 3종(로그인 성공/실패·미로그인
   전이 안내) + 발행 e2e 토큰 주입 갱신 — 웹 게이트 총 9종

- **적용 범위(해석)**: Foundation 단계로 **발행 전이·사용자 관리에만 강제**
  — 기존 파이프라인(업로드~생성)과 조회 API는 무변경(테스트·SOP·스모크
  호환). 전면 강제 로드맵은 #31로 질의
- 마이그레이션 1건(신규 2테이블+actor 컬럼, 기존 데이터 무영향), drift 없음

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 8 | **TASK-0801 — Auth Foundation** | **완료 (`400b4ae`) — 승인 대기** |
| Sprint 1~7 | Foundation ~ Publishing/관측/웹 게이트 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 126 · **인증 4** (해시 왕복/거부·토큰·역할 계층) | 130 | ✅ |
| `apps/api` | Service+API — 기존 166 · **Auth 5** (로그인·me·로그아웃·RBAC·사용자 생성) + 전이 401/403/actor 검증 강화 | 171 | ✅ |
| `apps/web` | Playwright e2e — 기존 6 · **인증 3** | 9 | ✅ |
| **합계** | | **310** | **전체 통과** |

라이브 검증 (실 PostgreSQL + 실스택 브라우저):
- 부트스트랩 관리자 로그인 → 토큰 발급·`/auth/me` 확인
- 무토큰 전이 401 → 관리자 토큰 전이 200 → **감사 이력에
  `actor: admin@acos.local` 기록 확인**
- ADMIN이 VIEWER 생성 → VIEWER 전이 시도 **403** ("EDITOR 이상 필요") ·
  VIEWER의 사용자 생성 **403** · 로그아웃 후 me **401** (세션 즉시 무효화)
- 브라우저: `/login` 로그인 → 홈 리다이렉트·토큰 저장 → 실제 프로젝트
  화면에서 인증 전이 정상 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 인증 계층 신설 (점진 적용)**:

```
/login (토큰 발급·localStorage)          보호 적용 (이번 TASK):
  └─ Authorization: Bearer ─▶ AuthGuard ──┬─ PATCH …/contents/:id/status (EDITOR+)
       (DB 세션 검증 → request.user)      │    └─ actor → 감사 이력
       @RequireRole: 계층 비교            └─ POST /auth/users (ADMIN)
비보호(현행 유지): 조회·파이프라인 API — 전면 강제 범위는 CTO 결정 대기
```

① 인증 로직도 기존 원칙대로 분해 — 순수 로직(해시·토큰·계층)은 core,
저장·가드는 api, 화면은 web. ② 세션은 DB 저장형 — 유출 시 서버에서 즉시
폐기 가능. ③ Actor Audit로 0704 감사 이력이 완전해짐(누가·언제·무엇을).

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Playwright 공식 게이트 · 발행 전이 표준

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 19건**(+1), drift 없음

## 6. 데이터 모델

```
User (신설): id · email(유니크) · name · passwordHash(scrypt) · role(enum 3종)
AuthSession (신설): token(유니크 256bit) · userId(FK Cascade) · expiresAt
ContentStatusHistory: + actor String?  (수행자 이메일 — 기존 이력 null 보존)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| **인증** | `POST /auth/login`(공개) · `POST /auth/logout` · `GET /auth/me`(인증) · `POST /auth/users`(**ADMIN**) |
| 콘텐츠 | `PATCH …/contents/:id/status` — **EDITOR 이상 + actor 기록** (그 외 무변경) |

웹: **`/login`** (신설) · `/projects/[id]` 발행 UI가 토큰 첨부·401 안내

## 8. 리스크·기술 부채

1. **0801 해석 미확인** — 적용 범위(발행 전이·사용자 관리만)·역할 3종·
   localStorage 토큰 보관 방식 (CTO_REQUEST #31)
2. **전면 강제 미적용** — 조회·파이프라인 API는 여전히 공개 (로드맵 질의) —
   전면 강제 시 SOP/스모크/웹 서버 컴포넌트 인증 전파 작업 필요
3. **기본 관리자 비밀번호** — 로컬 전용 기본값 존재 (운영 배포 시
   AUTH_ADMIN_* 필수 — 문서 명시)
4. **토큰 보관 = localStorage** — XSS 노출면 존재 (httpOnly 쿠키 전환은
   웹/API 도메인 구성 확정 후 검토 항목)
5. **실키 스모크(운영/스테이징)·Anthropic/Gemini 연결** — 대기

## 9. 다음 권장 사항 (Sprint 8 후속 후보)

1. **CTO_REQUEST #31 확인** — TASK-0801 해석 확인 및 다음 지시
2. **인증 전면 강제 로드맵** — 쓰기 API 전체 보호 + 역할 정책표 확정
3. **사용자 관리 UI** — ADMIN용 사용자 목록/생성 화면 (Playwright 포함)
4. **httpOnly 쿠키 세션** — 배포 도메인 확정 시 토큰 보관 강화
5. **실키 스모크(운영/스테이징)** — 인증 포함 재검증
