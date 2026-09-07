import { MANDATORY_PAGE_ROLES, MAX_PAGES, MIN_PAGES, OPTIONAL_PAGE_ROLE, type PagePlanItem } from "./multi-page-types";

/**
 * 분석 호출(Call A) 프롬프트 — 업로드된 사진 전체를 한 번의 멀티모달
 * 요청으로 보고, ① 각 사진의 역할(실제 제품 사진인지 포장/라벨/사양표/
 * 설명서/바코드인지) ② 검증된 제품 정보 ③ 상세페이지를 몇 장으로,
 * 어떤 역할로 나눌지를 JSON 하나로 받는다. 이 호출은 이미지를 생성하지
 * 않는다 — 텍스트(JSON)만 반환한다(`gemini-analysis.client.ts`,
 * `responseMimeType: "application/json"`).
 */
export function buildAnalysisPrompt(assetCount: number): string {
  return [
    "당신은 이커머스 상세페이지를 기획하는 제품 분석가입니다. 아래 제품 사진을 보고 분석 결과를 JSON으로만 답하세요.",
    "",
    `[입력] 이미지 ${assetCount}장이 순서대로 주어집니다. 인덱스는 0부터 시작합니다.`,
    "",
    "[해야 할 일]",
    "1. 각 이미지를 다음 중 하나로 분류하세요: ACTUAL_PRODUCT(실제 제품이 뚜렷이 보이는 사진), PACKAGING(포장 상자), LABEL(라벨/스티커), SPEC(사양표), BARCODE(바코드), MANUAL(설명서), LIFESTYLE(사용 장면), UNKNOWN(판단 불가).",
    "2. 사진에서 실제로 확인되는 사실만으로 제품 정보를 채우세요: 제품명, 브랜드, 모델명, 제조사, 제조국/원산지, 소재(배열), 규격/크기, 구성품(배열), 주요 사양(키-값), 주의사항(배열).",
    "   - 사진에 없거나 읽을 수 없는 값은 반드시 null(문자열 항목) 또는 빈 배열/빈 객체로 남기세요. 절대 추측하거나 지어내지 마세요.",
    "   - [언어 규칙] name·materials·includedComponents·specs(키/값)·cautions·manufacturer·originCountry는 반드시 자연스러운 한국어로 쓰세요 — 포장지 원문이 영어여도 그대로 베끼지 말고 한국어 쇼핑몰 표기로 바꾸세요(예: \"Stainless steel\" → \"스테인리스 스틸\"). 단, brand(브랜드명)와 model(모델명), 그리고 name 안에 포함된 고유 브랜드명·제품 고유명은 원문 표기(로마자·숫자·기호)를 그대로 정확히 유지하고 임의로 번역하거나 바꾸지 마세요. 규격/치수의 숫자·단위(예: 3M, 1.5L)는 원문 그대로 씁니다.",
    "3. 이 제품을 소개하는 완결된 상세페이지가 되도록 상세페이지 구성을 결정하세요.",
    `   - pageRole은 반드시 다음 중 하나를 정확히 그대로(대문자) 쓰세요: ${MANDATORY_PAGE_ROLES.join(", ")}, ${OPTIONAL_PAGE_ROLE}. 다른 값을 만들어내지 마세요.`,
    `   - ${MANDATORY_PAGE_ROLES.join(", ")}는 각각 최소 1페이지씩 반드시 포함해야 합니다(순서: HERO → FEATURES → USE → COMPONENTS). ${OPTIONAL_PAGE_ROLE}은 제품 특성상 필요할 때만 선택적으로 추가하세요.`,
    "   - 역할별 의미: HERO=대표 이미지(제품 전체 + 핵심 가치), FEATURES=핵심 특징을 보여주는 디테일 샷(제품 특성에 따라 여러 장 반복 가능), USE=실제 사용/구성 장면, COMPONENTS=구성품을 펼쳐 보여주는 장면, GALLERY=추가로 필요한 갤러리/디테일 샷.",
    `   - 전체 페이지 수는 ${MIN_PAGES}~${MAX_PAGES}장 사이에서 정하세요. 필수 4종 외 남는 자리는 FEATURES를 여러 장으로 나누거나 GALLERY를 추가해 채우세요.`,
    "   - 각 페이지에 제목(title)과, 그 페이지에 어떤 장면·구도·강조점을 담을지 설명하는 designBrief를 정하세요. title은 반드시 자연스러운 한국어로 쓰세요(브랜드명·모델명 등 고유명은 원문 유지).",
    "   - designBrief는 다음 이미지 생성 단계에 그대로 전달되는 지시문입니다 — 구체적으로 쓰세요(예: 어떤 각도, 어떤 사용 장면, 어떤 디테일을 보여줄지). 제품명·스펙·문구 같은 텍스트를 이미지에 그리라는 지시는 절대 포함하지 마세요.",
    "   - 각 페이지에 sectionDescription(한국어 1~2문장)도 함께 정하세요 — 이 섹션이 무엇을 보여주는지 화면에 텍스트로 표시됩니다(이미지 안에 글자를 그리는 것과 다릅니다). 반드시 이 사진들에서 실제로 확인되는 사실과 위 verifiedProductFacts에 근거해서만 쓰고, 사진에 없는 기능·성능·수치·효과를 만들어내지 마세요.",
    "   - pageIndex는 1부터 시작하는 표시 순서이며, 위 역할 순서(HERO → FEATURES → USE → COMPONENTS → GALLERY)를 그대로 따라야 합니다.",
    "",
    "[반드시 지켜야 할 것]",
    "- 실제 제품 사진(ACTUAL_PRODUCT)이 하나도 없다고 판단되면 그렇게 정직하게 답하세요 — 포장 사진을 실제 제품으로 잘못 분류하지 마세요.",
    "- 확인되지 않은 제품 정보를 그럴듯하게 채우지 마세요. 모르면 null입니다.",
    "",
    "[출력 형식 — 아래 JSON 스키마를 정확히 따르세요. 다른 텍스트를 섞지 마세요]",
    JSON.stringify(
      {
        verifiedProductFacts: {
          name: "string | null",
          brand: "string | null",
          model: "string | null",
          manufacturer: "string | null",
          originCountry: "string | null",
          materials: ["string"],
          dimensions: "string | null",
          includedComponents: ["string"],
          specs: { "스펙 이름": "값" },
          cautions: ["string"],
        },
        assetRoles: [{ assetIndex: 0, role: "ACTUAL_PRODUCT" }],
        pagePlan: [
          {
            pageIndex: 1,
            pageRole: "HERO",
            title: "string",
            designBrief: "string",
            sectionDescription: "string (한국어 1~2문장, 사진과 verifiedProductFacts에만 근거)",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
}

const PAGE_IDENTITY_RULES = [
  "[반드시 지켜야 할 제품 동일성 규칙 — 이미지 품질보다 항상 우선]",
  "- 첨부된 '실제 제품 사진' 속 제품의 형태·구조·구성품 개수·색상·재질·크기 비율을 절대 바꾸지 마세요.",
  "- 구성품을 추가하거나 삭제하지 마세요. 사진에 없는 제품·구성품을 새로 만들지 마세요.",
  "- 바꿔도 되는 것은 배경·조명·촬영 구도·분위기·연출뿐입니다.",
  "- 결과가 실제 제품과 다른 제품처럼 보이면 안 됩니다. 예쁜 이미지보다 제품 동일성이 항상 우선입니다.",
  "",
  "[텍스트 렌더링 금지 — 한글 글자 깨짐 방지]",
  "- 이 이미지 안에 제품명·문구·숫자·라벨 등 어떤 글자도 그려 넣지 마세요. 텍스트가 없는 순수한 사진/그래픽만 생성하세요.",
  "- 제품 정보는 이 이미지가 아니라 화면의 별도 텍스트 영역에 정확하게 표시됩니다.",
  "",
  "[톤 — 실제 판매용 상세페이지에 쓰이는 상업 사진]",
  "- 절제된 스튜디오/자연광 상업 사진처럼 자연스럽고 고급스럽게 표현하세요. 네온·과도한 그라디언트·판타지풍 합성·화려한 이펙트는 쓰지 마세요.",
].join("\n");

/**
 * 페이지 이미지 생성 호출(Call B) 프롬프트 — 분석 단계(Call A)가 정한
 * designBrief를 그대로 반영해 이 한 장의 섹션 이미지만 생성한다.
 * `referenceImages`는 항상 ACTUAL_PRODUCT로 분류된 사진만 전달된다
 * (packaging/label/spec/manual/barcode 제외, `level1-multi.service.ts`).
 */
export function buildPageImagePrompt(page: PagePlanItem, totalPages: number): string {
  return [
    "당신은 이커머스 상세페이지 디자이너입니다. 아래 지시에 따라 상세페이지의 한 섹션 이미지 1장만 생성하세요.",
    "",
    `[이 페이지] ${page.pageIndex}/${totalPages}번째 페이지 · 역할: ${page.pageRole} · 제목: ${page.title}`,
    `[이 페이지에 담을 내용] ${page.designBrief}`,
    "",
    "[참고 이미지] 첨부된 모든 이미지는 실제 제품 사진입니다. 이 제품을 기반으로 위 내용을 표현하는 이미지를 생성하세요.",
    "",
    PAGE_IDENTITY_RULES,
    "",
    "[출력] 이 섹션의 완성된 이미지 1장만 출력하세요. HTML이나 코드가 아니라 이미지 자체를 생성하세요.",
  ].join("\n");
}
