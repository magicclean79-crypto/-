/**
 * 상세페이지 전용 인라인 SVG 아이콘 라이브러리. (T1-112)
 *
 * 원래 `product-page-html.ts`(Template V1) 안에 모듈 비공개 상수로만
 * 있었다 — Product Story 렌더러(`product-story-html.ts`)가 아이콘을 전혀
 * 쓰지 않아 "글꼴/아이콘을 적극 활용하지 못한다"는 지적의 원인 중 하나였다.
 * 이 파일은 그 아이콘 세트를 두 렌더러가 공유하도록 뺀 것뿐이다 —
 * **새 아이콘 세트를 만들지 않는다.** 이미 검증된 것(외부 CDN·아이콘 폰트
 * 의존 없이 오프라인에서도 그대로 보이는 자체 포함 SVG)을 그대로 재사용한다
 * (요청 사양 "가능하면 기존 icon library를 활용").
 *
 * 각 아이콘은 **장식이 아니라 의미**를 나타낸다 — 어떤 레이아웃에 어떤
 * 아이콘을 붙일지는 `product-story-design.ts`의 `LAYOUT_VISUAL_TOKENS`가
 * 결정하고, 근거 없는 인증·성능·수치를 암시하는 아이콘(예: 별점·순위
 * 배지)은 이 세트에 없다 — 그런 아이콘이 필요할 만큼의 근거를 이 파이프라인
 * 이 갖고 있지 않기 때문이다.
 *
 * T1-166이 한때 모든 아이콘을 stroke-width 2로 통일했으나(`check`=3,
 * `arrow`=2.5였던 것을 2로), T1-169가 T1-165 baseline 정확 재현 요청에
 * 따라 이 통일을 되돌렸다 — T1-165 시점에는 이 통일이 아직 없었다(T1-129
 * 백업 아카이브의 2026-08-13 파일에 `check` stroke-width=3으로 실측 확인,
 * `arrow`=2.5는 T1-166 자신의 작업 기록에 근거).
 *
 * T1-171이 FEATURE supporting facts용으로 `sliders`·`ruler`·`droplet` 3개를
 * 추가했으나, T1-175가 그 FEATURE metadata row 자체를 T1-165 baseline(단순
 * outline pill/card)으로 되돌리며 이 3개도 함께 제거했다 — 쓰는 곳이 없는
 * 아이콘을 남겨 두지 않는다.
 */

export const ICONS = {
  check:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"></polyline></svg>',
  spec:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="14" y2="17"></line></svg>',
  box: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 8l9-5 9 5-9 5-9-5z"></path><path d="M3 8v9l9 5 9-5V8"></path><line x1="12" y1="13" x2="12" y2="22"></line></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16"></line><circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none"></circle></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"></path><line x1="12" y1="10" x2="12" y2="14"></line><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"></circle></svg>',
  gallery:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none"></circle><path d="M21 16l-5.5-5.5-4 4-3-3-5.5 5.5"></path></svg>',
  /** 사용 순서/절차 — 걸음(단계) 표현. step-by-step 레이아웃 전용(T1-112 신규) */
  steps:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2.2"></circle><circle cx="12" cy="12" r="2.2"></circle><circle cx="18" cy="6" r="2.2"></circle><path d="M8 16.5 10 14M14 10 16 8"></path></svg>',
  /**
   * 화살표 affordance — 장식이 아니라 "이 카드/행에 더 볼 것이 있다"는
   * 구조적 신호(레퍼런스 시안의 premium feature row, T1-162). 다른
   * 아이콘처럼 레이아웃 의미를 나타내지 않으므로 `LAYOUT_VISUAL_TOKENS`가
   * 아니라 `heroFeatureRow`(product-story-html.ts)가 고정 접미사로 쓴다.
   */
  arrow:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>',
} as const;

export type StoryIconId = keyof typeof ICONS | "none";

export function iconMarkup(icon: StoryIconId): string {
  return icon === "none" ? "" : ICONS[icon];
}
