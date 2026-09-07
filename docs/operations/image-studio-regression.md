# Image Studio 회귀 방지 체계 (T1-119)

> **문제**: Image Studio에 기능을 하나 추가하거나 고칠 때마다 이미지
> 로딩·사진 선택·Gemini 생성·Product Story·상세페이지 중 어딘가가
> 조용히 깨졌다. 원인은 코드 하나가 아니라 **의존관계를 아무도 한
> 화면에 정리해 두지 않았다는 것**이었다.
>
> 이 문서는 ① 지금 실제 코드에 있는 의존관계를 고정해 적어 두고,
> ② 그것을 지키는 회귀 테스트 한 명령을 정의하고, ③ 이 명령을
> 통과하지 못하면 완료로 보지 않는다는 규칙을 못박는다.

---

## 1. Image Studio 의존관계 지도 (실제 코드 기준, 2026-08-13)

### 1-1. 화면 구성

```
apps/web/app/image-studio/
  page.tsx                    ← 라우트 진입점
  image-studio-view.tsx       ← 전체 조립 (① 참조 사진 선택 → ② 생성 → ③ 선택 → ④ 확인)
    ├─ category-panel.tsx        (카테고리별 후보 생성·버전관리·선택)
    ├─ detail-page-panel.tsx     (④-A 선택 이미지 기준 상세페이지, 카테고리 순서 배치)
    ├─ product-story-panel.tsx   (④-B Product Story 기반 상세페이지, LLM 스토리 설계)
    ├─ user-requirement-panel.tsx(공용 요구사항 저장 + 상세페이지 재생성)
    └─ AuthImage(../product-profile/auth-image.tsx) — 모든 썸네일이 공유
  product-profile-lookup.ts   ← sourceImageId → 최근 Product Profile 조회 (5개 컴포넌트가 공유)
  api-client.ts               ← API baseURL·인증·오류 분류 공유 (T1-119, 신규)
```

### 1-2. API 의존관계 (Image Studio가 실제로 호출하는 엔드포인트)

| 엔드포인트 | 호출 위치 | 비용 | 인증 |
| --- | --- | --- | --- |
| `GET /uploads/images/:id/file` | `AuthImage` (모든 썸네일) | 없음 | Bearer/쿠키 (읽기, 비보호) |
| `GET /image-gen/images?ids=` | `image-studio-view.tsx` (DESIGN/INFO 분류) | 없음 | 읽기, 비보호 |
| `POST /image-gen/hero` | `image-studio-view.tsx` (하단 "빠른 테스트") | **Gemini 3건** | `@Public()` |
| `GET /image-gen/candidates` | `category-panel.tsx` | 없음 | 읽기, 비보호 |
| `POST /image-gen/candidates` | `category-panel.tsx` (생성) | **Gemini 1건** | `@Public()` |
| `POST /image-gen/select` | `category-panel.tsx` (선택) | 없음 | `@Public()` |
| `GET /product-profile?take=` | `product-profile-lookup.ts` (5개 컴포넌트 공유) | 없음 | 읽기, 비보호 |
| `PATCH /product-profile/:id/user-requirement` | `category-panel.tsx`·`user-requirement-panel.tsx` | 없음 | `@PublicInDev()` |
| `POST /product-profile` | `user-requirement-panel.tsx` (재생성) | **OpenAI 3건** | `@PublicInDev()` |
| `GET /product-profile/:id/final` | `detail-page-panel.tsx` | 없음(기존 결과 재조립) | 읽기, 비보호 |
| `GET /product-profile/:id/final-html` | `detail-page-panel.tsx` | 없음 | 읽기, 비보호 |
| `POST /product-profile/:id/story` | `product-story-panel.tsx` | **LLM 1건** | `@PublicInDev()` |

**결론**: Image Studio 자체 화면 진입·사진 로딩·분류·선택·기존 결과 조회는
전부 **무료(GET)** 다. 비용이 드는 것은 "생성"·"재생성"·"Product Story
생성" 버튼 3개뿐이다 — 회귀 테스트는 이 경계를 절대 넘지 않는다(§3).

### 1-3. 인증 — localhost는 로그인 없이 접근 가능 (요청 #7, 이미 구현됨)

`apps/api/src/auth/session-config.ts`의 `isOperationalEnv()`가
`NODE_ENV`가 `production`/`staging`이 아니면 개발 환경으로 판정하고,
`@PublicInDev()`(`apps/api/src/auth/write-protection.guard.ts`)가 그때만
인증을 건너뛴다 — **운영/스테이징에서는 그대로 인증을 요구한다.** 이미
T1-110에서 구현되어 있었고(이번 작업은 이 사실을 검증만 하고 코드는
변경하지 않았다), 위 표의 쓰기 엔드포인트 대부분이 `@Public()` 또는
`@PublicInDev()`로 표시돼 있다.

