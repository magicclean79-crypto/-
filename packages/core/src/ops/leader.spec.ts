import {
  decideLease,
  describeLease,
  instanceId,
  isLeaseValid,
  nextLease,
  ownsLease,
  renewAfter,
} from "./leader";
import type { Lease, LeaseOptions } from "./leader";

const OPTIONS: LeaseOptions = { ttlMs: 30_000 };
const NOW = 1_000_000;

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    key: overrides.key ?? "scheduler:cost-verification",
    owner: overrides.owner ?? "node-a",
    expiresAt: overrides.expiresAt ?? NOW + 30_000,
  };
}

describe("Leader Election & Distributed Lock (TASK-1401)", () => {
  describe("isLeaseValid", () => {
    it("만료된 임차는 무효 — TTL 없는 락은 리더가 죽으면 영원히 잠긴다", () => {
      expect(isLeaseValid(lease({ expiresAt: NOW + 1 }), NOW)).toBe(true);
      expect(isLeaseValid(lease({ expiresAt: NOW }), NOW)).toBe(false);
      expect(isLeaseValid(lease({ expiresAt: NOW - 1 }), NOW)).toBe(false);
      expect(isLeaseValid(null, NOW)).toBe(false);
    });
  });

  describe("renewAfter", () => {
    it("만료 직전이 아니라 여유를 두고 갱신한다 (기본 TTL의 1/3)", () => {
      expect(renewAfter({ ttlMs: 30_000 })).toBe(10_000);
      expect(renewAfter({ ttlMs: 30_000, renewAfterMs: 5_000 })).toBe(5_000);
    });
  });

  describe("decideLease", () => {
    it("임차가 없거나 만료됐으면 획득", () => {
      expect(decideLease(null, "node-a", NOW, OPTIONS)).toBe("acquire");
      expect(
        decideLease(lease({ expiresAt: NOW - 1 }), "node-a", NOW, OPTIONS),
      ).toBe("acquire");
      // 남의 만료된 임차도 잡으러 간다 — 죽은 리더를 대신해야 한다
      expect(
        decideLease(
          lease({ owner: "node-b", expiresAt: NOW - 1 }),
          "node-a",
          NOW,
          OPTIONS,
        ),
      ).toBe("acquire");
    });

    it("남의 유효한 임차는 넘긴다", () => {
      expect(decideLease(lease({ owner: "node-b" }), "node-a", NOW, OPTIONS)).toBe(
        "yield",
      );
    });

    it("내 임차는 여유가 있으면 유지, 곧 만료면 갱신", () => {
      expect(
        decideLease(
          lease({ owner: "node-a", expiresAt: NOW + 25_000 }),
          "node-a",
          NOW,
          OPTIONS,
        ),
      ).toBe("hold");
      expect(
        decideLease(
          lease({ owner: "node-a", expiresAt: NOW + 9_000 }),
          "node-a",
          NOW,
          OPTIONS,
        ),
      ).toBe("renew");
      // 경계: 남은 수명이 갱신 시점과 정확히 같으면 갱신한다
      expect(
        decideLease(
          lease({ owner: "node-a", expiresAt: NOW + 10_000 }),
          "node-a",
          NOW,
          OPTIONS,
        ),
      ).toBe("renew");
    });
  });

  describe("ownsLease", () => {
    it("소유자만 해제·갱신할 수 있다 — 남의 임차를 지우면 리더가 둘이 된다", () => {
      expect(ownsLease(lease({ owner: "node-a" }), "node-a", NOW)).toBe(true);
      expect(ownsLease(lease({ owner: "node-b" }), "node-a", NOW)).toBe(false);
      // 만료된 내 임차도 소유가 아니다 — 그 사이 남이 잡았을 수 있다
      expect(
        ownsLease(lease({ owner: "node-a", expiresAt: NOW - 1 }), "node-a", NOW),
      ).toBe(false);
      expect(ownsLease(null, "node-a", NOW)).toBe(false);
    });
  });

  describe("nextLease", () => {
    it("지금부터 TTL만큼", () => {
      expect(nextLease("k", "node-a", NOW, OPTIONS)).toEqual({
        key: "k",
        owner: "node-a",
        expiresAt: NOW + 30_000,
      });
    });
  });

  describe("instanceId", () => {
    it("호스트명이 겹쳐도 구분되도록 PID·난수를 섞는다", () => {
      const a = instanceId({ hostname: "pod", pid: 1, random: "aaa" });
      const b = instanceId({ hostname: "pod", pid: 1, random: "bbb" });
      expect(a).not.toBe(b);
      expect(a).toBe("pod-1-aaa");
    });
  });

  describe("describeLease", () => {
    it("현재 리더와 남은 수명을 보여준다", () => {
      expect(
        describeLease(
          lease({ owner: "node-b", expiresAt: NOW + 5_000 }),
          "node-a",
          NOW,
        ),
      ).toMatchObject({ owner: "node-b", self: false, remainingMs: 5_000 });
      expect(
        describeLease(lease({ owner: "node-a" }), "node-a", NOW).self,
      ).toBe(true);
    });

    it("만료된 임차는 리더 없음으로 본다 — 낡은 값을 현재 리더로 보이면 안 된다", () => {
      expect(
        describeLease(lease({ expiresAt: NOW - 1 }), "node-a", NOW),
      ).toMatchObject({ owner: null, self: false, remainingMs: 0, expiresAt: null });
    });
  });
});
