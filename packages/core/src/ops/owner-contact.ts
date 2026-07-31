/**
 * 담당자 직접 알림. (TASK-4601, Sprint 46 — CTO 정책 4601-④)
 *
 * TASK-4401의 검토 알림은 담당자 이름을 본문에 적고 **공용 채널로** 보냈습니다.
 * 그런데 채널을 보는 사람과 항목을 맡은 사람은 대개 다릅니다 — 이름이 적혀
 * 있어도 그 사람이 그 채널을 안 보면 안 읽힙니다. 4401 보고서에 그대로
 * 남긴 부채였습니다(#78 ③ · #79에서도 남음).
 *
 * ## 이 판정이 지키는 것
 *
 * 1. **담당자를 못 찾으면 조용히 삼키지 않습니다.** 연락처가 없다고 알림을
 *    안 보내면, 담당자를 적어 둔 것이 오히려 알림을 없애는 셈이 됩니다.
 *    공용 채널로 보내되 **"이 사람의 연락처가 없다"는 사실을 본문에 붙입니다.**
 * 2. **연락처를 지어내지 않습니다.** 이름에서 메일 주소를 유추하지 않습니다
 *    (`김운영` → `kim@…`). 틀린 주소로 보낸 알림은 안 보낸 것과 같은데,
 *    기록에는 "보냈다"로 남습니다.
 * 3. **읽을 수 없는 선언은 버리되 돌려줍니다** — 오타 하나로 담당자 한 명이
 *    조용히 빠지는 것을 아무도 모르면 안 됩니다(4501-①과 같은 규칙).
 */

import { NOTIFICATION_CHANNELS } from "./notification";
import type { NotificationChannel } from "./notification";

/** 담당자 한 명의 연락처 */
export interface OwnerContact {
  owner: string;
  channel: NotificationChannel;
  address: string;
}

export interface OwnerContactBook {
  contacts: OwnerContact[];
  /** 읽을 수 없어 버린 선언 */
  rejected: string[];
}

/**
 * `ALERT_OWNER_CONTACTS`를 읽는다.
 *
 * 형식: `이름=주소` 또는 `이름=채널:주소`, 쉼표로 구분.
 * 채널을 생략하면 `email`입니다 — 개인에게 직접 닿는 경로의 기본값으로
 * 가장 무난하기 때문입니다.
 *
 * ```
 * ALERT_OWNER_CONTACTS="김운영=ops-kim@acos.local, 박서버=slack:https://hooks…"
 * ```
 */
export function parseOwnerContacts(raw: string | undefined): OwnerContactBook {
  const contacts: OwnerContact[] = [];
  const rejected: string[] = [];

  for (const token of (raw ?? "").split(",")) {
    const entry = token.trim();
    if (entry === "") {
      continue;
    }
    const eq = entry.indexOf("=");
    if (eq <= 0 || eq === entry.length - 1) {
      rejected.push(entry);
      continue;
    }
    const owner = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1).trim();
    if (owner === "" || value === "") {
      rejected.push(entry);
      continue;
    }

    const colon = value.indexOf(":");
    // `https://…`의 콜론과 `slack:` 접두의 콜론을 가른다 — 접두는 채널
    // 이름과 정확히 같을 때만 접두다.
    const maybeChannel = colon > 0 ? value.slice(0, colon) : "";
    const isChannelPrefix = (NOTIFICATION_CHANNELS as readonly string[]).includes(
      maybeChannel,
    );
    const channel = (isChannelPrefix ? maybeChannel : "email") as NotificationChannel;
    const address = isChannelPrefix ? value.slice(colon + 1).trim() : value;

    if (address === "") {
      rejected.push(entry);
      continue;
    }
    // 같은 담당자를 두 번 적으면 뒤엣것이 이깁니다 — 다만 둘 다 남기면
    // 한 사람에게 두 번 가고, 그건 알림을 끄게 만듭니다.
    const existing = contacts.findIndex((row) => row.owner === owner);
    if (existing >= 0) {
      contacts[existing] = { owner, channel, address };
    } else {
      contacts.push({ owner, channel, address });
    }
  }

  return { contacts, rejected };
}

