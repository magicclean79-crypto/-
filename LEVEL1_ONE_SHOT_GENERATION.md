# LEVEL 1 원샷 상세페이지 생성 (T1-189)

> 이 문서는 `docs/RECOVERY_GUIDE.md` §2의 문서 지도에 포함되지 않은
> **기능 단위 원칙 문서**다. Level1 기반 구조 자체(테이블·asset 업로드)는
> T1-188의 산출물이며, 그 문서는 T1-188 완료 보고에 별도로 남는다. 이
> 문서는 그 위에 얹은 **원샷 생성 한 가지 기능**만 다룬다.

## 무엇을 만들었는가

사진 업로드부터 완성된 상세페이지 이미지까지, **사용자가 보는 화면은
하나**다.

```
[사진 업로드]  →  미리보기  →  [상세페이지 생성]  →  생성 중  →  [완성된 이미지]
```

브라우저 주소: `http://localhost:3100/level1-generate`

내부적으로는 기존 LEVEL1 project/product/asset API(T1-188, `/level1/projects`·
`/level1/products`·`/level1/products/:id/assets`)를 그대로 호출해 저장하지만,
그 화면(`/level1`)으로 사용자를 보내지 않는다 — Product Profile/Design
Profile/Composition/Renderer 같은 중간 화면도 노출하지 않는다.

## 핵심 원칙 — 왜 이렇게 만들었는가

### 1. "원샷"의 정의 — 진짜 단일 호출인가

**그렇다.** `apps/api/src/level1-generate/gemini-one-shot.client.ts`가
`@google/genai`의 `client.models.generateContent()`를 **정확히 1번만**
호출한다(`Level1GenerateService.generate()` 안에서 재시도·2차 호출
없음). 이 한 번의 호출에 다음을 전부 지시한다(프롬프트 전문은
`one-shot-prompt.ts`, 실제 생성 결과의 `promptText` 필드에 그대로 남는다):

1. 업로드된 사진 전체를 보고 제품을 분석(제품명·브랜드·소재·색상·규격·구성품)
2. 핵심 판매 포인트 판단
3. 상세페이지 디자인 콘셉트·레이아웃·타이포·색·아이콘·그래픽 결정
4. 실제 제품 사진 기반으로 완성된 상세페이지 이미지 1장 생성

**모델 출력은 이미지 1장뿐**이다(`config.responseModalities: [Modality.IMAGE]`
— 이 요청 형태는 기존 `apps/api/src/image-gen/providers/gemini-image.provider.ts`
가 2026-08-08 staging에서 이미 실측 검증한 것과 동일하다). 즉 "분석
결과"를 별도 텍스트/JSON으로 돌려받지 않는다 — 분석·디자인 결정이
무엇이었는지는 **프롬프트 자체가 유일한 기록**이며, 그래서 매 생성마다
`promptText`를 DB(`level1_generations.promptText`)에 통째로 저장한다.

### 2. 왜 별도 분류 API 호출을 추가하지 않았는가

실제 제품 사진과 포장/라벨/사양표 사진을 구분하는 작업을 **AI 호출을
하나 더 만들어 먼저 분류하는 방식으로 만들지 않았다.** 대신 업로드된
모든 사진을 역할 힌트와 함께 같은 한 번의 호출에 넣고, 프롬프트 문장으로
"실제 제품 사진인지 포장/라벨인지 스스로 판단해서 구분하라"고 지시한다
(`one-shot-prompt.ts`의 `ROLE_LABEL`, 특히 `UNKNOWN` 역할 설명 참고).
이유는 두 가지다.

- **원샷 요구사항**: 작업 지시 자체가 "하나의 멀티모달 생성형 AI 호출"을
  요구한다. 분류를 별도 호출로 만들면 그 순간 2단계 파이프라인이 된다.
- **비용 최소화**: 이 프로젝트의 API 비용 최소화 원칙(꼭 필요할 때 1회만)과
  맞지 않는 추가 과금 호출이 된다.

사용자가 `PATCH /level1/assets/:id/role`(T1-188이 만든 기존 엔드포인트,
수정하지 않음)로 미리 역할을 지정해 둔 asset이 있으면, 이 서비스는 그
값을 우선 사용해 정렬한다(`ACTUAL_PRODUCT`를 항상 맨 앞에 배치) — 다만
이번 원샷 UI 화면 자체는 역할 지정 화면을 사용자에게 보여주지 않으므로,
실제로는 거의 항상 전부 `UNKNOWN` 상태로 들어가고 모델이 스스로
판단한다.

### 3. 제품 동일성 — 코드로 강제한 것과, 모델에게 지시만 한 것

**코드로 강제한 것**:

- 실제 업로드 원본(`level1_assets`, `putObject` key가 `level1/...`)은
  이 기능이 **읽기만** 한다. 절대 덮어쓰거나 삭제하지 않는다
  (`Level1GenerateService`에 asset을 수정/삭제하는 코드 자체가 없다).
- 생성 결과는 원본과 완전히 분리된 새 오브젝트 키(`level1-generate/...`)에
  저장한다 — 원본과 결과가 섞일 수 없다.
- 생성 결과 레코드에는 이 생성에 실제로 사용한 `referenceAssetIds`(입력
  순서 그대로)를 남긴다 — 나중에 "이 이미지가 어떤 사진들을 근거로
  나왔는지" 역추적할 수 있다.

**모델에게 지시만 한 것(코드로 검증하지 않음 — 사람이 검증한다,
`docs/MASTER_GUIDE.md` 철학 3)**:

