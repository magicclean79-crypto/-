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
| 보고 기준 TASK | **TASK-0804 — Login Protection & Security Hardening** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `5ce8a20` |
| 핵심 성과 | Rate Limit(429) · 계정 잠금 · 비밀번호 복잡도 · 실패/잠금 감사 · **쿠키 전용 운영 모드** · 세션 TTL |
| 구현 중단 상태 | **TASK-0804 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 기본값(30/60초·5회/15분)·인메모리 Rate Limit 등 → **CTO_REQUEST #34 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **344** — core 138(+4) · api 188(+5) · **web e2e 18(+3)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0804 — Login Protection & Security Hardening (`5ce8a20`)

지시 6항목 + Playwright 전부 이행. 로그인 보호 순서:
**Rate Limit(429) → 잠금 검사 → 비밀번호 검증(실패 카운트) → 비활성 검사**

1. **Rate Limit**: 이메일 키 슬라이딩 윈도우(core
   `SlidingWindowRateLimiter` 순수 로직) — 초과 시 **429**.
   `AUTH_LOGIN_MAX_ATTEMPTS`(기본 30) / `AUTH_LOGIN_WINDOW_SEC`(기본 60초).
   인메모리 1차 방어(단일 인스턴스 전제 — 부채 기록)
2. **Account Lockout**: 연속 실패 임계(기본 **5회**) 도달 시 DB 잠금
   (`users.lockedUntil`, 기본 **15분**) — 잠금 중엔 올바른 비밀번호도 거부.
   시간 경과 자동 해제 + **ADMIN 비밀번호 재설정 시 즉시 해제**, 성공
   로그인 시 카운터 초기화. 마이그레이션 1건(failedLoginCount/lockedUntil)
3. **Password Complexity**: **최소 8자 + 영문 1자 + 숫자 1자** — core
   `validatePasswordComplexity` 단일 정의, 생성·변경·재설정 공통 적용
   (기존 데이터·테스트 계정 전부 정책 부합 — 마이그레이션 불필요)
4. **Failed Login Audit**: `LOGIN_FAILED`(사유·n/임계 상세) ·
   `ACCOUNT_LOCKED`(잠금 시간) — 감사 액션 8종. 실존 계정만 기록(존재하지
   않는 이메일 스팸 방지). `/admin/users`에 **잠김 배지** 표시
5. **Cookie 전용 운영 모드**: `AUTH_COOKIE_ONLY`(미지정 시 운영/스테이징
   자동 켜짐) — 로그인 응답에서 **본문 토큰 제외**, httpOnly 쿠키만 사용
   (**CTO 결정 0803-① 이행**). 웹은 모든 인증 호출 `credentials: "include"`
   (`authFetchInit` 공통 헬퍼·업로더 XHR withCredentials) — Bearer(개발)와
   쿠키(운영) 양쪽 모드 지원, 로그인 UI는 토큰 부재 시 쿠키 모드로 동작
6. **Session Timeout**: `AUTH_SESSION_TTL_HOURS`(기본 168=7일) — 세션
   만료·쿠키 Max-Age가 동일 TTL을 따름
- **Playwright 3종** 추가: 연속 실패 5회 → 잠금 안내 · 복잡도 오류 표시 ·
  실패/잠금 감사 로그 렌더링

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 8 | 0801 · 0802 · 0803 (Auth Foundation → 비밀번호/운영 보안) | 승인 (정책 확정) |
| Sprint 8 | **TASK-0804 — Login Protection & Security Hardening** | **완료 (`5ce8a20`) — 승인 대기** |
| Sprint 1~7 | Foundation ~ Publishing/관측 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 134 · **복잡도 2 + Rate Limiter 2** | 138 | ✅ |
| `apps/api` | Service+API — 기존 183 · **잠금 1 + 429 1 + 복잡도 1 + 쿠키 전용 1 + TTL 1** | 188 | ✅ |
| `apps/web` | Playwright e2e — 기존 15 · **로그인 보호 3** | 18 | ✅ |
| **합계** | | **344** | **전체 통과** |

신규 테스트가 검증하는 것:
- core: 복잡도(8자/영문/숫자 위반 메시지·통과 null) · Rate Limiter(윈도우
  초과 거부·retryAfter·키 독립·윈도우 경과/reset 허용)
- api: 잠금(5회 실패 → 잠금 메시지·감사 ACCOUNT_LOCKED+LOGIN_FAILED≥5·
  lockedUntil 노출·재설정으로 해제) · Rate Limit(3회 설정 시 4번째 429) ·
  복잡도(생성/변경 경로 400) · 쿠키 전용(본문 token null·쿠키로 인증) ·
  TTL(1h 설정 시 expiresAt·쿠키 Max-Age=3600)
