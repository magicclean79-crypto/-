# TASKS — 현재 Sprint 작업 목록

> **이 문서는 현재 Sprint의 작업 목록만 기록합니다.**
>
> 전체 상태·진행률·결정사항은 [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md),
> 철학과 원칙은 [`docs/MASTER_GUIDE.md`](docs/MASTER_GUIDE.md)에 있습니다.
>
> 새 기능을 임의로 추가하지 않습니다. 스펙이 없으면 "제안"에만 둡니다.

**마지막 업데이트: 2026-08-09**

---

## 현재 Sprint — Sprint 1 (2026-08-09 재정의)

**제품 인식 엔진 (Product Recognition Engine)**

Sprint 1은 **GPT → Gemini 연결이 아니다.** 제품 인식 엔진을 완성하는 것이다.

```
① 사진 분석  ② OCR  ③ Vision  ④ 이미지 자동 분류  ⑤ 바코드 인식
⑥ 모델명 추출  ⑦ 필요 시 공식 웹 조사  ⑧ 교차 검증
⑨ Product Profile 생성  ⑩ Product Package 생성
```

> **Gemini 품질을 높이는 Sprint가 아니라, Gemini가 추측하지 않아도 되는
> 수준의 Product Package를 만드는 Sprint다.**

**완료 조건**: Gemini가 실제 제품과 동일한 제품을 생성할 수 있을 정도로
제품 인식 엔진이 완성되는 것.

**정보 출처 우선순위** — 자세한 것은
[`docs/MASTER_GUIDE.md`](docs/MASTER_GUIDE.md) §4

```
실제 제품 사진 > OCR > Vision > 바코드 > 모델명
              > 공식 제조사 홈페이지 > 공식 카탈로그 > 기타 검색
```

**쇼핑몰 정보는 공식 정보가 아니다.** 웹 조사는 필요할 때만 하고, 할 때는
공식 정보만 쓴다.

---

## 10개 구성요소 현황

| | 구성요소 | 상태 |
| --- | --- | --- |
| ① | 사진 분석 | ✅ Vision 분석 동작 |
| ② | OCR | ✅ 동작 (987자 실측) — **자동 실행은 아님, T1-21** |
| ③ | Vision | ✅ 동작 |
| ④ | 이미지 자동 분류 | ✅ DESIGN/INFO 동작 · Gemini 입력 분리 완료 |
| ⑤ | 바코드 인식 | ✅ 동작 (T1-21, GTIN 체크디짓 검증 포함) |
| ⑥ | 모델명 추출 | ✅ 동작 (T1-21, 라벨 우선·전형적 품번 형태 인정) |
| ⑦ | 공식 웹 조사 | ✅ 동작 (T1-22, 제품이 식별된 경우에만·공식 출처만·GPT 기억 미사용) |
| ⑧ | 교차 검증 | ✅ 동작 (T1-23, OCR·GPT 분석 충돌 시 자동으로 채우지 않음) |
| ⑨ | Product Profile | ✅ 동작 |
| ⑩ | Product Package | ✅ 동작 (제품명·브랜드·재질·사용목적·스펙·OCR 전달) |

**10개 구성요소 모두 동작한다.** 다음은 이 결과들을 실제로 연결하는
T1-24~T1-26이다 — 지금 T1-22(웹 조사)와 T1-23(교차 검증)은 아직 서로
연결돼 있지 않다(교차 검증의 `officialInfo` 입력 자리에 T1-22 결과를
연결하는 일이 남아 있다).

---

## 구현 순서 (2026-08-09 확정)

**한 번에 여러 단계를 구현하지 않는다.**
각 단계마다 **구현 → 브라우저 검증 → 사람 승인 → 다음 단계** 순서를 지킨다.

---

## 완료 (진행 중 섹션에서 이동)

