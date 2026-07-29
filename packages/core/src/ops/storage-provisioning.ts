/**
 * 저장소 프로비저닝 경계. (TASK-2201, Sprint 22 — CTO 결정 2101-④)
 *
 * **운영에서 버킷과 IAM은 운영 담당자가 준비한다. 애플리케이션은 환경변수만
 * 쓴다.**
 *
 * 지금까지 개발 편의로 애플리케이션이 버킷을 만들고 공개 읽기 정책을 걸어
 * 왔다. 개발에서는 편하지만 **운영에서는 위험하다**:
 *
 * - 오타 하나로 엉뚱한 이름의 버킷이 조용히 생긴다. 그 버킷은 백업 대상도,
 *   보호 정책 대상도 아니다 — 아무도 모르는 채로 데이터가 쌓인다.
 * - 애플리케이션이 정책을 덮어쓰면, 운영자가 콘솔에서 조인 권한이 다음
 *   재기동에 풀린다.
 * - 무엇보다, **누가 무엇을 책임지는지가 흐려진다.**
 *
 * 그래서 운영에서는 **만들지 않고, 없으면 그 사실을 말한다.**
 */

export type ProvisioningMode = "managed" | "external";

export interface ProvisioningPolicy {
  mode: ProvisioningMode;
  /** 버킷을 만들어도 되는가 */
  mayCreateBucket: boolean;
  /** 버킷 정책을 걸어도 되는가 */
  maySetPolicy: boolean;
  detail: string;
}

/**
 * 환경에 따른 프로비저닝 정책.
 *
 * 운영은 `external` — 애플리케이션은 **읽고 쓰기만** 한다.
 * 그 외는 `managed` — 개발자가 버킷을 손으로 만들게 하지 않는다.
 */
export function resolveProvisioningPolicy(
  env: Record<string, string | undefined>,
): ProvisioningPolicy {
  const production = (env.NODE_ENV ?? "").trim().toLowerCase() === "production";

  if (production) {
    return {
      mode: "external",
      mayCreateBucket: false,
      maySetPolicy: false,
      detail:
        "운영에서는 버킷과 접근 권한을 운영 담당자가 준비합니다 — 애플리케이션은 " +
        "환경변수로 받은 버킷을 읽고 쓰기만 하며, 만들거나 정책을 바꾸지 " +
        "않습니다 (CTO 결정 2101-④).",
    };
  }

  return {
    mode: "managed",
    mayCreateBucket: true,
    maySetPolicy: true,
    detail:
      "개발에서는 애플리케이션이 버킷을 만들고 공개 읽기 정책을 겁니다 — " +
      "개발자가 손으로 준비하게 하지 않습니다. 운영에서는 하지 않습니다.",
  };
}

/**
 * 운영에서 버킷이 없을 때의 안내.
 *
 * "버킷을 찾을 수 없습니다"로 끝내면 운영자는 애플리케이션이 만들어 주기를
 * 기다린다. **누가 무엇을 해야 하는지**까지 적는다.
 */
export function describeMissingBucket(
  bucket: string,
  policy: ProvisioningPolicy,
): string {
  if (policy.mode === "managed") {
    return `버킷을 찾을 수 없습니다: ${bucket}`;
  }
  return (
    `버킷을 찾을 수 없습니다: ${bucket} — 운영에서는 애플리케이션이 버킷을 ` +
    "만들지 않습니다. 운영 담당자가 버킷을 만들고 접근 권한을 부여한 뒤 " +
    "환경변수를 확인하세요 (docs/operations/s3-migration.md)."
  );
}