- 웹 e2e: 잠금 안내(올바른 비밀번호도 거부) · /account 복잡도 오류 ·
  감사 로그에 LOGIN_FAILED/ACCOUNT_LOCKED 표시

라이브 검증 (실 PostgreSQL + 실스택):
- 복잡도: "abcdefgh" → "숫자 포함" 400 · "12345678" → "영문자 포함" 400
- 잠금: 5회 실패(전부 401) → 올바른 비밀번호 "계정이 잠겼습니다" →
  목록 lockedUntil 확인 → ADMIN 재설정 → 즉시 로그인 200. 감사
  [PASSWORD_RESET, LOGIN_FAILED(잠금 상태), ACCOUNT_LOCKED, LOGIN_FAILED(5/5)]
- 운영 모드 재기동(AUTH_COOKIE_ONLY=1·TTL 1h·시도 3회): 본문 **token null** ·
  Set-Cookie Max-Age=3600 · 쿠키만으로 me 200/쓰기 201 · 4번째 로그인 **429**
- **스모크 리허설 9/9 PASS** · 브라우저에서 /admin/users 잠김 배지·감사
  로그 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 로그인 공격 대응 계층 + 운영 세션 완성**:

```
POST /auth/login
  ├─ ① Rate Limit (인메모리 슬라이딩 윈도우, 이메일 키) → 429
  ├─ ② 잠금 검사 (users.lockedUntil, DB) → 401 "계정이 잠겼습니다"
  ├─ ③ 비밀번호 검증 실패 → 카운트+1 · 임계 도달 시 잠금 · 감사 기록
  └─ ④ 성공 → 카운터 초기화 · 세션 발급(TTL env)
        └─ 쿠키 전용 모드(운영): 본문 토큰 제외, httpOnly 쿠키만
```

① 2계층 방어 — 휘발성 Rate Limit(광역 완속)과 영속 잠금(계정별 정밀)의
분리. ② 비밀번호 정책·잠금 해제가 기존 재설정 경로와 결합(운영 복구
절차 단순). ③ 운영 전환 체크리스트가 환경변수로 완결: `AUTH_COOKIE_ONLY`
(자동) + `AUTH_COOKIE_SECURE=1` + SameSite + TTL — 코드 변경 없음.

**유지되는 핵심 결정**: Port/Adapter 계층 · 조회 비보호 · @Public 예외
3종 · Playwright 공식 게이트 · Reset은 ADMIN 직접 지정(0803 승인 ②)

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 21건**(+1),
drift 없음

## 6. 데이터 모델

```
User: + failedLoginCount Int @default(0)  (연속 실패 횟수)
      + lockedUntil DateTime?             (잠금 해제 시각, null=잠금 없음)
UserDto: + lockedUntil (ADMIN 목록에서 잠금 상태 확인용)
user_audit_log.action: + LOGIN_FAILED · ACCOUNT_LOCKED (String — 스키마 무변경)
```

## 7. API 표면

| 영역 | 변경 |
| --- | --- |
| `POST /auth/login` | **429**(Rate Limit) · 잠금 401 추가. 쿠키 전용 모드 시 본문 token=null |
| 비밀번호 3경로 | 복잡도 400 메시지(8자/영문/숫자) 공통 적용 |
| `GET /auth/users` | lockedUntil 포함 |
| 그 외 | 변경 없음 |

웹: `/admin/users` 잠김 배지 · 인증 호출 전부 credentials include(쿠키
모드 지원) — 신규 화면 없음

## 8. 리스크·기술 부채

1. **0804 해석 미확인** — 기본값(Rate Limit 30회/60초·잠금 5회/15분·복잡도
   8자+영문+숫자)의 적절성 (CTO_REQUEST #34)
2. **Rate Limit 인메모리** — 다중 인스턴스 수평 확장 시 공유 저장소(Redis
   등) 필요, 재시작 시 초기화 (잠금은 DB라 영속)
3. **잠금 수동 해제 UI 부재** — ADMIN은 비밀번호 재설정으로 해제 가능
   (별도 "잠금 해제" 버튼은 스펙 대기)
4. **조회 GET 비보호 노출면** — 사내망 전제 유지
5. **실키 스모크(운영/스테이징)·Anthropic/Gemini 연결** — 대기

## 9. 다음 권장 사항 (Sprint 8 후속 후보)

1. **CTO_REQUEST #34 확인** — TASK-0804 해석 확인 및 다음 지시
2. **운영 배포 준비 체크리스트 확정** — 도메인·HTTPS·환경변수 세트
   (AUTH_COOKIE_SECURE 등) 문서화 최종화
3. **실키 스모크(운영/스테이징)** — 로그인 보호·쿠키 전용 포함 최종 검증
4. **Anthropic/Gemini 공식 연결** — OpenAI 5항목 패턴 재적용
5. **Sprint 8 종료 여부 판단** — 인증/보안 체계 완성도 리뷰
