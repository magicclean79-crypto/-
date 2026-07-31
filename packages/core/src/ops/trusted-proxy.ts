/**
 * 신뢰하는 프록시와 전달 헤더. (TASK-4401, Sprint 44 — CTO 정책 4401-①)
 *
 * TASK-4301은 요청의 `Host`를 관측했습니다. 그런데 **리버스 프록시가 Host를
 * 바꿔 전달하는 구성**에서는 우리가 보는 `Host`가 내부 주소(`api.internal`,
 * `localhost:4000`)이고, 사용자가 실제로 친 도메인은 `X-Forwarded-Host`에
 * 들어 있습니다. 그 구성에서 4301의 관측은 **내부 이름만 잔뜩 모으고 정작
 * 운영 도메인은 하나도 못 봅니다.**
 *
 * 4301에서 `X-Forwarded-Host`를 보지 않기로 한 이유는 분명했습니다:
 * **앞단이 붙인 값과 클라이언트가 붙인 값을 구분할 수 없기 때문**입니다.
 * 누구든 그 헤더를 적어 보낼 수 있고, 그러면 관측이 "누가 적었는지 모르는
 * 이름"으로 채워집니다.
 *
 * ## 그래서 구분할 수 있을 때만 봅니다
 *
 * 구분하는 방법은 하나뿐입니다 — **누가 우리에게 직접 연결했는지**를 보는
 * 것입니다. 그 주소가 우리가 선언한 프록시라면 그 프록시가 붙인 헤더는
 * 믿을 수 있고, 아니라면 그 헤더는 **바깥에서 온 글**입니다.
 *
 * 그래서 이 파일의 규칙은 세 가지입니다:
 *
 * 1. **선언이 없으면 보지 않습니다.** `TRUSTED_PROXY_IPS`가 비어 있으면
 *    4301과 똑같이 동작합니다 — 기본값은 언제나 "안 믿는다"입니다.
 * 2. **신뢰하지 않는 상대가 보낸 전달 헤더는 버리되 셉니다.** 조용히
 *    버리면 "누군가 프록시인 척했다"는 사실까지 함께 사라집니다.
 * 3. **여러 값이 들어 있으면 추측하지 않습니다.** 프록시가 덧붙이는
 *    구성인지 덮어쓰는 구성인지 우리는 모르고, 그 상태에서 하나를 고르면
 *    **고른 이유가 없는 값**이 관측에 들어갑니다.
 *
 * ## IPv6 (TASK-4501, 정책 4501-①)
 *
 * TASK-4401은 IPv4만 받고 IPv6 선언은 버렸습니다 — 받는 척하고 못 맞추는
 * 것보다 못 받는다고 말하는 편이 낫다고 봤기 때문입니다. 그런데 그 상태는
 * **IPv6로 들어오는 프록시 뒤에서 이 보호가 통째로 꺼진 것**과 같습니다:
 * 선언을 아무리 적어도 맞지 않으니 전달 헤더를 영영 안 봅니다.
 *
 * 그래서 IPv6를 받습니다. 주소 비교는 **128비트 정수 하나로** 합니다 —
 * 문자열을 정규화해 비교하면 `::1`과 `0:0:0:0:0:0:0:1`이 다른 값이 되고,
 * 그 차이는 사람이 눈으로 못 찾습니다.
 *
 * IPv4-mapped(`::ffff:10.0.0.1`)는 **IPv4로 되돌려** 비교합니다. 같은
 * 기계를 두 가지로 적을 수 있으면, 한쪽으로 적은 선언이 다른 쪽으로 들어온
 * 요청을 놓칩니다.
 */

/** 선언된 신뢰 프록시 하나 — 단일 IP이거나 CIDR */
export interface TrustedProxyRule {
  raw: string;
  /**
   * 주소를 정수 하나로 (IPv4는 32비트, IPv6는 128비트).
   *
   * 문자열로 비교하면 `::1`과 `0:0:0:0:0:0:0:1`이 다른 값이 되고, 그 차이는
   * 사람이 눈으로 못 찾습니다.
   */
  base: bigint;
  /** 앞에서 몇 비트를 비교하는가 */
  bits: number;
  /** 주소 체계 — 다른 체계끼리는 비교하지 않는다 */
  family: 4 | 6;
}

