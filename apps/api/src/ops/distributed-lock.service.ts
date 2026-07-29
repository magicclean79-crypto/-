import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import {
  DEFAULT_LEASE_TTL_MS,
  decideLease,
  describeLease,
  instanceId,
  nextLease,
} from "@acos/core";
import type { Lease, LeaseOptions, LeaseView } from "@acos/core";

/**
 * Distributed Lock & Leader Election. (TASK-1401, Sprint 14)
 *
 * TASK-1302에서 예약 점검이 **인스턴스마다 중복 실행**되던 문제를 없앤다
 * (CTO 결정 1302-②).
 *
 * 두 가지 모드로 동작한다:
 * - **Redis 모드** (`REDIS_URL` 설정): 임차(lease)를 Redis에 두고
 *   `SET NX PX`로 획득, **소유자 확인 Lua 스크립트**로 갱신·해제한다.
 *   비교 없이 지우면 남의 임차를 해제해 리더가 둘이 될 수 있다.
 * - **단일 인스턴스 모드** (미설정): 항상 리더. 개발·단일 배포에서
 *   Redis를 강제하지 않기 위해서다. **어느 모드인지 상태에 드러낸다** —
 *   다중 인스턴스인데 단일 모드로 돌고 있으면 그것이 바로 사고다.
 *
 * Redis 연결이 끊기면 **잠그지 못한 것으로 본다**(획득 실패). 잠금 여부를
 * 모르는 채로 "잡았다"고 하면 중복 실행이 조용히 일어난다.
 */
