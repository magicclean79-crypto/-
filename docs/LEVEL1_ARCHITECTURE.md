# LEVEL 1 ARCHITECTURE — 새 상세페이지 생성 프로그램의 최소 기반 (T1-188)

> **이 문서가 다루는 범위는 LEVEL 1뿐이다.** 이전 STEP1 이후 만들어진
> 상세페이지 생성 파이프라인(Product Profile · Product Story · Design
> Director · Gemini 이미지 생성 등, `docs/PROJECT_STATE.md`의 T1-100번대~
> T1-180번대 다수)은 **이 문서의 대상이 아니다.** 그 파이프라인은 이번
> 작업으로 폐기되지도, 수정되지도 않았다 — 그저 LEVEL 1이 그것을
> **기준으로 삼지 않을 뿐**이다.

**작성일: 2026-08-23 (T1-188)**

---

## 0. 왜 이 문서가 필요한가

사용자 지시: "기존 개발 인프라는 그대로 유지하고, 상세페이지 생성
프로그램만 LEVEL 1부터 새로 만든다. 이전 STEP1 이후 애플리케이션 코드는
기준으로 사용하지 않는다."

즉 이 저장소 안에는 이제 **두 개의 서로 다른 것**이 공존한다.

| | 정체 | 이 문서가 다루는가 |
| --- | --- | --- |
| 기존 인프라(PostgreSQL·MinIO·포트·Bridge·Git 이력) | **계속 쓴다** — 새로 만들지 않는다 | 아래 §1 |
| 이전 STEP1 이후 상세페이지 생성 코드(Product Profile/Story/Design Director/Gemini 파이프라인) | **기준으로 삼지 않는다** — 지우지도 않는다 | 다루지 않음 |
| LEVEL 1(이 작업) | 제품 사실 입력 + 실제 제품 사진 asset 보관만 하는 **새 최소 기반** | 이 문서 전체 |

혼동을 막기 위해 LEVEL 1의 모든 코드·테이블·타입 이름에는 `Level1`
접두사를 붙였다. 기존 `Project`/`Product`/`Image`와 이름이 겹치지 않는다.

---

## 1. 기존 인프라 — 그대로 유지했다 (변경 없음)

| 인프라 | 확인한 사실 |
| --- | --- |
| PostgreSQL `localhost:5432` | 기존 연결 그대로 사용. 기존 테이블(`projects`·`products`·`images`·`product_profiles` 등)은 **하나도 건드리지 않았다** — 새 마이그레이션 1건(`20260907000000_level1_foundation`)이 새 테이블 3개 + enum 1개만 추가한다 |
| MinIO `localhost:9000`, 버킷 `acos` | 같은 버킷을 그대로 쓴다. 다만 object key를 `level1/<productId>/<uuid>.<ext>` 아래로 분리해 기존 `images/...` 키와 절대 섞이지 않는다 |
| Web `:3100` / API `:4100` | 포트 변경 없음. 기존 `scripts/start-verify-studio.ps1`(수정하지 않음)로 재기동해 `/level1`·`/level1/*` API가 정상 응답함을 확인했다 |
| Bridge `:4200`/`:4201`, cloudflared tunnel | 손대지 않았다 |
| AI provider credential 환경변수 | 손대지 않았다. LEVEL 1은 **AI 호출을 하나도 하지 않는다**(과금 없음) |
| Git repository/history | 커밋·푸시하지 않았다(요청 범위 밖) |

**기존 인프라 데이터는 읽기만 했다** — 아래 실측으로 "새 Level1 데이터
모델이 기존 인프라와 연결 가능한가"를 확인했다.

```
prisma migrate status  →  "Database schema is up to date!" (마이그레이션
                            적용 전, 기존 스키마 정상 확인)
prisma migrate deploy  →  20260907000000_level1_foundation 1건만 적용,
                            기존 마이그레이션 70건은 그대로
```

## 2. LEVEL 1 데이터 모델

### 2-1. 원칙

- **확인되지 않은 값을 만들어내지 않는다.** LEVEL 1에는 AI 자동 추출이
  없다 — 모든 필드는 사람이 화면에서 직접 입력한다.
- 비어 있는 필드는 `null`/빈 배열로 남는다. 그럴듯한 값으로 채우지 않는다.
- 값이 있어도 사람이 "확실하지 않다"고 표시할 수 있다(`uncertainFields`).

### 2-2. 스키마 (`apps/api/prisma/schema.prisma`, 마이그레이션
`20260907000000_level1_foundation`)