export type OwnerRouteVerdict =
  /** 이 담당자의 연락처가 있다 */
  | "direct"
  /** 연락처 표 자체가 없다 */
  | "not-configured"
  /** 표는 있는데 이 담당자가 없다 */
  | "unknown-owner";

export interface OwnerRoute {
  verdict: OwnerRouteVerdict;
  contact: OwnerContact | null;
  /** 공용 채널로도 보내는가 */
  broadcast: boolean;
  /** 본문에 덧붙일 문장 — 없으면 null */
  note: string | null;
  detail: string;
}

/**
 * 이 담당자에게 어떻게 보낼 것인가 (순수 함수).
 *
 * **어느 경우에도 `broadcast`가 꺼지지 않습니다.** 직접 보낼 수 있으면
 * 직접 + 공용이고, 못 찾으면 공용 + 사실 기록입니다. 직접 경로가 생겼다고
 * 공용 채널을 끄면, 담당자가 휴가 중일 때 그 항목은 **아무도 모르는 채로
 * 지나갑니다.**
 */
export function resolveOwnerRoute(
  owner: string | null | undefined,
  book: OwnerContactBook,
): OwnerRoute {
  const name = owner?.trim() ?? "";

  if (book.contacts.length === 0) {
    return {
      verdict: "not-configured",
      contact: null,
      broadcast: true,
      note:
        name === ""
          ? null
          : `담당자 ${name}에게 직접 보낼 경로가 설정돼 있지 않아 공용 채널로만 보냅니다.`,
      detail:
        "담당자 연락처(ALERT_OWNER_CONTACTS)가 없습니다 — 공용 채널로만 갑니다. " +
        "채널을 보는 사람과 항목을 맡은 사람은 대개 다릅니다.",
    };
  }

  const found = book.contacts.find((row) => row.owner === name) ?? null;
  if (found === null) {
    return {
      verdict: "unknown-owner",
      contact: null,
      broadcast: true,
      note:
        `담당자로 적힌 "${name}"의 연락처를 찾지 못해 공용 채널로만 ` +
        "보냅니다. 이름이 연락처 표와 다르거나 표에서 빠져 있습니다.",
      detail:
        `연락처 표에 "${name}"이(가) 없습니다. ` +
        "이름에서 주소를 유추하지 않습니다 — 틀린 주소로 보낸 알림은 안 보낸 " +
        "것과 같은데 기록에는 보냈다고 남습니다.",
    };
  }

  return {
    verdict: "direct",
    contact: found,
    // 직접 갔다고 공용을 끄지 않습니다 — 담당자가 못 볼 수도 있습니다.
    broadcast: true,
    note: null,
    detail: `담당자 ${found.owner}에게 ${found.channel}로 직접 보냅니다(공용 채널에도 남깁니다).`,
  };
}

/** 화면에 실을 담당자 경로 현황 — **주소는 노출하지 않습니다** */
export function ownerContactStatus(book: OwnerContactBook): {
  owners: { owner: string; channel: NotificationChannel }[];
  rejected: string[];
  detail: string;
} {
  const parts: string[] = [];
  if (book.contacts.length === 0) {
    parts.push("담당자 직접 알림 경로가 설정돼 있지 않습니다 — 공용 채널로만 갑니다.");
  } else {
    parts.push(`담당자 ${book.contacts.length}명의 직접 경로가 설정돼 있습니다.`);
  }
  if (book.rejected.length > 0) {
    parts.push(
      `읽을 수 없는 선언 ${book.rejected.length}개를 버렸습니다 ` +
        `(${book.rejected.join(" · ")}) — 오타 하나로 담당자 한 명이 조용히 ` +
        "빠지지 않도록 그대로 적습니다.",
    );
  }
  return {
    owners: book.contacts.map((row) => ({ owner: row.owner, channel: row.channel })),
    rejected: book.rejected,
    detail: parts.join(" "),
  };
}