/** 전달 헤더를 어떻게 다뤘는가 */
export type ForwardedVerdict =
  /** 신뢰하는 프록시가 보냈고 값이 하나다 — 이 값을 쓴다 */
  | "trusted"
  /** 신뢰하지 않는 상대가 보냈다 — **버린다** */
  | "untrusted"
  /** 값이 여러 개라 어느 것이 우리 프록시의 것인지 모른다 — 버린다 */
  | "ambiguous"
  /** 헤더가 없다 */
  | "absent"
  /** 신뢰 목록이 선언되지 않았다 — 4301과 같게 동작한다 */
  | "not-configured";

export interface ForwardedHostResult {
  /** 관측에 쓸 호스트 (정규화 전 원문) — 없으면 null */
  host: string | null;
  verdict: ForwardedVerdict;
  /** 어디서 온 값인가 — 화면이 "프록시 경유"를 구분해 보여 준다 */
  via: "proxy" | "direct";
  detail: string;
}

/** IPv4 문자열 → 정수. IPv4가 아니면 null */
function toIpv4(value: string): bigint | null {
  const parts = value.trim().split(".");
  if (parts.length !== 4) {
    return null;
  }
  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    result = result * 256n + BigInt(octet);
  }
  return result;
}

/**
 * IPv6 문자열 → 128비트 정수 (순수 함수, TASK-4501).
 *
 * `::` 축약과 끝자리 IPv4 표기(`::ffff:10.0.0.1`)를 함께 받습니다.
 * 읽을 수 없으면 `null`입니다 — **읽은 척하지 않습니다.**
 */
function toIpv6(value: string): bigint | null {
  const raw = value.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (raw.length === 0 || !/^[0-9a-f:.]+$/.test(raw)) {
    return null;
  }
  // 축약(::)은 한 번만 쓸 수 있다
  const halves = raw.split("::");
  if (halves.length > 2) {
    return null;
  }

  const expand = (part: string): string[] =>
    part.length === 0 ? [] : part.split(":");

  const head = expand(halves[0]);
  const tail = halves.length === 2 ? expand(halves[1]) : [];
  const groups: string[] = [];

  // 끝자리가 IPv4 표기면 두 그룹으로 바꾼다 (::ffff:10.0.0.1)
  const last = (tail.length > 0 ? tail : head)[
    (tail.length > 0 ? tail : head).length - 1
  ];
  let trailingIpv4: string[] | null = null;
  if (last !== undefined && last.includes(".")) {
    const ipv4 = toIpv4(last);
    if (ipv4 === null) {
      return null;
    }
    trailingIpv4 = [
      ((ipv4 >> 16n) & 0xffffn).toString(16),
      (ipv4 & 0xffffn).toString(16),
    ];
    if (tail.length > 0) {
      tail.pop();
    } else {
      head.pop();
    }
  }

  const headGroups = [...head];
  const tailGroups = [...tail, ...(trailingIpv4 ?? [])];
  const filled = headGroups.length + tailGroups.length;

  if (halves.length === 2) {
    if (filled > 7) {
      return null;
    }
    groups.push(
      ...headGroups,
      ...Array.from({ length: 8 - filled }, () => "0"),
      ...tailGroups,
    );
  } else {
    if (filled !== 8) {
      return null;
    }
    groups.push(...headGroups, ...tailGroups);
  }

  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }
    result = (result << 16n) + BigInt(parseInt(group, 16));
  }
  return result;
}

/** 주소를 정수와 체계로 — 읽을 수 없으면 null */
function parseAddress(value: string): { value: bigint; family: 4 | 6 } | null {
  const normalized = normalizePeerAddress(value);
  if (normalized === null) {
    return null;
  }
  const ipv4 = toIpv4(normalized);
  if (ipv4 !== null) {
    return { value: ipv4, family: 4 };
  }
  const ipv6 = toIpv6(normalized);
  return ipv6 === null ? null : { value: ipv6, family: 6 };
}

/**
 * IPv6 표기에 섞여 오는 IPv4를 꺼낸다 (`::ffff:10.0.0.1`).
 *
 * Node가 이중 스택 소켓에서 이 모양으로 주소를 줍니다. 벗기지 않으면
 * **선언한 프록시가 하나도 안 맞고**, 그러면 이 기능이 조용히 꺼진 것과
 * 같아집니다.
 */
export function normalizePeerAddress(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value.length === 0) {
    return null;
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped !== null) {
    return mapped[1];
  }
  return value;
}