```
Level1Project
  id, name, createdAt, updatedAt
  products  Level1Product[]

Level1Product   ← immutable product facts
  id, projectId
  name, brand, model, category        String?
  materials, colors, includedComponents, claims   String[]
  dimensions, origin                  String?
  source            String  @default("manual")   ← LEVEL 1은 항상 "manual"
  uncertainFields   String[]                       ← 값이 있어도 미확정 표시
  notes             String?
  assets    Level1Asset[]

Level1Asset     ← 이미지 asset. 파일은 MinIO, DB는 메타데이터만
  id, productId
  objectKey  String @unique   ← "level1/<productId>/<uuid>.<ext>"
  originalName, mimeType, size
  role       Level1AssetRole @default(UNKNOWN)
  roleSetBy  String? @default("manual")
  roleSetAt  DateTime?

enum Level1AssetRole {
  ACTUAL_PRODUCT PACKAGING LABEL SPEC BARCODE MANUAL LIFESTYLE UNKNOWN
}
```

`Level1Product`가 요청 사양 5의 productId/name/brand/model/category/
materials/colors/dimensions/includedComponents/origin/claims/
source(provenance)/uncertainFields(confidence)를 그대로 담는다.

### 2-3. asset role — 요청 사양 4

8종 role은 저장만 한다. **AI 자동 분류는 LEVEL 1의 범위가 아니다** —
`roleSetBy`가 항상 "manual"인 것이 그 경계를 코드로 고정한다. 다음
레벨에서 자동 분류가 생기면 이 필드 값이 "auto" 등으로 갈릴 지점이다.

## 3. 코드 구조 — 어디에 무엇이 있는가

```
packages/shared/src/index.ts       Level1* DTO 타입 (Level1ProjectDto 등)
packages/core/src/level1/          순수 함수 — DB/네트워크 접근 없음
  level1-asset-role.ts               role 값 검증
  level1-product-facts.ts            제품 사실 입력 검증·정리(빈 문자열→null)
apps/api/src/level1/               API — 기존 파이프라인 코드 재사용 없음
  level1.module.ts
  level1.controller.ts               /level1/* 라우트
  level1.service.ts                  PrismaService·StorageService만 주입
                                      (둘 다 @Global 기존 인프라 어댑터)
apps/web/app/level1/               Web — Image Studio 등 다른 화면 코드
  page.tsx                           재사용하지 않음(완전히 새 파일)
  level1-view.tsx
  level1-client.ts                   전용 fetch 래퍼(lib/auth-client만 공유)
```

**재사용한 것 vs 새로 만든 것**

| | 재사용 | 새로 만듦 |
| --- | --- | --- |
| DB 접속(PrismaService) | ✅ 기존 인프라 어댑터 | |
| MinIO 접속(StorageService) | ✅ 기존 인프라 어댑터 | |
| 인증(`@PublicInDev` 등 `write-protection.guard.ts`) | ✅ 기존 인프라 규칙 | |
| 상세페이지 렌더링/디자인/이미지 생성 코드 | | (가져오지 않음 — LEVEL 1 범위 밖) |
| Level1 DTO·검증 함수·서비스·컨트롤러·화면 | | ✅ 전부 신규 |

## 4. API

`@PublicInDev()` — 로컬 개발에서는 로그인 없이 열려 있고, 운영/스테이징
(`NODE_ENV`)에서는 그대로 인증을 요구한다(`product-profile.controller.ts`와
같은 기존 규칙, T1-110). 과금 호출이 전혀 없다.

```
POST   /level1/projects                          프로젝트 생성
GET    /level1/projects                           목록
GET    /level1/projects/:id                        단건 조회
POST   /level1/projects/:id/products               제품 생성(빈 사실로 시작 가능)
GET    /level1/projects/:id/products                제품 목록
GET    /level1/products/:id                          제품 조회
PATCH  /level1/products/:id                          제품 사실 수정(PATCH — 보낸 필드만 변경)
POST   /level1/products/:id/assets                    사진 업로드(multipart, MinIO 저장)
GET    /level1/products/:id/assets                     asset 목록
GET    /level1/assets/:id/file                          원본 바이트
PATCH  /level1/assets/:id/role                          role 수정(사람이 직접)
DELETE /level1/assets/:id                                삭제(DB+MinIO 양쪽)
```

## 5. Web 화면

`http://localhost:3100/level1` — 단일 화면, 아래 순서로 배치했다(요청
사양 7 그대로).

```
1. 프로젝트 생성/선택
2. 제품 생성/선택
3. 제품 기본정보 — 필드별 "미확정" 체크박스, 저장 버튼
4. 실제 제품 사진 업로드 + role 지정(select) + 삭제
5. "상세페이지 디자인 생성" 버튼 — disabled placeholder
   (LEVEL 2 이상 — 이번 레벨에서 만들지 않음)
```

