# 상세페이지 템플릿 자동 선택 · 타이포그래피 · 렌더 검증 설계 (T1-77)

> T1-77 목적: "상세페이지 제작 품질 기준 강화 및 매직크린 레퍼런스 학습".
> 이 문서는 (1) 매직크린 실제 사이트를 다시 확인해 얻은 새 사실, (2)
> 기존 조사 문서(`LIVING_GOODS_DESIGN_PRINCIPLES.md`·
> `MAGICCLEAN_BRAND_BASELINE.md`·`IKEA_PDP_REFERENCE_ANALYSIS.md`·
> `MARKET_DESIGN_PATTERN_REPORT.md`)를 그대로 다시 조사하지 않고 그
> 위에 쌓아 무엇을 구현했는지, (3) 구현 근거와 한계를 기록한다.
>
> **매직크린 사이트 문구·이미지·디자인을 복제하지 않았다.** 아래 색상
> 값·구조는 "이런 요소가 존재한다"는 관찰 기록이지, 그 값을 그대로
> 우리 템플릿 CSS에 박아 넣지 않았다 — 우리 템플릿은 이미 독자적인
> 색상 팔레트(블루/테라코타/레드-옐로/틸/무채색)를 쓰고 있고 이번에도
> 그대로 유지했다.

## 1. 매직크린 사이트 재확인 (2026-08-10) — 새로 확인한 사실

기존 `MAGICCLEAN_BRAND_BASELINE.md`(2026-08-07, Playwright 스크린샷 기반)는
`http://매직크린.com`을 조사 대상으로 삼았다. 이번 세션은 실제 도메인이
`magicclean791.godomall.com`(고도몰5 기반 B2B 위탁배송몰)임을 웹 검색으로
다시 확인하고, WebFetch로 홈페이지 마크업을 직접 읽어 아래를 **새로**
확인했다(기존 보고서는 "초안" 상태였고 수치가 없었다).