- 제품 형태·구조·구성품 개수·색상·재질·크기 비율을 바꾸지 말 것
- 배경·조명·구도·분위기만 바꿀 것
- 포장/라벨 사진 속 상자·인쇄물 자체를 제품 형태로 생성하지 말 것

이 지시가 실제로 지켜졌는지는 **AI가 판단하지 않는다.** 생성된 이미지를
`GET /level1/generations/:id/file`로 받아 브라우저에서 사람이 직접
원본과 대조해야 한다 — 이 문서도, 코드도 "제품이 동일합니다"라고
주장하지 않는다.

### 4. 왜 HTML/CSS가 아니라 이미지 1장인가

작업 지시가 명시적으로 요구했다. `responseModalities: [Modality.IMAGE]`
로 고정했기 때문에 애초에 모델이 마크업을 반환할 수 없는 구조다 — 렌더러를
"안 쓰기로 한" 것이 아니라, 애초에 렌더러가 낄 자리 자체가 없다.

### 5. 실패 처리 — 재시도 가능성 보존

Gemini 호출이 실패(정책 거부·오류)하면 예외를 던지지 않고
`Level1Generation` 레코드를 `status: FAILED`로 저장하고 `errorMessage`에
원인을 담아 **정상 응답(HTTP 201)으로 돌려준다.** 업로드된 원본 asset과
생성 시도 이력은 그대로 남고, 같은 productId로 `POST
/level1/products/:id/generate`를 다시 부르면 재시도된다(Web UI의
"다시 시도"/"다시 생성" 버튼).

## 기술 조사 — Gemini 단일 호출 이미지 입력+출력이 실제로 되는가

**된다. 추측이 아니라 이번 작업에서 실제로 실행해 확인했다.**

- SDK: `@google/genai@2.13.0` (`apps/api/package.json`)
- 모델: `gemini-2.5-flash-image` — 이미 `image-edit-provider.factory.ts`가
  `GEMINI_IMAGE_MODEL` 환경변수로 다른 모델을 지정할 수 있게 해 둔 것과
  같은 기본값을 그대로 썼다. **모델명을 새로 추측해 만들지 않았다.**
- 실측: 로컬 Benchmark 사진(분사기 본체·스텐호스·포장지 앞면) 3장을
  실제로 업로드하고 `POST /level1/products/:id/generate`를 1회 호출 —
  15.6초 만에 `status: SUCCEEDED`, 실제 이미지(1184×864 PNG, 1.47MB)가
  MinIO에 저장되고 DB에 기록됐다. 생성된 이미지에 원본과 같은 검정
  트리거 분사기 + 은색 코일형 스테인리스 호스가 그대로 나타났다(제품
  형태·색상·구성 유지 확인 — 브라우저에서 사람이 다시 확인해야 한다).
  다만 이미지 안에 렌더링된 한글 캡션 일부(예: "펀리한 물 뷰사")에
  글자가 깨지는 현상이 관측됐다 — MASTER_GUIDE §7의 품질 순위 2번
  ("글자가 잘못 박히지 않았나")에 해당하는 항목으로, 사람이 판단할
  부분이다.
- **단일 호출 불가 케이스는 발생하지 않았다** — 작업 지시 7번("단일
  호출 불가 시 정확히 기록")이 요구한 대안 기록은 필요 없다.

## 건드리지 않은 것 (T1-188과의 동시 작업 — `docs/PROJECT_MEMORY.md` M-28)

이 작업이 시작된 시점 T1-188이 같은 워크트리에서 Level1 기반을 만들고
있었다(작업 시작 시 `IN_PROGRESS`, 완료 시점까지 계속 진행 중이었음).
충돌을 피하기 위해 아래 파일은 **전혀 수정하지 않았다**:

- `apps/api/src/level1/*`(controller·service·module) — 새로 만든
  `apps/api/src/level1-generate/*`가 같은 테이블을 Prisma로 직접
  읽기만 한다.
- `apps/web/app/level1/*` — 새 화면은 `apps/web/app/level1-generate/*`에
  완전히 독립적으로 만들었다(그 폴더의 `level1-client.ts`도 재사용하지
  않고 자체 client를 새로 만들었다 — 실행 중 변경 위험을 아예 없앴다).
- `packages/core/src/*`, `packages/shared/src/*` — DTO 타입을
  API·Web 양쪽에 각각 로컬로 정의했다(공유 패키지에 새 타입을 추가하지
  않음).
- `apps/api/src/level1/level1.controller.ts`가 이미 등록한
  `Level1Product` Prisma 모델은 그대로 두고, `Level1Generation`은
  Prisma 레벨 relation을 선언하지 않았다(back-reference 필드 추가가
  필요해지는 것을 피함) — DB 외래키 제약만 migration.sql에서 직접
  걸었다.

`apps/api/prisma/schema.prisma`·`apps/api/src/app.module.ts`는 맨 끝/한
줄만 추가하는 방식으로 최소 침습으로 수정했다(각 편집 직전 실시간으로
다시 읽어 T1-188이 그 사이 같은 지점을 바꾸지 않았는지 확인).

## 남은 것 — 사람이 판단해야 하는 것

- 생성된 이미지가 실제로 원본 제품과 같은 제품인지 (형태·구성품·색상·재질)
- 생성 이미지 안의 한글 텍스트가 정상적으로 렌더링되는지(위 실측에서
  일부 깨짐 관측)
- 디자인/레이아웃 품질 자체
