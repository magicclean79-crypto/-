/**
 * 업로드 단계 귀속 판정. (TASK-4501, CTO 정책 4501-②)
 *
 * 지금까지 이미지의 프로젝트는 **상품을 통해서만** 알 수 있었습니다
 * (이미지 → 상품 → 프로젝트). 그런데 업로드 직후의 이미지는 아직 상품에
 * 붙어 있지 않고, 그 상태로 돌린 OCR 호출의 비용은 `projectId = null`로
 * 기록됩니다. 나중에 상품을 붙여도 **그 기록은 바뀌지 않습니다** — 기록은
 * 실행 시점의 사실이기 때문입니다. 미귀속 비용의 상당수가 여기서 태어납니다.
 *
 * 그래서 소속을 받는 자리를 업로드로 옮깁니다. 다만 자리를 옮겼다고 해서
 * **없는 사실을 만들어 내지는 않습니다**:
 *
 * - 아무것도 모르면 `null`입니다. `null`은 "공용"이 아니라 "모른다"이고,
 *   모르는 비용을 아무 프로젝트에 배분하면 그 숫자는 만들어낸 것입니다.
 * - 두 곳이 다른 답을 주면 **그 사실을 지우지 않습니다**. 같은 사실에 두
 *   개의 답이 생기면 둘 다 못 믿게 되므로, 어느 쪽을 썼는지와 무엇이
 *   달랐는지를 함께 돌려줍니다.
 */

/** 이 귀속이 어디서 왔는가 */
export type ImageProjectSource =
  /** 이미지 → 상품 → 프로젝트 (기록에 이미 있던 연결) */
  | "product"
  /** 업로드한 사람이 밝힌 소속 */
  | "upload"
  /** 둘 다 있는데 서로 다르다 */
  | "conflict"
  /** 어느 쪽도 없다 */
  | "unknown";

export interface ImageProjectAttribution {
  projectId: string | null;
  source: ImageProjectSource;
  /** 화면·로그에 그대로 실리는 문장 (마크다운 강조를 쓰지 않는다) */
  detail: string;
}

/**
 * 이미지 하나의 프로젝트 귀속을 정한다.
 *
 * 우선순위는 **상품 연결이 먼저**입니다. 업로드 선언은 "그때 그렇게 적었다"는
 * 주장이고, 상품 연결은 "지금 실제로 붙어 있다"는 구조입니다. 주장과 구조가
 * 다르면 구조를 씁니다 — 다만 다르다는 사실은 감추지 않습니다.
 */
export function resolveImageProject(input: {
  /** 이미지 → 상품 → 프로젝트로 읽은 값 */
  productProjectId: string | null | undefined;
  /** 업로드 때 받아 이미지에 적어 둔 값 */
  imageProjectId: string | null | undefined;
}): ImageProjectAttribution {
  const fromProduct = normalize(input.productProjectId);
  const fromUpload = normalize(input.imageProjectId);

  if (fromProduct && fromUpload && fromProduct !== fromUpload) {
    return {
      projectId: fromProduct,
      source: "conflict",
      detail:
        `업로드 때 적힌 프로젝트(${fromUpload})와 지금 붙어 있는 상품의 ` +
        `프로젝트(${fromProduct})가 다릅니다. 실제 연결인 상품 쪽을 ` +
        "귀속에 씁니다 — 둘 중 하나는 옮겨졌거나 잘못 적힌 것이므로 확인이 필요합니다.",
    };
  }

  if (fromProduct) {
    return {
      projectId: fromProduct,
      source: "product",
      detail: "이미지가 붙은 상품의 프로젝트로 귀속했습니다.",
    };
  }

  if (fromUpload) {
    return {
      projectId: fromUpload,
      source: "upload",
      detail:
        "아직 상품에 붙지 않은 이미지입니다. 업로드 때 밝힌 프로젝트로 귀속했습니다.",
    };
  }

  return {
    projectId: null,
    source: "unknown",
    detail:
      "이 이미지는 상품에도 붙어 있지 않고 업로드 때 프로젝트도 밝히지 " +
      "않았습니다. 미귀속으로 남깁니다 — 모르는 비용을 아무 프로젝트에 " +
      "배분하면 그 숫자는 만들어낸 것입니다.",
  };
}

/**
 * 업로드가 받은 projectId를 받아들일 수 있는가.
 *
 * **없는 프로젝트 id를 조용히 버리지 않습니다.** 버리면 사용자는 소속을
 * 밝혔다고 믿는데 기록에는 미귀속으로 남고, 그 차이는 비용 보고를 볼 때까지
 * 아무도 모릅니다. 오타 하나가 몇 주 뒤에 "왜 미귀속이 늘었지"로 돌아옵니다.
 */
export type UploadProjectVerdict =
  /** 값이 없다 — 소속을 밝히지 않은 것은 잘못이 아니다 */
  | "absent"
  /** 존재하는 프로젝트다 */
  | "accepted"
  /** 모양이 id가 아니다 */
  | "malformed"
  /** 모양은 맞지만 그런 프로젝트가 없다 */
  | "unknown-project";

export interface UploadProjectCheck {
  verdict: UploadProjectVerdict;
  projectId: string | null;
  /** 거부라면 그대로 사용자에게 보여 줄 문장 */
  detail: string;
}

/**
 * @param known 존재하는 프로젝트 id 집합. 조회 자체가 이 함수 바깥에 있는
 *   이유는 여기가 순수 판정이기 때문입니다.
 */
export function checkUploadProject(
  raw: string | null | undefined,
  known: ReadonlySet<string>,
): UploadProjectCheck {
  const value = normalize(raw);
  if (!value) {
    return {
      verdict: "absent",
      projectId: null,
      detail: "프로젝트를 밝히지 않았습니다. 상품에 붙일 때 귀속됩니다.",
    };
  }

  // cuid 모양만 받는다 — 그 밖의 문자열은 사람이 실수로 이름을 적은 경우다
  if (!/^[a-z0-9_-]{8,64}$/i.test(value)) {
    return {
      verdict: "malformed",
      projectId: null,
      detail: `프로젝트 id 모양이 아닙니다: ${value}`,
    };
  }

  if (!known.has(value)) {
    return {
      verdict: "unknown-project",
      projectId: null,
      detail:
        `그런 프로젝트가 없습니다: ${value}. ` +
        "없는 소속으로 올려 두면 이 이미지의 비용은 영영 귀속되지 않습니다.",
    };
  }

  return {
    verdict: "accepted",
    projectId: value,
    detail: "업로드 단계에서 프로젝트를 확인했습니다.",
  };
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