### 1-4. 공통 인프라 중복 — 무엇을 중앙화했는가 (T1-119)

**있었던 문제**: `const API_URL = process.env.NEXT_PUBLIC_API_URL ??
"http://localhost:4000"`와 "응답 body에서 message 뽑아 Error 던지기"
패턴이 Image Studio 안에서만 6개 파일에 거의 동일하게 복사돼 있었다
(`image-studio-view.tsx`·`category-panel.tsx`·`detail-page-panel.tsx`·
`product-story-panel.tsx`·`user-requirement-panel.tsx`·
`product-profile-lookup.ts`). 어떤 곳은 네트워크 오류를 못 잡아
처리되지 않은 Promise 거부로 남고(`category-panel.tsx`의 `pick()` —
`selectImage`가 실패해도 결과를 검사하지 않았다), 어떤 곳은 실패
원인을 구분하지 않고 그대로 `err.message`("Failed to fetch")를
사용자에게 보여줬다(T1-113이 Product Story에서 고친 것과 같은 종류의
문제가 다른 패널에도 잠재해 있었다).

**한 일**: `apps/web/app/image-studio/api-client.ts`(신규)에
`imageStudioFetch<T>()`를 만들어 baseURL·인증 헤더·JSON 파싱·오류
메시지 추출을 한 곳에 모았다. 실패를 셋으로 구분한다.

| `kind` | 뜻 | 사용자 메시지 |
| --- | --- | --- |
| `network` | 서버 연결 자체가 안 됨(CORS·오프라인·서버 다운) | "서버에 연결할 수 없습니다 (네트워크 또는 CORS 문제) — 개발자 콘솔을 확인하세요." |
| `http` | 서버가 오류 상태로 응답 | 응답 본문의 `message` (배열이면 join) — 없으면 `요청 실패 (HTTP {status})` |
| `parse` | 응답을 JSON으로 해석하지 못함 | `요청 실패 (HTTP {status}) — 서버 응답을 해석하지 못했습니다.` |

개발환경(`NODE_ENV !== "production"`)에서는 실패마다 `console.error`로
원인(엔드포인트·상태 코드·원본 메시지)을 남긴다 — 화면에는 "불러오기
실패"만 뜨고 원인은 코드를 뒤져야 알 수 있던 문제(`AuthImage`가
T1-114에서 이미 고친 것과 같은 원칙)를 API 호출 쪽에도 적용했다.

**적용 범위**: `image-studio-view.tsx`·`category-panel.tsx`·
`user-requirement-panel.tsx`·`product-profile-lookup.ts` 4개 파일을
`imageStudioFetch`로 옮겼다 — 동작은 그대로 두고 내부 구현만 옮긴
행위 보존 리팩터다(호출 시그니처·반환 타입·기존 lenient 계약 그대로).

**의도적으로 옮기지 않은 것**: `detail-page-panel.tsx`·
`product-story-panel.tsx`는 이번 작업 시점에 다른 진행 중인 작업
(T1-115~T1-118, 상세페이지 스토리/디자인 품질)이 실시간으로 같은
워크트리에서 수정하고 있어(`docs/PROJECT_MEMORY.md` M-28과 같은
위험), 충돌을 피하려 손대지 않았다. 두 파일은 여전히 기존
`const API_URL = ...` 패턴을 쓴다 — 동작에는 문제가 없지만, 저
작업들이 끝난 뒤 `api-client.ts`로 옮기는 것을 다음 작업으로 남긴다.

### 1-5. Frontend/Backend 타입 계약 — 이미 구조적으로 강제되어 있다

Image Studio가 쓰는 모든 응답 타입(`ImageDto`·`ProductProfileDto`·
`GenerateImageCandidatesResult`·`ProductProfileFinalPageDto`·
`ProductStoryResultDto`)은 `packages/shared`에 **한 번만** 정의되고,
NestJS 컨트롤러(`apps/api/src/image-gen/image-gen.controller.ts`·
`apps/api/src/product-profile/product-profile.controller.ts`)가 그
타입을 `Promise<T>` 반환형으로 그대로 쓰며, 프런트 컴포넌트도 같은
타입을 `import type`으로 쓴다. 즉 **`pnpm turbo run typecheck`가 이미
FE/BE 타입 불일치의 1차 자동 검출기다** — 타입을 어느 한쪽만 바꾸면
그 자리에서 컴파일이 깨진다. 이번 작업은 새 계약 검사 프레임워크를
따로 만들지 않았다(있는 것을 중복 구현하지 않는다) — 대신 §3의
스모크 테스트가 "타입은 맞아도 실제 응답 값이 비정상"인 경우(런타임
드리프트)를 보완한다.

---

## 2. 지금까지 실제로 확인한 원인 — 다시 만들지 않기 위해 남긴다

