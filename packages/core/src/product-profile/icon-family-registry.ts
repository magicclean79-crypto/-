import { ICONS, type StoryIconId } from "./product-page-icons";
import type { IconFamilyId } from "./design-profile";

/**
 * Canonical SVG icon family registry. (T1-177)
 *
 * DESIGN_PROFILE.iconStyle.family(`design-profile.ts`)가 고를 수 있는 값은
 * 이 파일이 실제로 갖고 있는 5개 family뿐이다 — AI는 이 registry 밖의
 * 임의 SVG/path를 만들 수 없고(요청 사양 "AI가 arbitrary SVG를 생성하는
 * 구조는 허용하지 않는다"), 렌더러(`product-story-html.ts`)는 이 registry
 * 에서 고른 문자열의 stroke-width/size/linecap/linejoin 속성만 치환한다
 * (path data 자체는 절대 바꾸지 않는다, `design-profile.ts`의 `resolveDesignProfile`
 * 과 같은 "AI는 어휘를 고르고, 코드가 실제 값으로 바꾼다" 원칙).
 *
 * `technical-outline`은 기존 `product-page-icons.ts`의 ICONS를 그대로
 * 재사용한다(요청 사양 "실제 프로젝트 기존 icon asset/registry를 재사용할
 * 수 있으면 우선 재사용한다") — DESIGN_PROFILE이 없을 때(baseline)의
 * 렌더링이 T1-175 이전과 완전히 동일해야 하기 때문이기도 하다(회귀 없음).
 * 나머지 4개는 같은 의미(체크·사양·구성품·안내·경고·갤러리·순서)를 다른
 * shape 언어로 표현한 새 path다.
 */

type IconGlyphSet = Record<Exclude<StoryIconId, "none">, string>;

const TECHNICAL_OUTLINE: IconGlyphSet = { ...ICONS };

/** 원형 뱃지 안 얇은 라인 — 에디토리얼/미니멀 톤 */
const EDITORIAL_LINE: IconGlyphSet = {
  check:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><polyline points="8 12.5 11 15.5 16 9"></polyline></svg>',
  spec:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"></circle><line x1="7.5" y1="9.5" x2="16.5" y2="9.5"></line><line x1="7.5" y1="12.5" x2="16.5" y2="12.5"></line><line x1="7.5" y1="15.5" x2="13" y2="15.5"></line></svg>',
  box: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"></circle><path d="M8.5 9.5l3.5-2 3.5 2-3.5 2-3.5-2z"></path><path d="M8.5 9.5v4l3.5 2 3.5-2v-4"></path></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><line x1="12" y1="11" x2="12" y2="15.5"></line><circle cx="12" cy="8.2" r="0.8" fill="currentColor" stroke="none"></circle></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><circle cx="12" cy="12" r="6.5"></circle><line x1="12" y1="9.5" x2="12" y2="13"></line><circle cx="12" cy="15.3" r="0.8" fill="currentColor" stroke="none"></circle></svg>',
  gallery:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><circle cx="9.5" cy="9.5" r="2"></circle><circle cx="14.5" cy="9.5" r="2"></circle><path d="M8 16l3-3 2 2 3-4 2 5"></path></svg>',
  steps:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><circle cx="8.5" cy="15" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="15.5" cy="9" r="1.3" fill="currentColor" stroke="none"></circle></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><line x1="8" y1="12" x2="15" y2="12"></line><polyline points="12 8.5 15.5 12 12 15.5"></polyline></svg>',
};

/** 채워진(solid) 실루엣 — 대비가 강한 임팩트 톤. stroke 속성이 없어 strokeWidth/cornerStyle 오버라이드는 크기(size)에만 영향을 준다 */
const GEOMETRIC_SOLID: IconGlyphSet = {
  check:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M9.5 16.2 4.8 11.5l1.9-1.9 2.8 2.8 7.8-7.8 1.9 1.9z"></path></svg>',
  spec: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><rect x="4" y="5.5" width="16" height="2.6" rx="1.3"></rect><rect x="4" y="10.7" width="12" height="2.6" rx="1.3"></rect><rect x="4" y="15.9" width="8" height="2.6" rx="1.3"></rect></svg>',
  box: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9L12 2.5z"></path></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><circle cx="12" cy="7.2" r="2"></circle><rect x="10.1" y="10.8" width="3.8" height="9.4" rx="1.5"></rect></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M12 2.5 22.5 21H1.5L12 2.5z"></path></svg>',
  gallery:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" opacity="0.22"></path><circle cx="8.5" cy="9" r="1.8"></circle><path d="M4 18l5.5-6 3.5 3.5 3-3.5L21 18H4z"></path></svg>',
  steps:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><circle cx="5.5" cy="18" r="2"></circle><circle cx="12" cy="12" r="2.6"></circle><circle cx="18.5" cy="6" r="3.2"></circle></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><rect x="4" y="10.8" width="10" height="2.4" rx="1.2"></rect><path d="M13 6l7 6-7 6z"></path></svg>',
};