- [x] **T1-21 — 제품 자동 분석** (가장 먼저)

  **OCR만 먼저 구현하지 않는다.** 제품을 식별할 수 있는 모든 정보를
  **하나의 단계에서 동시에** 수집한다.

  - OCR
  - Vision
  - 바코드 인식
  - QR 인식
  - 모델명 추출
  - 브랜드 추출
  - 제품 특징 추출

- [x] **T1-22 — 제품 자동 조사**
  `packages/core/src/product-profile/product-research.ts` +
  `apps/api/src/product-research/`(신규 모듈).

  **제품이 식별된 경우에만**(`ProductIdentification.identified`) 수행한다
  — 식별 안 된 경우 계획 자체가 비어 있어 Provider를 아예 부르지 않는다.

  조사 우선순위(바코드 → 모델명 → 브랜드 → 공식 제조사 홈페이지 →
  공식 카탈로그)를 `planProductResearch`가 정하고, 상위 단계에서 공식
  출처를 찾으면 **그 자리에서 멈춘다**(비용 최소화).

  **공식 정보만 사용한다.** `classifyResearchSource`가 세 가지로만
  판정한다 — 쇼핑몰 목록(다나와·G마켓·11번가·쿠팡 등)이면 무조건 제외,
  포장지에서 OCR로 읽은 제조사 홈페이지와 같은 호스트면 공식, 공인
  바코드 조회 기관(코리안넷 등)이면 공식, 그 외(브랜드 이름이 그럴듯하게
  들어간 도메인 포함)는 전부 `unverified`로 버린다 — 버린 결과도
  근거와 함께 `excluded`에 남긴다(흔적을 지우지 않는다).

  **GPT의 기억을 사실처럼 쓰지 않는다.** 이 파일은 텍스트를 생성하지
  않는다 — 입력은 항상 어댑터가 실제 검색으로 받은 URL·스니펫이다(순수
  함수, DB·네트워크 접근 없음). 실제 검색은 `apps/api`의
  `WebResearchProvider` 포트가 맡는다: 기본은 `NoopWebResearchProvider`
  (비용 없음, `WEB_RESEARCH_PROVIDER` 미설정 시 기본값), 실제 조사가
  필요하면 `WEB_RESEARCH_PROVIDER=openai`로 `OpenAiWebSearchProvider`를
  켠다 — OpenAI Responses API의 `web_search` 도구를 써서 **모델이 실제로
  방문해 인용(url_citation)한 URL만** 결과로 인정하고, 인용 없는
  텍스트(모델의 "기억"일 수 있는 부분)는 버린다.

  `POST /product-research`(신규, DB 저장 없음)로 바로 확인할 수 있다.
  이번 세션에서는 실제 유료 API 호출은 하지 않았다(WEB_RESEARCH_PROVIDER
  기본값 none) — 사전 승인 없이 비용이 나가는 실행은 하지 않는다는 원칙
  때문이다. 켤지·언제 켤지는 사람 판단이 필요하다.

  **남은 일**: 이 결과를 교차 검증(T1-23)의 `officialInfo` 입력 자리에
  실제로 연결하는 것 — 그건 T1-24(Product Profile 생성)의 범위다.

---

## 미완료

- [x] **T1-23 — 교차 검증**
  `packages/core/src/product-profile/cross-verification.ts`. OCR 직접 추출
  (T1-21)과 GPT 분석(Vision+OCR 종합)을 항목별(브랜드·모델)로 비교한다.
  **값을 가진 출처가 하나면 그 값을 쓰고, 둘 이상인데 값이 다르면
  채우지 않는다**(`resolvedValue: null`, `status: "conflict"`) — 어느
  출처가 맞는지는 실제 제품 사진을 아는 사람만 판단할 수 있다.
  `buildProductPackage`의 브랜드·모델 필드가 이 결과를 쓰도록 바꿨다
  (이전에는 충돌해도 조용히 OCR 값으로 덮어썼다). 브라우저 화면에도
  "교차 검증 결과" 블록을 추가했다.

  **공식 제품 정보(웹 조사, T1-22)는 아직 구현되지 않았다** — 이 함수는
  `officialInfo` 입력 자리를 열어 두어 T1-22가 만들어지면 자동으로
  비교에 포함되도록 했을 뿐, 지금은 항상 비교에서 빠진다.
  T1-22가 별도 작업으로 남아 있다.