/**
 * 신뢰 프록시 목록을 읽는다 (순수 함수).
 *
 * 읽을 수 없는 항목은 **버리되 돌려줍니다** — 조용히 버리면 오타 하나로
 * 보호가 꺼진 것을 아무도 모릅니다.
 */
export function parseTrustedProxies(raw: string | undefined): {
  rules: TrustedProxyRule[];
  rejected: string[];
} {
  const rules: TrustedProxyRule[] = [];
  const rejected: string[] = [];
  for (const entry of (raw ?? "").split(",")) {
    const token = entry.trim();
    if (token.length === 0) {
      continue;
    }
    // CIDR의 `/`는 마지막 것만 본다 — IPv6 주소 안에는 `/`가 없다
    const slash = token.lastIndexOf("/");
    const address = slash === -1 ? token : token.slice(0, slash);
    const prefix = slash === -1 ? undefined : token.slice(slash + 1);

    const parsed = parseAddress(address);
    if (parsed === null) {
      rejected.push(token);
      continue;
    }
    const width = parsed.family === 4 ? 32 : 128;
    const bits = prefix === undefined ? width : Number(prefix);
    if (!Number.isInteger(bits) || bits < 0 || bits > width) {
      rejected.push(token);
      continue;
    }
    rules.push({ raw: token, base: parsed.value, bits, family: parsed.family });
  }
  return { rules, rejected };
}

/** 이 상대가 선언된 프록시인가 (순수 함수) */
export function isTrustedPeer(
  peer: string | null | undefined,
  rules: TrustedProxyRule[],
): boolean {
  if (rules.length === 0 || peer === null || peer === undefined) {
    return false;
  }
  const address = parseAddress(peer);
  if (address === null) {
    return false;
  }
  return rules.some((rule) => {
    // **다른 체계끼리는 비교하지 않습니다** — IPv4 선언이 IPv6 상대와
    // 우연히 맞아떨어지면 그건 신뢰가 아니라 사고입니다
    if (rule.family !== address.family) {
      return false;
    }
    if (rule.bits === 0) {
      // `0.0.0.0/0`·`::/0`은 "아무나"입니다 — 그건 신뢰 경계가 아니라 경계를
      // 없앤 것이므로 맞지 않는 것으로 봅니다
      return false;
    }
    const width = rule.family === 4 ? 32n : 128n;
    const shift = width - BigInt(rule.bits);
    return address.value >> shift === rule.base >> shift;
  });
}

/**
 * 어떤 호스트를 관측할 것인가 (순수 함수, CTO 정책 4401-①).
 *
 * **기본값은 언제나 `Host`입니다.** 전달 헤더는 신뢰하는 프록시가 보냈고
 * 값이 하나일 때만 씁니다.
 */
export function resolveForwardedHost(input: {
  host: string | null | undefined;
  forwardedHost: string | string[] | null | undefined;
  peer: string | null | undefined;
  rules: TrustedProxyRule[];
}): ForwardedHostResult {
  const direct = (input.host ?? "").trim();
  const fallback = direct.length === 0 ? null : direct;

  if (input.rules.length === 0) {
    return {
      host: fallback,
      verdict: "not-configured",
      via: "direct",
      detail:
        "신뢰하는 프록시가 선언되지 않아 전달 헤더를 보지 않았습니다 — " +
        "선언 없이 보면 누가 적었는지 모르는 이름이 관측에 들어갑니다.",
    };
  }

  const raw = input.forwardedHost;
  const values = (Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw])
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (values.length === 0) {
    return {
      host: fallback,
      verdict: "absent",
      via: "direct",
      detail: "전달 헤더가 없어 Host를 그대로 봤습니다.",
    };
  }

  if (!isTrustedPeer(input.peer, input.rules)) {
    // **버리되 셉니다** — 누군가 프록시인 척했다는 사실은 그 자체로 소식이다
    return {
      host: fallback,
      verdict: "untrusted",
      via: "direct",
      detail:
        `신뢰하지 않는 상대(${normalizePeerAddress(input.peer) ?? "주소 모름"})가 ` +
        "전달 헤더를 보냈습니다 — 버렸습니다. 이 헤더는 앞단이 붙인 것이 " +
        "아니라 바깥에서 온 글입니다.",
    };
  }

  if (values.length > 1) {
    // **추측하지 않습니다** — 덧붙이는 프록시인지 덮어쓰는 프록시인지
    // 모르는 상태에서 하나를 고르면 고른 이유가 없는 값이 들어갑니다
    return {
      host: fallback,
      verdict: "ambiguous",
      via: "direct",
      detail:
        `전달 헤더에 값이 ${values.length}개 있습니다 (${values.join(" · ")}) — ` +
        "어느 것을 우리 프록시가 적었는지 알 수 없어 쓰지 않았습니다. " +
        "프록시가 이 헤더를 덮어쓰도록 설정해 주세요.",
    };
  }

  return {
    host: values[0],
    verdict: "trusted",
    via: "proxy",
    detail: `신뢰하는 프록시(${normalizePeerAddress(input.peer)})가 전달한 호스트입니다.`,
  };
}