## 6. 검증

| 검사 | 결과 |
| --- | --- |
| `pnpm turbo run build` | 6/6 성공 (web 빌드 결과에 `/level1` 라우트 포함 확인) |
| `pnpm turbo run typecheck` | 10/10 성공 |
| `npx eslint .` | Level1 관련 파일 0건. 저장소 전체 24건은 이번 작업이 만들지 않은 `.tmp/`·`scripts/` 파일(다른 동시 작업 소유, 아래 §7 참고) |
| `@acos/core` 테스트 | 150 스위트/2173건 전부 통과(Level1 순수 함수 10건 포함) |
| `apps/api` 테스트 | 82/83 스위트 통과. 실패 1건(`ops.spec.ts`, 8 테스트)은 이 작업이 건드리지 않은 파일이며 기존에도 실패하던 것(`docs/PROJECT_MEMORY.md` M-10과 같은 종류) |
| `apps/web` Playwright | 3100 고정 검증 서버와 충돌(기존에 문서화된 구조적 문제, M-68/M-149) — 이번 작업이 만든 문제가 아니다 |
| 브라우저 실측(Playwright 스크립트, 실행 후 삭제) | 프로젝트 생성→제품 생성→사실 저장(저장됨 표시 확인)→사진 업로드→role 지정까지 전 과정 통과, **console error 0건** |
| API 실측(curl) | 한글 제품명 UTF-8 왕복 확인, 이미지 업로드 후 바이트 단위 원본과 동일함(`cmp`) 확인 |

### 6-1. 검증 중 발견해 고친 버그

브라우저 검증에서 "저장" 버튼을 눌러도 "저장됨" 표시가 곧바로 사라지는
현상을 발견했다. 원인은 `level1-view.tsx`의 폼 초기화 `useEffect`가
`selectedProduct` **객체 참조**를 의존성으로 두고 있었던 것 — 저장
성공 후 `products` state를 갱신하면 `selectedProduct`가 새 참조가
되어 이 effect가 다시 돌며 `saveStatus`를 곧바로 `"idle"`로 되돌렸다.
`selectedProductId`(제품이 바뀔 때만 바뀌는 값)를 의존성으로 바꿔
고쳤다 — 재현 스크립트로 수정 전후를 직접 비교해 확인했다(수정 전
`save confirmed: false`, 수정 후 `true`).

## 7. 이번 세션 중 확인한 동시 작업 (참고, 손대지 않음)

이 워크트리는 여러 Bridge 세션이 동시에 코드를 고치는 환경이다
(`docs/PROJECT_MEMORY.md` M-28). 이번 작업 도중 `apps/api/src/
app.module.ts`가 다른 세션에 의해 실시간으로 바뀌는 것을 목격했다 —
`T1-189`(`apps/api/src/level1-generate/`, `apps/web/app/level1-generate/`)가
동시에 등록되었다. **이 코드는 이번 작업(T1-188)이 만들지도, 검증하지도
않았다** — 다른 taskId의 산출물이며, 이름이 비슷해 혼동하기 쉬우니
분명히 남긴다.

- `Level1Module`(이 작업)과 `Level1GenerateModule`(T1-189)은 이름이
  다르고 서로 참조하지 않는다.
- 이 문서·LEVEL 1 스키마·`/level1` 화면은 **디자인/이미지 생성을 다루지
  않는다**는 원칙을 지켰다. `/level1-generate`가 그 원칙과 어떤 관계인지는
  이 작업의 판단 범위가 아니다.

## 8. LEVEL 1 완료 기준 — 자체 점검

| 기준 | 충족 여부 |
| --- | --- |
| 기존 인프라가 살아 있다 | ✅ (§1) |
| 새 프로그램의 LEVEL1 코드가 독립적으로 존재한다 | ✅ (§3, 기존 파이프라인 코드 재사용 없음) |
| 제품 기본정보와 실제 제품 이미지를 DB+MinIO로 저장/조회할 수 있다 | ✅ (§4, §6 실측) |
| asset role과 provenance를 명시할 수 있다 | ✅ (`role`, `roleSetBy`, `source`) |
| 확인되지 않은 제품 사실을 자동 생성하지 않는다 | ✅ (AI 호출 없음, 빈 값은 null/빈 배열) |
| 브라우저에서 LEVEL1 화면을 실제로 확인할 수 있다 | ✅ (§6, `http://localhost:3100/level1`) |
| console errors 0, API smoke 성공 | ✅ (§6) |

**LEVEL 2 이상(디자인·이미지 생성)은 이 작업에서 구현하지 않았다.**