- [x] **T1-24 — Product Profile 생성**
  교차 검증이 끝난 정보만 사용한다.

  `packages/core/src/product-profile/product-profile-engine.ts` — STEP 4가
  답한 `profile`은 GPT 원본 그대로 보존하고(사실과 평가를 구분한다), STEP 4
  직후 OCR 직접 추출(T1-21)과 다시 교차 검증(T1-23)해 STEP 5(카피 생성·
  HTML 렌더링)에는 **검증된 brand/model만** 넘긴다 — 충돌이면 null이라
  HTML 스펙 표에 그 항목 자체가 나타나지 않는다. 실행 결과에
  `identification`·`crossVerification`을 추가해 어떤 값이 왜 그렇게
  됐는지 그대로 드러낸다.

  `apps/api/src/product-profile/product-profile.service.ts`의 `toDto()`가
  저장된 `ocrText`·`profile`로 `identification`·`crossVerification`을
  매 조회마다 다시 계산해 API 응답에 포함한다(둘 다 순수 함수라 항상 같은
  입력에 같은 결과 — 별도 DB 컬럼·마이그레이션 없이도 이전 실행 기록에
  그대로 적용된다). 브라우저(`apps/web/app/product-profile/
  product-profile-flow.tsx`)에 "교차 검증 결과" 카드를 추가해 사람이
  충돌 여부를 볼 수 있게 했다.

  **DB 마이그레이션을 시도하지 않은 이유**: 처음에는 이 두 값을 컬럼으로
  저장하려 했으나, 작업 중 C 드라이브 여유 공간이 0바이트가 되어
  `prisma migrate dev`가 shadow DB를 만들지 못해 실패했다(`PROJECT_MEMORY`
  M-15와 같은 종류의 문제). 읽을 때마다 다시 계산하는 방식으로 바꿔
  마이그레이션 자체가 필요 없게 설계를 바꿨다 — 디스크 문제를 우회한 것이
  아니라 그 자리에서 더 단순한 설계가 가능함을 확인한 것이다.

  **`buildProductPackage`(`product-package.ts`)는 건드리지 않았다** — 이
  세션 도중 그 파일이 다른 동시 진행 작업(Bridge 기준 T1-25로 보인다,
  `research` 필드가 추가되는 것을 실시간으로 목격했다)에 의해 계속
  수정되고 있어, 같은 파일을 함께 고치면 충돌 위험이 컸다. `profile`을
  가공하지 않고 그대로 두었기 때문에 `buildProductPackage`의 기존
  재계산 로직과도 충돌하지 않는다.

