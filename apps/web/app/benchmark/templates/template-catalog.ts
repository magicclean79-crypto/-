/** 생활용품 Template A~E 메타데이터 (Sprint 36) — 실제 렌더링 로직은
 * packages/core/src/product-profile/product-page-html.ts의 동일한 key로
 * 등록되어 있다. 여기서는 브라우저에 보여줄 설명 텍스트만 정리한다. */
export interface TemplateCatalogEntry {
  key: string;
  name: string;
  description: string;
  traits: { label: string; value: string }[];
}

export const LIVING_GOODS_TEMPLATE_CATALOG: TemplateCatalogEntry[] = [
  {
    key: "living-a-trust",
    name: "A — 신뢰/근거형",
    description: "구매포인트 → 대표 썸네일 → 특징(증거 사진) → 스펙 체크리스트 순으로 근거를 쌓는 구성.",
    traits: [
      { label: "대표 썸네일", value: "사진 위 텍스트 오버레이" },
      { label: "색상", value: "블루 단일 액센트" },
      { label: "정보 순서", value: "구매포인트 먼저" },
      { label: "스펙", value: "체크포인트 박스" },
    ],
  },
  {
    key: "living-b-mood",
    name: "B — 감성/무드형",
    description: "오버레이 없는 풀블리드 무드 대표 썸네일 → 설명 먼저 → 구매포인트(아웃라인) 순.",
    traits: [
      { label: "대표 썸네일", value: "풀블리드, 텍스트 없음" },
      { label: "색상", value: "웜톤 테라코타" },
      { label: "폰트", value: "헤드라인 세리프" },
      { label: "정보 순서", value: "설명이 구매포인트보다 먼저" },
    ],
  },
  {
    key: "living-c-value",
    name: "C — 즉시구매/가격강조형",
    description: "구매포인트(가격 배지 스타일)를 대표 썸네일보다 먼저 배치, 특징은 2열 그리드로 촘촘하게.",
    traits: [
      { label: "대표 썸네일", value: "작고 컴팩트" },
      { label: "색상", value: "레드/옐로 (가격 강조)" },
      { label: "특징 카드", value: "2열 그리드, 작은 사진" },
      { label: "정보 순서", value: "가격 배지가 최상단" },
    ],
  },
  {
    key: "living-d-proof",
    name: "D — 기능증명형",
    description: "대표 썸네일·특징 카드 모두 대형 사진으로 기능이 실제로 작동한다는 증거를 강조.",
    traits: [
      { label: "대표 썸네일", value: "대형 액션샷" },
      { label: "색상", value: "그레이 + 틸 단일 액센트" },
      { label: "특징 카드", value: "큰 사진(증거형)" },
      { label: "주의사항", value: "굵은 빨간 테두리로 강조" },
    ],
  },
  {
    key: "living-e-minimal",
    name: "E — 미니멀 스칸디나비아형",
    description: "무채색 + 블루 단일 액센트, 넉넉한 여백, 스펙은 IKEA식 접이식 아코디언(기본 접힘).",
    traits: [
      { label: "색상", value: "거의 무채색 + 블루 하나" },
      { label: "여백", value: "가장 넉넉함" },
      { label: "스펙", value: "<details> 접이식 아코디언" },
      { label: "특징 카드", value: "배경 없이 구분선만" },
    ],
  },
];
