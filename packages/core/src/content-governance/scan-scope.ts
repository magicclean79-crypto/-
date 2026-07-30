/**
 * 예약 스캔의 **비교 범위**. (TASK-2801, Sprint 28 — CTO 결정 2701-③④)
 *
 * TASK-2701의 예약 스캔은 전체 한 덩어리만 봤다. 전체 숫자 하나로는
 * **어디가 나빠졌는지 알 수 없다** — 프로젝트가 스무 개면 "위반 3건 늘었다"는
 * 경보를 받고 스무 곳을 다 열어 봐야 한다. 그래서 프로젝트별로도 돌린다
 * (결정 2701-③).
 *
 * 범위마다 **비교 기준선과 경보 키가 따로 있다**(결정 2701-④). 뭉치면
 * 두 가지가 깨진다:
 * - 한 프로젝트가 나아지고 다른 프로젝트가 나빠지면 총량은 그대로여서
 *   **아무 경보도 오지 않는다.**
 * - 경보 키가 같으면 프로젝트 A의 스캔이 프로젝트 B의 경보를 해소해 버린다.
 *
 * 범위 문자열이 곧 그 경계다: `all` 또는 `project:<id>`.
 */

/** 전체 범위 — 프로젝트별 결과를 합한 것과 같아야 한다 */
export const ALL_SCAN_SCOPE = "all";

const PROJECT_PREFIX = "project:";

export function projectScanScope(projectId: string): string {
  return `${PROJECT_PREFIX}${projectId}`;
}

/** 범위가 프로젝트를 가리키면 그 id — 전체 범위면 `null` */
export function scanScopeProjectId(scope: string): string | null {
  return scope.startsWith(PROJECT_PREFIX)
    ? scope.slice(PROJECT_PREFIX.length)
    : null;
}

/**
 * 사람이 읽는 범위 이름.
 *
 * 프로젝트 이름을 알면 이름을, 모르면 id를 쓴다 — **id를 이름처럼 보여 주지
 * 않는다.** 경보를 받은 사람이 `cmg...`만 보고 어느 프로젝트인지 알 수 없다면
 * 그 경보는 아직 조치로 이어지지 않는다.
 */
export function describeScanScope(
  scope: string,
  names: Record<string, string> = {},
): string {
  const projectId = scanScopeProjectId(scope);
  if (projectId === null) {
    return "전체";
  }
  const name = names[projectId];
  return name === undefined
    ? `프로젝트 ${projectId}`
    : `프로젝트 ${name} (${projectId})`;
}