- [x] **T1-25 — Product Package 생성**
  Gemini가 제품을 추측하지 않아도 될 정도의 정확한 제품 정보를 만든다.

  `buildProductPackage()`(`packages/core/src/product-profile/
  product-package.ts`)가 T1-21(자동 분석)·T1-23(교차 검증)·T1-22(웹 조사)
  결과를 하나로 모은다 — 바코드·모델명·브랜드·원산지는 OCR에서 직접,
  브랜드·모델은 교차 검증을 거친 값만, 웹 조사 결과(`research`)는 원문
  그대로 보존하고 **brand/model 등 다른 필드에 자동으로 반영하지 않는다**
  (검색 스니펫에서 값을 뽑아내는 것 자체가 추측이라고 판단, M-21의 "비슷한
  제품" 오염 위험과 같은 이유). `ProductPackage` 타입(`packages/shared`)에
  `research` 필드 추가, `category-panel.tsx`에 "자동 조사 결과 (T1-22)"
  표시 블록 추가(찾은 것·버린 것·근거 URL을 사람이 본다).

  **이번 세션에서 새로 작성하지 않았다** — 코드는 이미 작업 트리에 완성돼
  있었다(T1-24 작업 메모 §3-4에 "동시 진행 중인 T1-25가 이 파일을 실시간
  수정하는 것을 목격했다"는 기록이 그 증거). Bridge 결과 파일
  (`bridge/results/T1-25.json`)에는 완료 보고(`RESULT_JSON`)가 이미
  들어 있었는데 `state`만 `IN_PROGRESS`에 멈춰 있었다 — `PROJECT_MEMORY`
  M-23과 같은 종류의 어긋남이다. 이번 세션은 코드를 직접 읽어 그 보고
  내용과 실제 코드가 일치함을 확인하고, build·typecheck·lint·test를
  다시 실행해 재검증만 했다.

  **검증(2026-08-09, 재검증)**: `pnpm turbo run build` 6/6,
  `pnpm turbo run typecheck` 10/10(오류 0), `npx eslint .` 0건,
  `@acos/core` 130/130 스위트·1884/1884 테스트, `web` e2e(Playwright)
  252/252 통과. `apps/api`는 1029/1037 통과 — 실패 8건은 전부
  `ops.spec.ts`이고 `git diff` 없음(미접촉)을 확인해 `PROJECT_MEMORY`
  M-10에 기록된 것과 같은 기존 문제임을 재확인했다.

  **남은 것**: 웹 조사 결과(`research`)를 Gemini 프롬프트 문장에 실제로
  포함할지는 이번 범위가 아니다 — 값을 해석해 반영하는 것 자체가 추측이
  될 수 있어, Gemini 전달 방식을 다루는 T1-26 이후 사람 판단이 필요하다.

- [ ] **T1-26 — Gemini 전달**
  Gemini에는 **① 실제 제품 참조 이미지 ② Product Package만** 전달한다.
  포장지·라벨·설명서·사양표·박스·인증서·바코드 이미지는 **절대 전달하지
  않는다.** 정보 추출에만 쓴다. (입력 분리는 이미 구현됨 — 이 단계에서
  최종 확인)

---

## 브라우저 검증 (모든 단계 공통)

각 단계의 결과를 브라우저에서 **모두** 확인할 수 있어야 한다.
**어떤 정보가 추가되었고 어떤 정보가 제외되었는지**를 사람이 직접 본다.

```
① 원본 사진          ② 제품 자동 분석 결과   ③ 자동 조사 결과
④ 교차 검증 결과      ⑤ Product Profile      ⑥ Product Package
⑦ Gemini에 전달된 이미지  ⑧ Gemini Prompt   ⑨ 생성 이미지
```

- [ ] **T1-11 — `benchmark/constants.ts` 로컬 ID 확정**
  현재 이 파일은 **원격 DB의 사진 ID**를 가리켜 로컬에서 열리지 않는다.
  확인용으로 잠시 로컬 ID로 바꿔 둔 **임시 상태**이며, 백업은
  `C:\Users\82104\AppData\Local\Temp\constants-backup.ts`.
  **사람 승인이 있어야 확정한다.**

- [ ] **T1-12 — 임시 상태 복구**
  로컬 Next.js 3000번 재시작 · 3100/4100 종료

- [ ] **T1-13 — 변경 사항 커밋**

- [ ] **T1-14 — Sprint 1 종료 선언** (사람 판단)

---

## 완료 — Sprint 1 (2026-08-08)

- [x] **T1-01 — Product Package 자료구조 정의**
  실데이터 5개(제품 프로필·OCR·제품명·특징·스펙)만 채우고, 2단계 예정
  5개(참고 URL·벤치마크·디자인 규칙·회사 정책·Learning History)는 인터페이스만
  두고 항상 빈 값. **없는 것을 지어내지 않는다.**

- [x] **T1-02 — 조립·문장 만들기 순수 함수**
  `packages/core/src/product-profile/product-package.ts`. DB·네트워크 접근 없음.

- [x] **T1-03 — 모든 Gemini 경로에 Product Package 적용**
  이전에는 후보 생성만 사용. 현재는 대표 썸네일·사용 장면·디테일·특징 강조 +
  배경 제거·배경 생성·합성까지 **문장 조립 함수 하나**만 사용.
  경로마다 프롬프트가 갈라지면 품질도 갈라진다.

- [x] **T1-04 — 글자 렌더링 금지 규칙**
  제품명·라벨 텍스트·스펙표를 이미지에 그리지 않도록 명시. **제품 정보가
  없어도 항상 붙인다** — 원본 사진에 이미 글자가 있기 때문.

- [x] **T1-05 — 참고 URL 연결**
  현재는 항상 비어 있으나 채워지면 자동 전달되도록 미리 연결.

- [x] **T1-06 — 브라우저 검증 화면 8개 항목**
  기존 4개(이미지·Prompt·Raw Response·Product Package)에
  Provider·Model·생성 시간·Category 추가.

- [x] **T1-07 — 로컬 Benchmark Dataset 구축**
  로컬 DB 마이그레이션 7개 적용(65개 전부 최신) · 베란다 호스 7장 업로드 ·
  **OCR 실행(987자)** · Product Profile 생성. 원격 DB 의존 제거.

- [x] **T1-08 — Product Package 정확도 개선**
  OCR을 실행하지 않아 제품 정보가 전부 추측값이었음을 확인하고 수정.
  제품명·브랜드·재질·규격이 추측에서 사실로 바뀜.

- [x] **T1-09 — 제품 동일성·한국인 모델 규칙 + 원본 사진 동봉**
  제품 동일성 8개 항목을 프롬프트 **맨 앞**에 배치.
  서양인 모델 금지·20~30대 한국인 기본 명시.
  Gemini에 배경 제거본 + **원본 사진 2장** 전송.

- [x] **T1-D1 — 개발환경 문서(SSOT) 작성**
  `docs/DEVELOPMENT_ENVIRONMENT.md`

- [x] **T1-D2 — 운영 헌법 작성**
  `docs/MASTER_GUIDE.md`

- [x] **T1-D3 — PROJECT BRAIN 구축**
  `docs/RECOVERY_GUIDE.md` · `docs/PROJECT_STATE.md` ·
  `docs/PROJECT_MEMORY.md` + `AGENTS.md` 갱신 + `TASKS.md` 재작성

---

## 다음 Sprint (착수 금지 — Sprint 1 완료 후)

**Sprint 2 — Claude → 상세페이지 생성 → 품질 개선**

**Sprint 1이 끝나기 전에는 시작하지 않습니다.** 앞 단계가 부실한 채로 쌓으면
나중에 어느 층이 문제인지 찾을 수 없습니다.

---

## 제안 (스펙 대기 — 구현하지 않음)

- [ ] Gemini에 벤치마크 7장 전부 전송 (현재는 2장) — 효과 미확인
- [ ] Gemini Raw Response가 항상 비어 있는 원인 확인
- [ ] `README.md`에 환경 문서 링크 추가 — 사람 승인 필요

---

## 이전 작업 이력

이 문서는 2026-08-08에 **현재 Sprint 기준으로 재작성**되었습니다.

그 전까지 이 파일에는 **다른 작업 줄기**(브랜치
`claude/ai-product-content-os-setup-jb5oai`의 Sprint 1~52 · 85개 TASK)의
이력이 있었고, 현재 Sprint 1과는 무관한 내용이었습니다.

**그 이력은 git에 그대로 보존되어 있습니다** — 커밋 `2442de0` 시점의
`TASKS.md`(265줄)에서 확인할 수 있습니다.