export interface TrustedProxyReport {
  /** 선언된 규칙 수 */
  declared: number;
  /** 읽을 수 없어 버린 선언 */
  rejected: string[];
  /** 신뢰하지 않는 상대가 전달 헤더를 보낸 횟수 */
  untrusted: number;
  /** 값이 여러 개라 쓰지 못한 횟수 */
  ambiguous: number;
  /** 프록시를 통해 관측한 요청 수 */
  viaProxy: number;
  status: "ok" | "warn" | "unknown";
  detail: string;
}

/**
 * 신뢰 프록시 구성을 진단 항목으로 (순수 함수).
 *
 * **선언이 없는 것은 실패가 아닙니다** — 프록시를 안 쓰는 구성도 정상이고,
 * 없는 것을 실패로 칠하면 그 경고가 배경 소음이 됩니다(정책 4001-④와 같은
 * 이유). 다만 **선언해 놓고 한 번도 안 맞았다면** 그것은 설정이 틀렸다는
 * 뜻이고, 그때는 말합니다.
 */
export function trustedProxyCheck(input: {
  declared: number;
  rejected: string[];
  untrusted: number;
  ambiguous: number;
  viaProxy: number;
  observedRequests: number;
}): TrustedProxyReport {
  const parts: string[] = [];
  let status: TrustedProxyReport["status"] = "ok";

  if (input.declared === 0) {
    parts.push(
      "신뢰하는 프록시가 선언되지 않았습니다 — 전달 헤더를 보지 않습니다. " +
        "프록시 뒤에 있다면 관측되는 호스트는 내부 주소뿐입니다.",
    );
  } else {
    parts.push(`신뢰하는 프록시 ${input.declared}개가 선언돼 있습니다.`);
    if (input.viaProxy === 0 && input.observedRequests > 0) {
      // 선언은 했는데 한 번도 안 맞았다 — 주소가 틀렸거나 프록시가 헤더를
      // 안 붙이는 것이고, 어느 쪽이든 이 기능은 지금 꺼져 있는 것과 같다
      status = "warn";
      parts.push(
        "그런데 전달 헤더로 관측된 요청이 하나도 없습니다 — 선언한 주소가 " +
          "실제 프록시가 아니거나, 프록시가 헤더를 붙이지 않고 있습니다.",
      );
    }
  }

  if (input.rejected.length > 0) {
    status = "warn";
    parts.push(
      `읽을 수 없는 선언 ${input.rejected.length}개를 버렸습니다 ` +
        `(${input.rejected.join(" · ")}) — 오타 하나로 신뢰 경계가 조용히 ` +
        "좁아지지 않도록 그대로 적습니다.",
    );
  }
  if (input.untrusted > 0) {
    status = "warn";
    parts.push(
      `신뢰하지 않는 상대가 전달 헤더를 보낸 요청 ${input.untrusted}건을 ` +
        "버렸습니다 — 프록시인 척한 요청이거나 프록시 주소 선언이 빠진 " +
        "것입니다.",
    );
  }
  if (input.ambiguous > 0) {
    status = "warn";
    parts.push(
      `전달 헤더에 값이 여러 개여서 쓰지 못한 요청 ${input.ambiguous}건이 ` +
        "있습니다 — 어느 것이 우리 프록시의 값인지 모르는 상태에서 하나를 " +
        "고르면 고른 이유가 없는 값이 관측에 들어갑니다.",
    );
  }

  return {
    declared: input.declared,
    rejected: input.rejected,
    untrusted: input.untrusted,
    ambiguous: input.ambiguous,
    viaProxy: input.viaProxy,
    status,
    detail: parts.join(" "),
  };
}
