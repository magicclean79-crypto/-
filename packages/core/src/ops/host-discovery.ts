/**
 * 운영 트래픽 기반 호스트 관측. (TASK-4301, Sprint 43 — CTO 정책 4301-①)
 *
 * TASK-4201은 **설정값**에서 호스트를 모았습니다(`PUBLIC_BASE_URL`,
 * `S3_PUBLIC_URL`). 그것으로는 보이지 않는 것이 있습니다: **리버스 프록시
 * 뒤의 별칭 도메인**입니다. `acos.example`로 배포해 두고 앞단에
 * `old.acos.example`·`m.acos.example`을 붙여 두면, 우리 설정값에는 그 이름이
 * 한 번도 나오지 않습니다. 그런데 사용자는 그 주소로 들어오고, 검증 대상
 * 보호는 그 주소를 **모르는 주소로 통과**시킵니다.
 *
 * 그래서 실제 요청의 `Host` 헤더를 봅니다.
 *
 * ## 관측은 증거이지 허가가 아닙니다
 *
 * 이 파일이 절대 하지 않는 일은 4201에서 정한 것과 같습니다: **관측한
 * 호스트를 운영 목록에 자동으로 넣지 않습니다.** 이유가 4201보다 하나 더
 * 늘었습니다 — `Host` 헤더는 **요청하는 쪽이 적는 값**입니다. 누구든
 * `Host: acos.example`이라고 적어 보낼 수 있고, 그 값을 자동 등록하면
 * **바깥에서 우리 보호 목록에 글을 쓰는 것**이 됩니다.
 *
 * 그래서 관측은 "이 이름이 우리 쪽으로 들어왔다"는 사실만 말합니다. 그것이
 * 우리 운영 도메인인지는 사람이 답합니다.
 *
 * ## 셀 수 없으면 세지 않았다고 말합니다
 *
 * 서로 다른 호스트 이름은 요청하는 쪽이 무한히 만들 수 있습니다. 전부
 * 담으면 메모리가 늘고, 담다가 멈추면 **관측이 불완전한데 완전한 척**하게
 * 됩니다. 상한을 두되, 넘치면 **넘쳤다고 말합니다** — 넘친 상태에서
 * "목록에 없는 호스트 0개"는 사실이 아니라 우리가 더 안 본 것입니다.
 */

import type { ObservedHost } from "./host-verification";

/** 서로 다른 호스트를 이만큼까지만 담는다 — 넘으면 넘쳤다고 말한다 */
export const HOST_DISCOVERY_LIMIT = 50;

/** 이보다 오래된 관측은 "지금도 쓰인다"고 말하지 않는다 */
export const HOST_SIGHTING_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/** 관측된 호스트 한 줄 */
export interface HostSighting {
  host: string;
  /** 이 이름으로 들어온 요청 수 */
  requests: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

/**
 * `Host` 헤더를 호스트 이름으로 (순수 함수).
 *
 * 포트를 떼고 소문자로 맞춥니다. **호스트 이름일 수 없는 값은 버립니다** —
 * 다만 버린 것을 세는 것은 부르는 쪽의 몫입니다(아래 `judgeHostDiscovery`가
 * `rejected`로 받습니다). 조용히 버리면 이상한 요청이 들어오고 있다는
 * 사실까지 같이 사라집니다.
 */
export function normalizeHostHeader(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 253) {
    return null;
  }
  // IPv6 리터럴은 대괄호 안에 콜론이 들어간다 — 포트 제거보다 먼저 본다
  const bracket = /^\[([0-9a-f:]+)\](?::\d+)?$/.exec(trimmed);
  if (bracket !== null) {
    return `[${bracket[1]}]`;
  }
  const host = trimmed.split(":")[0];
  if (host.length === 0) {
    return null;
  }
  // 호스트 이름에 쓸 수 있는 글자만 — 여기서 걸리는 값은 헤더 주입 시도이거나
  // 잘못 만든 클라이언트다. 둘 다 우리 목록에 들어가면 안 된다.
  if (!/^[a-z0-9._-]+$/.test(host)) {
    return null;
  }
  return host;
}

export interface HostDiscoveryReport {
  /** 관측을 호스트 목록 검증에 넘길 형태로 */
  observed: ObservedHost[];
  sightings: HostSighting[];
  /** 서로 다른 호스트 수 */
  distinct: number;
  /**
   * 상한을 넘겨 더 담지 못했는가 — **`true`면 이 관측은 불완전합니다.**
   * "목록에 없는 호스트 0개"라고 말하면 안 되는 상태입니다.
   */
  overflowed: boolean;
  /** 호스트 이름이 아니어서 버린 요청 수 */
  rejected: number;
  /** 오래돼서 "지금도 쓰인다"고 말하지 않는 것 */
  stale: HostSighting[];
  detail: string;
}

/**
 * 관측을 정리한다 (순수 함수, CTO 정책 4301-①).
 *
 * 판정(운영 호스트인가)은 하지 않습니다 — 그것은 `verifyProductionHosts`의
 * 일이고, 여기서 또 판정하면 **같은 값을 두 곳에서 다르게 말하게 됩니다**
 * (TASK-4101 라이브 검증에서 실제로 겪은 결함입니다).
 */
