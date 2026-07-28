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
| 보고 기준 TASK | **TASK-0803 — Password Management & Operational Security** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `40bd4d7` |
| 핵심 성과 | 비밀번호 변경/재설정 + **httpOnly·Secure·SameSite 세션 쿠키** + /llm/health 운영 보호 + 감사 확장 |
| 구현 중단 상태 | **TASK-0803 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 쿠키 병행 발급 구조·재설정 방식 등 → **CTO_REQUEST #33 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **332** — core 134(+4) · api 183(+5) · **web e2e 15(+3)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0803 — Password Management & Operational Security (`40bd4d7`)

지시 항목 전부 이행:

1. **Password Change**: `PATCH /auth/password` — 본인 셀프 서비스(모든
   역할). 현재 비밀번호 확인 · 최소 8자 · 동일 비밀번호 거부. 성공 시
   **현재 세션만 남기고 다른 세션 전부 폐기**(탈취 기기 차단) —
   Web UI `/account` 신설 (홈 내비 "🔑 내 계정")
2. **Password Reset**: `POST /auth/users/:id/password-reset` (ADMIN) —
   대상에게 새 비밀번호 지정, **대상의 모든 세션 즉시 폐기**. 자기 자신
   불가(400 — 변경 기능 사용). `/admin/users` 행별 인라인 재설정 UI
3. **httpOnly Cookie**: 로그인 시 `acos_session` httpOnly 쿠키 발급 —
   JS 접근 불가(XSS 토큰 탈취 방지). 서버는 **Bearer 헤더 → 쿠키** 순으로
   인식(개발 localStorage 호환 유지), 로그아웃 시 Max-Age=0 즉시 만료
4. **Secure Cookie**: `AUTH_COOKIE_SECURE=1` — HTTPS 전용 전송 (운영 필수,
   개발 기본 off)
5. **SameSite**: `AUTH_COOKIE_SAMESITE=lax|strict|none` (기본 lax) —
   `none`은 브라우저 규칙에 따라 **Secure 강제**(core 도메인 로직에서 차단)
6. **운영 보안 강화**: `/llm/health`(GET이지만 실 Provider 호출·Execution
   기록 발생)를 **운영/스테이징에서 EDITOR 이상 인증**으로 보호 — CTO 결정
   0802-③ 이행. NODE_ENV production/staging 자동 판정 +
   `AUTH_PROTECT_HEALTH=1|0` 명시 지정. 개발 비보호 유지. CORS
   `credentials: true`(쿠키 전송 허용, origin은 WEB_URL 단일 유지)
7. **Audit 확장**: `PASSWORD_CHANGED`(actor=본인) · `PASSWORD_RESET`
   (actor=ADMIN) — user_audit_log 액션 6종으로 확장 (**스키마 변경 없음** —
   action은 String 컬럼)
- 쿠키 순수 로직(`buildSessionCookie`/`buildSessionClearCookie`/
  `parseCookieHeader`)은 **core**, 환경변수 해석·가드는 **api 어댑터** —
  기존 계층 원칙 유지
- Playwright 3종 추가(공식 게이트): /account 미로그인 안내 · 변경
  오류→성공 흐름 · ADMIN 재설정+감사 로그

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 8 | 0801 Auth Foundation · 0802 User Mgmt & Full Write Protection | 승인 (정책 확정) |
| Sprint 8 | **TASK-0803 — Password Mgmt & Operational Security** | **완료 (`40bd4d7`) — 승인 대기** |
| Sprint 1~7 | Foundation ~ Publishing/관측 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 130 · **세션 쿠키 4** | 134 | ✅ |
| `apps/api` | Service+API — 기존 178 · **비밀번호 변경/재설정/쿠키 3 + health 보호 2** | 183 | ✅ |
| `apps/web` | Playwright e2e — 기존 12 · **비밀번호 관리 3** | 15 | ✅ |
| **합계** | | **332** | **전체 통과** |

신규 테스트가 검증하는 것:
- core: 쿠키 생성(HttpOnly/Max-Age/SameSite)·None→Secure 강제·삭제 쿠키·
  헤더 파싱(불량 쌍 무시)
- api: 변경(현재 비번 오류/짧음/동일 400 · 무토큰 401 · 성공 시 현재 세션
  유지+타 세션 폐기 · 이전 비번 401/새 비번 200 · 감사) · 재설정(EDITOR
  403 · 자기 자신 400 · 전 세션 폐기 · 감사) · 쿠키(발급·쿠키만으로 인증·
  로그아웃 만료) · health(개발 비보호 · 보호 모드 401/403/200)
- 웹 e2e: /account 미로그인 안내 · 오류→성공 변경 흐름 · ADMIN 인라인
  재설정+PASSWORD_RESET 감사 표시