@Injectable()
export class DistributedLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);
  private client: Redis | null = null;
  private readonly leases = new Map<string, Lease>();
  readonly self: string;
  /** 잠금이 불가해진 시각 — 정상이면 null (CTO 결정 1501-②) */
  private unhealthySinceAt: number | null = null;

  constructor() {
    this.self = instanceId({
      hostname: hostname(),
      pid: process.pid,
      random: randomBytes(4).toString("hex"),
    });
  }

  get ttlMs(): number {
    const raw = Number(process.env.OPS_LOCK_TTL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LEASE_TTL_MS;
  }

  private get options(): LeaseOptions {
    return { ttlMs: this.ttlMs };
  }

  /** Redis를 쓰는가 — 아니면 단일 인스턴스 모드 */
  get distributed(): boolean {
    return this.client !== null;
  }

  /**
   * 잠금 저장소가 지금 쓸 수 있는가 (TASK-1501).
   *
   * **자동 폴백하지 않는다** (CTO 결정 1401-①) — Redis가 죽었다고 단일 모드로
   * 내려가면 여러 인스턴스가 동시에 점검을 돌린다. 대신 이 값을 감시자에게
   * 넘겨 **멈춘 사실을 알린다**.
   */
  get healthy(): boolean {
    if (this.client === null) {
      return true; // 단일 모드는 잠금이 필요 없다
    }
    const ok = this.client.status === "ready";
    // 장애가 **얼마나 지속됐는지**를 알아야 30분 기준을 판정할 수 있다
    if (ok) {
      this.unhealthySinceAt = null;
    } else if (this.unhealthySinceAt === null) {
      this.unhealthySinceAt = Date.now();
    }
    return ok;
  }

  /** 잠금 불가가 시작된 시각 (epoch ms) — 정상이면 null */
  get unhealthySince(): number | null {
    // 호출로 상태를 갱신한다 (게터가 관측 지점이다)
    void this.healthy;
    return this.unhealthySinceAt;
  }

  /** Redis 상태 점검 (PING) — 대시보드용 */
  async ping(): Promise<{ ok: boolean; detail: string; latencyMs: number | null }> {
    if (this.client === null) {
      return {
        ok: true,
        detail: "단일 인스턴스 모드 — Redis를 쓰지 않습니다.",
        latencyMs: null,
      };
    }
    const startedAt = Date.now();
    try {
      const reply = await this.client.ping();
      return {
        ok: reply === "PONG",
        detail: reply === "PONG" ? "PING 응답 정상" : `예상치 못한 응답: ${reply}`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        detail: `연결 실패: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  onModuleInit(): void {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      this.logger.warn(
        "REDIS_URL이 없어 단일 인스턴스 모드로 동작합니다 — " +
          "다중 인스턴스에서는 예약 점검이 중복 실행됩니다.",
      );
      return;
    }
    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      // 연결이 끊겨도 프로세스를 붙잡지 않는다
      enableOfflineQueue: false,
    });
    this.client.on("error", (error: Error) => {
      this.logger.warn(`Redis 오류: ${error.message}`);
    });
    this.logger.log(`분산 잠금 활성화 (Redis) — 인스턴스 ${this.self}`);
  }

  async onModuleDestroy(): Promise<void> {
    // 종료 시 내 임차를 놓아 준다 — 다음 리더가 TTL을 기다리지 않아도 된다
    for (const key of [...this.leases.keys()]) {
      await this.release(key).catch(() => undefined);
    }
    this.client?.disconnect();
    this.client = null;
  }

  /** 소유자가 나일 때만 값을 바꾼다 (갱신·해제 공용) */
  private static readonly OWNED_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      if ARGV[2] == "" then
        return redis.call("del", KEYS[1])
      end
      return redis.call("pexpire", KEYS[1], ARGV[2])
    end
    return 0
  `;

  private redisKey(key: string): string {
    return `acos:lock:${key}`;
  }

  /**
   * 잠금을 획득하거나 유지한다. **리더일 때만 true**.
   *
   * 단일 인스턴스 모드에서는 항상 true — Redis가 없으면 조율할 상대도 없다.
   */
  async acquire(key: string): Promise<boolean> {
    const now = Date.now();

    if (!this.client) {
      this.leases.set(key, nextLease(key, this.self, now, this.options));
      return true;
    }

    const stored = this.leases.get(key) ?? null;
    const decision = decideLease(stored, this.self, now, this.options);

    try {
      if (decision === "hold") {
        return true;
      }
      if (decision === "renew") {
        const renewed = await this.client.eval(
          DistributedLockService.OWNED_SCRIPT,
          1,
          this.redisKey(key),
          this.self,
          String(this.ttlMs),
        );
        if (Number(renewed) === 1) {
          this.leases.set(key, nextLease(key, this.self, now, this.options));
          return true;
        }
        // 갱신 실패 = 임차를 잃었다 — 다시 잡으러 간다
        this.leases.delete(key);
      }

      const acquired = await this.client.set(
        this.redisKey(key),
        this.self,
        "PX",
        this.ttlMs,
        "NX",
      );
      if (acquired === "OK") {
        this.leases.set(key, nextLease(key, this.self, now, this.options));
        return true;
      }
      this.leases.delete(key);
      return false;
    } catch (error) {
      // 잠금 여부를 모르면 잡지 않은 것으로 본다 — 중복 실행이 더 나쁘다
      this.logger.warn(
        `잠금 획득 실패 (${key}): ${error instanceof Error ? error.message : String(error)}`,
      );
      this.leases.delete(key);
      return false;
    }
  }

  /** 내 임차만 해제한다 — 남의 것을 지우면 리더가 둘이 된다 */
  async release(key: string): Promise<void> {
    const stored = this.leases.get(key);
    this.leases.delete(key);
    if (!this.client || !stored) {
      return;
    }
    try {
      await this.client.eval(
        DistributedLockService.OWNED_SCRIPT,
        1,
        this.redisKey(key),
        this.self,
        "",
      );
    } catch (error) {
      // 놓아 주지 못해도 TTL이 만료시킨다 — 영구 잠금은 생기지 않는다
      this.logger.warn(
        `잠금 해제 실패 (${key}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 현재 임차 상태 (표시용) — Redis의 실제 소유자를 읽는다 */
  async status(keys: string[]): Promise<LeaseView[]> {
    const now = Date.now();
    const views: LeaseView[] = [];

    for (const key of keys) {
      if (!this.client) {
        views.push({
          key,
          owner: this.self,
          self: true,
          expiresAt: null,
          remainingMs: 0,
        });
        continue;
      }
      try {
        const [owner, ttl] = await Promise.all([
          this.client.get(this.redisKey(key)),
          this.client.pttl(this.redisKey(key)),
        ]);
        const lease: Lease | null =
          owner === null
            ? null
            : { key, owner, expiresAt: now + Math.max(0, ttl) };
        views.push({ ...describeLease(lease, this.self, now), key });
      } catch {
        views.push({
          key,
          owner: null,
          self: false,
          expiresAt: null,
          remainingMs: 0,
        });
      }
    }
    return views;
  }
}