export function judgeHostDiscovery(input: {
  sightings: HostSighting[];
  now: number;
  limit?: number;
  rejected?: number;
  staleAfterMs?: number;
}): HostDiscoveryReport {
  const limit = input.limit ?? HOST_DISCOVERY_LIMIT;
  const staleAfterMs = input.staleAfterMs ?? HOST_SIGHTING_STALE_MS;
  const rejected = input.rejected ?? 0;

  // 많이 들어온 것부터 — 상한에 걸려 잘릴 때 잘리는 쪽이 덜 중요하도록
  const ordered = [...input.sightings].sort(
    (a, b) => b.requests - a.requests || b.lastSeenAt - a.lastSeenAt,
  );
  const overflowed = ordered.length > limit;
  const kept = ordered.slice(0, limit);

  const fresh = kept.filter((row) => input.now - row.lastSeenAt <= staleAfterMs);
  const stale = kept.filter((row) => input.now - row.lastSeenAt > staleAfterMs);

  const observed: ObservedHost[] = fresh.map((row) => ({
    host: row.host,
    source: `운영 트래픽 ${row.requests}건`,
    // **설정값에서 본 것과 다르다** — 이 표시가 있어야 "설정에는 없는데
    // 실제로 들어오고 있다"를 구분해 말할 수 있다
    fromTraffic: true,
  }));

  const parts: string[] = [];
  if (kept.length === 0) {
    // **관측이 없는 것은 "별칭이 없다"가 아니다**
    parts.push(
      "운영 트래픽에서 관측한 호스트가 없습니다 — 별칭이 없다는 뜻이 아니라 " +
        "아직 요청을 못 봤다는 뜻입니다.",
    );
  } else {
    parts.push(
      `운영 트래픽에서 호스트 ${fresh.length}개를 봤습니다 ` +
        `(요청 ${fresh.reduce((sum, row) => sum + row.requests, 0)}건).`,
    );
  }
  if (overflowed) {
    parts.push(
      `서로 다른 호스트가 상한(${limit})을 넘어 더 담지 않았습니다 — ` +
        "이 관측은 불완전하고, 목록에 없는 호스트가 더 있을 수 있습니다. " +
        "요청하는 쪽이 Host 헤더를 마음대로 적을 수 있으므로 이 상한은 " +
        "지워지지 않습니다.",
    );
  }
  if (rejected > 0) {
    parts.push(
      `호스트 이름이 아닌 값 ${rejected}건은 버렸습니다 — 잘못 만든 ` +
        "클라이언트이거나 헤더 주입 시도입니다.",
    );
  }
  if (stale.length > 0) {
    parts.push(
      `${Math.round(staleAfterMs / 86_400_000)}일 넘게 안 들어온 호스트 ` +
        `${stale.length}개는 "지금도 쓰인다"고 세지 않았습니다.`,
    );
  }
  parts.push(
    "관측은 증거이지 허가가 아닙니다 — Host 헤더는 요청하는 쪽이 적는 " +
      "값이므로 이 목록을 운영 호스트로 자동 등록하지 않습니다.",
  );

  return {
    observed,
    sightings: kept,
    distinct: ordered.length,
    overflowed,
    rejected,
    stale,
    detail: parts.join(" "),
  };
}

/**
 * 관측을 모으는 저장통 (메모리).
 *
 * 어댑터가 요청마다 부르는 자리라 **여기서 I/O를 하지 않습니다.** 실제
 * 저장은 주기적으로 한 번에 합니다 — 요청마다 쓰면 트래픽이 곧 쓰기
 * 부하가 되고, 그러면 이 관측 기능이 장애의 원인이 됩니다.
 */
export class HostSightingBuffer {
  private readonly rows = new Map<string, HostSighting>();
  private rejectedCount = 0;

  constructor(private readonly limit: number = HOST_DISCOVERY_LIMIT) {}

  /** 요청 하나를 담는다 — 담았으면 true */
  observe(rawHost: unknown, now: number): boolean {
    const host = normalizeHostHeader(rawHost);
    if (host === null) {
      this.rejectedCount += 1;
      return false;
    }
    const existing = this.rows.get(host);
    if (existing !== undefined) {
      existing.requests += 1;
      existing.lastSeenAt = now;
      return true;
    }
    // **상한을 넘으면 새 이름을 받지 않습니다.** 오래된 것을 밀어내면
    // 요청하는 쪽이 새 이름을 계속 보내는 것만으로 진짜 관측을 지울 수
    // 있습니다.
    if (this.rows.size >= this.limit) {
      return false;
    }
    this.rows.set(host, {
      host,
      requests: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    return true;
  }

  /** 지금까지 모은 것을 꺼내고 비운다 */
  drain(): { sightings: HostSighting[]; rejected: number; full: boolean } {
    const sightings = [...this.rows.values()];
    const rejected = this.rejectedCount;
    const full = this.rows.size >= this.limit;
    this.rows.clear();
    this.rejectedCount = 0;
    return { sightings, rejected, full };
  }

  get size(): number {
    return this.rows.size;
  }

  /** 아직 꺼내지 않은, 버린 요청 수 */
  get rejected(): number {
    return this.rejectedCount;
  }
}

/**
 * 저장된 관측과 방금 모은 관측을 합친다 (순수 함수).
 *
 * 같은 호스트면 요청 수를 더하고, 처음 본 시각은 **이른 쪽**을, 마지막으로
 * 본 시각은 **늦은 쪽**을 남깁니다.
 */
export function mergeSightings(
  stored: HostSighting[],
  fresh: HostSighting[],
): HostSighting[] {
  const merged = new Map<string, HostSighting>();
  for (const row of [...stored, ...fresh]) {
    const existing = merged.get(row.host);
    if (existing === undefined) {
      merged.set(row.host, { ...row });
      continue;
    }
    existing.requests += row.requests;
    existing.firstSeenAt = Math.min(existing.firstSeenAt, row.firstSeenAt);
    existing.lastSeenAt = Math.max(existing.lastSeenAt, row.lastSeenAt);
  }
  return [...merged.values()];
}