- **실제 브랜드 컬러 수치(hex)**: 네이비/블루 `#1E2C89`·`#3030F8`, 회색
  `#C5C5C6`·`#8C8C8C`, 브라운 `#8E562E`, 레드 `#E91818`, 오렌지
  `#F4AA24`, 그린 `#37B300`. 기존 보고서의 정성적 서술("브랜드 블루
  하나, 프로모션에만 화려한 색")과 일치한다 — 구조적 UI(버튼·헤더)는
  네이비 계열 1~2가지로 통일되고, 레드·오렌지·그린은 프로모션/배지에만
  쓰이는 패턴이 hex 값으로도 확인된다.
- **섹션 순서**: 헤더/로그인/장바구니 → 로고/검색 → 카테고리 메뉴 →
  프로모션 배너(슬라이더) → 공지 → 기획상품 → 신상품 → 인기상품 →
  추천상품 → 푸터(회사정보/정책/SNS). 기존 보고서의 "정보 밀도 높은
  도매상 분위기"와 일치.
- **카테고리 taxonomy(실측, 14개 대분류)**: 인조잔디·바닥매트·
  청소용품·생활용품·주방용품·캠핑용품·욕실용품·자동차/자전거용품·
  공업용품·홈데코·HTM·코텍·코멕스·니드코. 기존 보고서(5개 대분류)보다
  범위가 넓다 — 사이트가 그 사이 확장됐거나 기존 조사가 일부만
  캡처했을 가능성이 있다. **아래 템플릿 자동 선택 로직은 이 taxonomy를
  category enum으로 하드코딩하지 않았다** — Product Profile에는애초에
  category 필드가 없고(§2 참고), 카테고리명이 바뀌어도 깨지지 않게
  텍스트 키워드 기반으로 설계했다.
- 개별 상품 상세페이지(PDP) 크롤링은 검색 인덱스에 없어 이번에는
  접근하지 못했다 — 홈페이지 구조·taxonomy·색상 확인에 그쳤다.

## 2. 왜 "카테고리별" 템플릿 선택이 아니라 "제품 특성별" 선택인가

`packages/shared/src/index.ts`의 `ProductProfile` 인터페이스에는
`category` 필드가 없다(`productName, brand, model, material, features,
specifications, usage, advantages, warnings, keywords, confidence`만
있다) — OCR·Vision·GPT 통합 결과에 쇼핑몰 카테고리 분류가 아직 없다.
카테고리 enum을 새로 만들어 분류기를 얹는 대신, **이미 있는 텍스트
필드(제품명·특징·사용법·키워드·스펙)에서 특성을 읽어내는 규칙 기반
분류**를 택했다 — 근거 없는 새 필드를 만들지 않는다는 범위 원칙과,
`LIVING_GOODS_DESIGN_PRINCIPLES.md`(b) IF-THEN 표가 애초에 "카테고리"가
아니라 "제품 특성"(기능성/감성형·리뷰수·가격대·스펙 복잡도)을 조건으로
쓰고 있다는 점과도 맞는다.

## 3. 구현 — `product-page-template-selection.ts` (신규)

`classifyProductCharacter(profile)`가 세 갈래로 분류한다.

| 분류 | 판정 키워드(일부) | 근거 |
| --- | --- | --- |
| `functional-proof` | 청소·세척·제거·살균·방수·브러시·호스·분사 등 | 규칙4 — 기능성 제품은 사용 증거 사진이 필요 |
| `lifestyle-mood` | 인테리어·데코·무드·감성·슬리퍼·러그 등 | 규칙5 — 인테리어형은 소품 연출 무드컷 |
| `value-utility` | 위 키워드가 전혀 없을 때(기본값) | 근거 없이 스타일을 고르지 않는다(추측 금지) |

두 집합에 동시에 걸리면(예: "인테리어 감성 청소솔") **기능성을
우선**한다 — MASTER_GUIDE §2 철학1 "제품 동일성/증거가 연출보다
우선"과 같은 순서.

`selectProductPageTemplate(profile)`이 이 분류 + 효과 주장 여부(규칙11)
+ 스펙 개수(원리5)로 등록된 6개 템플릿(`PRODUCT_PAGE_TEMPLATES`,
`product-page-html.ts`) 중 하나를 고른다 — **새 템플릿을 만들지
않았다**, 기존 5개 생활용품 템플릿 + 기본형 중에서만 고른다.

```
효과 주장 있는 기능성 (청소/제거 등)     → living-d-proof  (규칙4·11)
효과 주장 없는 기능성                    → living-a-trust  (규칙13, 도매채널은 정량신호)
감성/라이프스타일                        → living-b-mood   (규칙5)
스펙 6개 초과(정보 밀도 높음)            → living-e-minimal(원리5, 아코디언)
근거 없음(기본값)                        → basic
```

Benchmark 제품(베란다용 스텐 호스 세트, "청소"·"물 분사" 키워드 보유)은
이 로직으로 `living-d-proof`를 받는다 — 유닛 테스트로 고정했다.

`rankPurchasePoints(profile, maxCount=4)`는 리뷰 수 같은 실제 신뢰
신호가 이 파이프라인에 없는 대신, **수치·단위가 포함된 구체적 문구**를
막연한 문구보다 앞에 두고 개수를 제한한다 — 새 문구를 만들지 않고
기존 `advantages`의 순서·개수만 조정한다.

## 4. 구현 — 타이포그래피 (`product-page-html.ts` 갱신)

`PDE_TYPOGRAPHY_CSS` 토큰 블록을 추가해 6개 템플릿이 공유한다.

| 토큰 | 값 | 근거 |
| --- | --- | --- |
| `--pde-fs-h1` / `--pde-fs-h2` / `--pde-fs-body` | 22px / 15px / 13px | 제목:본문 ≈ 1.7배 — 한 화면에서 정보 위계가 바로 구분되어야 함(원리6) |
| `--pde-lh-heading` / `--pde-lh-body` | 1.25 / 1.6 | 제목은 짧아 빽빽해도 되지만 여러 줄 본문은 한글 자소 밀도 때문에 더 넉넉해야 읽기 쉽다 |
| `--pde-ls-heading` | -0.01em | 큰 제목(20px+)은 살짝 좁혀 밀도 있게 |
| 스펙 값/헤드라인 | `font-variant-numeric: tabular-nums` | "3M"·"5mm"처럼 숫자+단위가 많은 제품 특성상 숫자 정렬이 흔들리지 않게(T1-77 요구사항7) |
| 설명/사용법 문단 | `max-width: 38ch` | 카드형 텍스트를 더 짧게 잘라 스캔하기 쉽게 |

기존 34개 `product-page-html.spec.ts` 테스트는 클래스명·텍스트
포함 여부만 검사해 이번 변경으로 전부 그대로 통과한다(수치 변경은
스냅샷 테스트가 아니므로 깨지지 않는다) — 재실행으로 확인.

## 5. 구현 — 렌더 검증 (`product-page-render-validation.ts`, 신규)

`validateProductPageViewModel(vm, profile, approvedImages)`가 LLM
호출 없이 3가지를 기계적으로 검사한다.

1. **근거 없는 인증/순위/최상급 표현** — 카피에 "1위"·"공식 인증"·
   "특허"·"최고급"·"임상 시험" 같은 패턴이 있는데 Product Profile
   어디에도 같은 단어가 없으면 `unverified-claim`. (T1-77 요구사항4의
   런타임 안전망 — 프롬프트 지시만으로는 LLM이 그래도 지어낼 수 있어
   이중 방어.)
2. **승인되지 않은 이미지 사용** — 렌더링에 쓰인 이미지(Hero·갤러리·
   특징 카드)가 원래 전달된 승인 이미지 목록 밖에서 왔으면
   `foreign-image`.
3. **빈 스펙 행** — 키/값이 비어 있는 스펙 행.

`ok: false`는 "실패"가 아니라 "사람이 특히 의심해서 봐야 할 지점"
표시다 — 최종 품질 판단은 여전히 사람이 한다(MASTER_GUIDE §2 철학3).

## 6. 아직 연결하지 않은 것 — 왜, 그리고 무엇이 남았는가

**`ProductProfileEngine`(STEP 5b, `product-profile-engine.ts`)에
`selectProductPageTemplate`를 아직 배선하지 않았다.** 이 세션이 작업을
시작한 시점부터 끝까지, **Bridge 작업 T1-75("상세페이지 생성 단계
전환 설계 및 구현")가 바로 이 파일과 `product-profile.service.ts`·
`product-profile.controller.ts`·`packages/shared/src/index.ts`를 같은
워크트리에서 동시에 실시간으로 수정하고 있었다**(`bridge-cli.mjs
status`로 계속 `IN_PROGRESS` 확인, 파일 수정 시각이 이 세션 진행
중에도 계속 바뀜 — `docs/PROJECT_MEMORY.md` M-28과 정확히 같은
상황). 이 파일을 지금 함께 고치면 두 세션의 결과가 서로를 덮어쓸 수
있다 — M-28의 선례(T1-24가 동시 수정 중인 `product-package.ts`를
피해 설계를 바꾼 것)를 그대로 따라, **겹치는 파일을 피하고 새 모듈로
분리**했다.

새 모듈(`product-page-template-selection.ts`·
`product-page-render-validation.ts`)은 `product-profile-engine.ts`
STEP 5b 딱 한 지점(`renderProductProfileHtml`을 부르기 직전,
`input.templateKey`가 없을 때 `selectProductPageTemplate(verifiedProfile)
.templateKey`를 기본값으로 쓰는 것)에 연결하면 된다 — T1-75가
`COMPLETED`(또는 다른 종결 상태)가 된 뒤, 그 파일의 최종 코드를 다시
읽고 한 줄만 추가하면 되는 구조로 미리 설계했다. 이 배선은 이번
작업(T1-77)의 남은 일로 아래 §7에 별도로 남긴다.

## 7. 다음 단계 (사람 확인 필요 항목과 별개)

1. T1-75가 끝나면 `product-profile-engine.ts`에
   `selectProductPageTemplate`/`validateProductPageViewModel` 연결.
2. 개별 상품 상세페이지(PDP) 크롤링 — 이번엔 홈페이지만 접근했다.
   매직크린 실제 PDP 구조(있다면)를 추가로 학습할 여지가 남아 있다.
3. 8개 카테고리 시장 조사 중 생활용품만 완료됐다(`LIVING_GOODS_DESIGN_
   PRINCIPLES.md` 계획대로 주방용품 등 후속 카테고리는 아직). 새
   카테고리 전용 템플릿을 늘리는 것은 이번 작업 범위를 넘는 결정이라
   진행하지 않았다.