라이브 검증 (실 PostgreSQL + 실스택):
- **쿠키**: 로그인 Set-Cookie(`HttpOnly; Max-Age=604800; SameSite=Lax`) →
  Bearer 없이 쿠키만으로 /auth/me 200·쓰기 201 → 로그아웃 Max-Age=0 →
  이후 401
- **변경/재설정**: 잘못된 현재 비번 400 → 변경 200 → 세션A 200/세션B 401 →
  이전 비번 401·새 비번 200 → ADMIN 재설정 → 전 세션 401·재설정 비번 200 →
  감사 [PASSWORD_RESET, PASSWORD_CHANGED, USER_CREATED] 순 기록
- **health**: 개발 기본 200(비보호) → `AUTH_PROTECT_HEALTH=1` 재기동 시
  무토큰 401·VIEWER 403·ADMIN 200
- **스모크 리허설 9/9 PASS** · 브라우저에서 /account 변경 성공 확인
  (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 비밀번호 수명주기 + 운영 세션 보안**:

```
로그인 ─▶ 토큰(본문, 개발 localStorage) + acos_session 쿠키(httpOnly)
                └─ AUTH_COOKIE_SECURE / AUTH_COOKIE_SAMESITE (운영 전환 준비 완료)
인증 인식: Bearer 헤더 → httpOnly 쿠키 (모든 가드 공통 extractRequestToken)
비밀번호: 변경(본인·타 세션 폐기) · 재설정(ADMIN·전 세션 폐기) ─▶ 감사 6종
/llm/health: 개발 비보호 · 운영/스테이징 EDITOR+ (환경 판정 가드)
```

① 운영 쿠키 전환은 이제 **환경변수 2개 설정으로 완료**(코드 변경 불필요 —
0801 승인 ③의 구현). ② 비밀번호 이벤트가 전부 세션 폐기와 결합 — 자격
증명 변경 시 이전 인증 상태가 남지 않는다. ③ 환경별 보호 수준(운영 강화·
개발 편의)이 명시적 env 판정으로 코드화.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 조회 비보호 ·
@Public 예외 3종 고정(0802 승인 ①) · Playwright 공식 게이트 · 역할 3종

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 20건**
(이번 TASK 스키마 변경 없음), drift 없음

## 6. 데이터 모델

변경 없음 — `user_audit_log.action`(String)에 PASSWORD_CHANGED /
PASSWORD_RESET 값 2종 추가 (마이그레이션 불필요)

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 비밀번호 | **`PATCH /auth/password`** (인증, 모든 역할) · **`POST /auth/users/:id/password-reset`** (ADMIN) |
| 쿠키 | `POST /auth/login` — Set-Cookie 발급 · `POST /auth/logout` — 만료. 전 보호 API가 Bearer→쿠키 순 인식 |
| health | `GET /llm/health` — 운영/스테이징 **EDITOR 이상** · 개발 비보호 |
| 그 외 | 변경 없음 (전면 쓰기 보호·@Public 예외 3종·조회 GET 비보호 유지) |

웹: **`/account`** (신설 — 비밀번호 변경) · `/admin/users` 행별 비밀번호
재설정 인라인 입력

## 8. 리스크·기술 부채

1. **0803 해석 미확인** — 쿠키 병행 발급(본문 토큰+쿠키 동시) 구조·재설정
   방식(ADMIN 직접 지정) 등 (CTO_REQUEST #33)
2. **웹 UI는 여전히 localStorage 사용(개발 모드)** — 운영 배포 시 웹을
   쿠키 전용(credentials 포함 fetch)으로 전환하는 후속 작업 필요
   (서버 준비는 완료)
3. **셀프 서비스 재설정(이메일 링크 등) 부재** — 비밀번호 분실 시 ADMIN
   재설정만 가능 (메일 인프라 없음 — 스펙 대기)
4. **조회 GET 비보호 노출면** — 사내망 전제 유지 (외부 공개 시 확대 필요)
5. **실키 스모크(운영/스테이징)·Anthropic/Gemini 연결** — 대기

## 9. 다음 권장 사항 (Sprint 8 후속 후보)

1. **CTO_REQUEST #33 확인** — TASK-0803 해석 확인 및 다음 지시
2. **웹 쿠키 전용 전환** — 운영 배포 시 localStorage 제거·credentials fetch
3. **로그인 시도 제한(rate limit)·계정 잠금** — 무차별 대입 방어
4. **실키 스모크(운영/스테이징)** — 쿠키·보호 포함 최종 검증
5. **Anthropic/Gemini 공식 연결** — OpenAI 5항목 패턴 재적용