/** 둥근 사각/곡선 위주 — 패브릭·유아용품처럼 부드러운 질감의 제품 */
const SOFT_ROUNDED: IconGlyphSet = {
  check:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="6"></rect><polyline points="8 12.5 10.8 15.3 16 9.3"></polyline></svg>',
  spec:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="7.5" x2="19" y2="7.5"></line><line x1="5" y1="12" x2="19" y2="12"></line><line x1="5" y1="16.5" x2="14" y2="16.5"></line></svg>',
  box: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="8.5" width="17" height="12" rx="4"></rect><path d="M3.5 8.5 12 3.5l8.5 5"></path><line x1="12" y1="8.5" x2="12" y2="20.5"></line></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="7"></rect><line x1="12" y1="11" x2="12" y2="16"></line><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none"></circle></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 20.5 19.5h-17L12 4z"></path><line x1="12" y1="11" x2="12" y2="14.3"></line><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"></circle></svg>',
  gallery:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="5"></rect><circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none"></circle><path d="M5 17l4.5-4.5 3 3 4-4.5 3.5 6"></path></svg>',
  steps:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 17.5c2-1.5 2.5-4 4.5-4.5s2.5 2 4.5 1.5 2-4 4.5-5"></path><circle cx="5.5" cy="17.5" r="1.1" fill="currentColor" stroke="none"></circle><circle cx="18.5" cy="9.5" r="1.1" fill="currentColor" stroke="none"></circle></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="5.5" y1="12" x2="17" y2="12"></line><polyline points="12.5 6.5 18 12 12.5 17.5"></polyline></svg>',
};

/** 모눈/제도 도면 느낌 — 기술/스포츠/전자기기처럼 정밀함을 앞세우는 제품 */
const PRECISION_MONO: IconGlyphSet = {
  check:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><polyline points="4 13 9 18 20 5"></polyline><line x1="4" y1="4" x2="4" y2="6.5"></line><line x1="4" y1="4" x2="6.5" y2="4"></line></svg>',
  spec: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><line x1="4" y1="6" x2="4" y2="9"></line><line x1="4" y1="7.5" x2="20" y2="7.5"></line><line x1="4" y1="11" x2="4" y2="14"></line><line x1="4" y1="12.5" x2="20" y2="12.5"></line><line x1="4" y1="16" x2="4" y2="19"></line><line x1="4" y1="17.5" x2="14" y2="17.5"></line></svg>',
  box: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><rect x="5" y="5" width="14" height="14"></rect><line x1="2" y1="5" x2="5" y2="5"></line><line x1="5" y1="2" x2="5" y2="5"></line><line x1="19" y1="19" x2="22" y2="19"></line><line x1="19" y1="19" x2="19" y2="22"></line></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><rect x="4" y="4" width="16" height="16"></rect><line x1="12" y1="11" x2="12" y2="16"></line><rect x="11.3" y="7.3" width="1.4" height="1.4" fill="currentColor" stroke="none"></rect></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5z"></path><line x1="12" y1="8.5" x2="12" y2="13.5"></line><rect x="11.3" y="15.3" width="1.4" height="1.4" fill="currentColor" stroke="none"></rect></svg>',
  gallery:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><rect x="3.5" y="3.5" width="7.5" height="7.5"></rect><rect x="13" y="3.5" width="7.5" height="7.5"></rect><rect x="3.5" y="13" width="7.5" height="7.5"></rect><rect x="13" y="13" width="7.5" height="7.5"></rect></svg>',
  steps:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><polyline points="4 19 4 14 9.5 14 9.5 9.5 15 9.5 15 5 20 5"></polyline></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><line x1="4" y1="12" x2="16" y2="12"></line><polyline points="12 6 18 12 12 18"></polyline></svg>',
};

export const ICON_FAMILY_REGISTRY: Record<IconFamilyId, IconGlyphSet> = {
  "technical-outline": TECHNICAL_OUTLINE,
  "editorial-line": EDITORIAL_LINE,
  "geometric-solid": GEOMETRIC_SOLID,
  "soft-rounded": SOFT_ROUNDED,
  "precision-mono": PRECISION_MONO,
};

/** family + 아이콘 의미 → canonical SVG 문자열. registry 밖의 값은 이 함수를 통해 절대 나올 수 없다(타입 자체가 가드레일) */
export function familyIconMarkup(family: IconFamilyId, icon: Exclude<StoryIconId, "none">): string {
  return ICON_FAMILY_REGISTRY[family][icon];
}