| 증상 | 실제 원인 | 근거 |
| --- | --- | --- |
| Benchmark 7장 "불러오기 실패" | 재현 불가(현재 코드) — 과거엔 로컬/원격 ID 불일치(M-19)가 원인이었다 | T1-114 |
| Product Story "Failed to fetch" | API 호출 실패 원인을 구분하지 않고 브라우저 원문을 그대로 노출 | T1-113 |
| 여러 e2e가 동시에 실패했다 사라짐 | 같은 워크트리를 여러 Bridge 세션이 동시에 고쳐 `next dev`가 순간적으로 비일관 상태를 서빙 — 코드 결함이 아니다 | T1-114(179건→단독 재실행 시 전부 통과) |

---

## 3. 회귀 테스트 — 반드시 한 명령으로 실행 가능해야 한다

```bash
node scripts/check-image-studio-smoke.mjs
# 또는
pnpm check:image-studio-smoke
```

**전제**: `scripts/start-verify-studio.ps1`로 로컬 API(4100)·Web(3100)이
떠 있어야 한다(§9, `docs/DEVELOPMENT_ENVIRONMENT.md` §14). 이 스크립트
자체는 서버를 띄우지 않는다.

**검사 범위**(전부 무료 — Gemini/OpenAI 실 호출 없음):

1. API `/health` 응답
2. Benchmark 7장 원본 이미지 조회 + CORS 헤더
3. DESIGN/INFO 분류(`GET /image-gen/images`) 응답
4. Benchmark Product Profile 존재·`SUCCESS` 상태
5. 최종 상세페이지 조회(`GET /final`·`GET /final-html`)
6. **[T1-119 신규]** 후보 이미지 응답이 `ImageDto` 형태(구조 계약)
7. **[T1-119 신규]** 존재하지 않는 리소스 조회 시 5xx가 아닌 4xx +
   JSON 오류 본문(오류 원인 구분, 요청 #9)
8. 브라우저(Playwright)로 실제 화면 로드 → 7장 로딩 실패 0건 → INFO
   비활성화 → 기본 선택 체크 → Product Story 준비 확인이 "Failed to
   fetch" 없이 응답 → 선택 이미지 상세페이지 확인이 오류 없이 응답 →
   처리되지 않은 JS 오류 0건

**판정**: 하나라도 실패하면 전체가 실패(exit 1)로 끝난다.

### 3-1. 완료 판정 규칬 — 통과하지 못하면 완료가 아니다

**Image Studio의 화면·API·타입 중 하나라도 바꾸는 작업은, 완료로
보고하기 전에 위 명령을 반드시 실행하고 통과시켜야 한다.** 실패한
채로 "코드는 다 썼다"는 이유로 완료 처리하지 않는다(`AGENTS.md` "절대
원칙 7. 기존 기능을 깨뜨리지 않는다"와 같은 원칙의 구체화). 이 규칙은
`AGENTS.md`에도 같은 문장으로 못박아 둔다.

### 3-2. 회귀 테스트(무료)와 품질 테스트(과금)는 분리한다 (요청 #6)

| | 명령 | 비용 | 목적 |
| --- | --- | --- | --- |
| 회귀 테스트 | `pnpm check:image-studio-smoke` | 없음 | "기존 기능이 여전히 도는가" — 매 변경마다 실행 |
| 품질/실연결 테스트 | `node scripts/real-provider-smoke.mjs` | 있음(실 Provider 호출) | "실제 Gemini/OpenAI와 통신해 실제 품질이 나오는가" — 운영/스테이징 배포 전에만 |

두 스크립트는 서로 대체하지 않는다. 회귀 테스트가 통과했다고 품질이
좋다는 뜻이 아니고(M-9 "테스트 통과는 배선이 맞다이지 결과가 좋다가
아니다"), 품질 테스트를 매 커밋마다 돌리면 비용이 무한정 쌓인다.

---

## 4. 남은 한계 (이번 작업이 하지 않은 것)

- `detail-page-panel.tsx`·`product-story-panel.tsx`는 동시 진행 작업과의
  충돌을 피해 `api-client.ts`로 옮기지 않았다(§1-4) — 다음 작업 대상.
- 스모크 테스트의 Playwright 구간은 `scripts/start-verify-studio.ps1`로
  띄운 **프로덕션 빌드 스냅샷**을 대상으로 한다 — `next dev`로 여러
  세션이 동시에 파일을 고치는 동안 실행하면 T1-114가 겪은 것과 같은
  일시적 비일관 실패가 다시 날 수 있다(코드 결함이 아니다, §2).
- 앱 전체(`apps/web/app/**` 45개 파일)에 퍼진 `NEXT_PUBLIC_API_URL ??
  "http://localhost:4000"` 중복은 Image Studio 밖의 범위라 손대지
  않았다 — 이번 작업은 요청 범위(Image Studio)를 넘지 않는다.
