import { Injectable, Logger } from "@nestjs/common";
import type { NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import {
  HOST_DISCOVERY_LIMIT,
  HostSightingBuffer,
  judgeHostDiscovery,
  mergeSightings,
} from "@acos/core";
import type { DeploymentTier, HostDiscoveryReport, HostSighting } from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 운영 트래픽 기반 호스트 관측. (TASK-4301, Sprint 43 — CTO 정책 4301-①)
 *
 * 요청마다 `Host` 헤더를 메모리에 담고, 주기적으로 한 번에 저장합니다.
 * **요청마다 쓰지 않는 이유**는 트래픽이 곧 쓰기 부하가 되기 때문입니다 —
 * 관측 기능이 장애의 원인이 되면 그 기능은 곧 꺼집니다.
 *
 * 판정은 전부 `@acos/core`가 합니다. 여기서 하는 일은 담기·모으기·읽기뿐이고,
 * **관측한 이름을 운영 호스트 목록에 넣는 경로는 없습니다.**
 */
@Injectable()
export class HostDiscoveryService {
  private readonly logger = new Logger(HostDiscoveryService.name);
  private readonly buffer = new HostSightingBuffer(HOST_DISCOVERY_LIMIT);
  /** 상한에 걸린 적이 있는가 — 저장 뒤에도 "관측이 잘렸다"를 기억한다 */
  private sawOverflow = false;
  /**
   * 호스트 이름이 아니어서 버린 요청 수 (누적).
   *
   * 로그에만 남기면 화면을 보는 사람은 이상한 요청이 들어오고 있다는 사실을
   * 모릅니다 — 조용히 버리는 것과 다르지 않습니다.
   */
  private rejectedTotal = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** 요청 하나를 담는다 (I/O 없음) */
  observe(rawHost: unknown, now = Date.now()): void {
    if (!this.buffer.observe(rawHost, now) && this.buffer.size >= HOST_DISCOVERY_LIMIT) {
      this.sawOverflow = true;
    }
  }

  /**
   * 모아 둔 관측을 저장한다.
   *
   * 저장에 실패해도 던지지 않습니다 — 관측은 부수적인 일이고, 이것 때문에
   * 예약 점검이 멈추면 정작 중요한 판정이 안 돕니다. 다만 **조용히 넘기지도
   * 않습니다.**
   */
  async flush(tier: DeploymentTier, now = Date.now()): Promise<number> {
    const { sightings, rejected, full } = this.buffer.drain();
    if (full) {
      this.sawOverflow = true;
    }
    this.rejectedTotal += rejected;
    if (rejected > 0) {
      this.logger.warn(
        `호스트 이름이 아닌 Host 헤더 ${rejected}건을 버렸습니다 — ` +
          "잘못 만든 클라이언트이거나 헤더 주입 시도입니다.",
      );
    }
    let saved = 0;
    for (const row of sightings) {
      try {
        await this.prisma.observedHost.upsert({
          where: { tier_host: { tier, host: row.host } },
          create: {
            host: row.host,
            tier,
            requests: row.requests,
            firstSeenAt: new Date(row.firstSeenAt),
            lastSeenAt: new Date(row.lastSeenAt),
          },
          update: {
            requests: { increment: row.requests },
            lastSeenAt: new Date(row.lastSeenAt),
          },
        });
        saved += 1;
      } catch (error) {
        this.logger.warn(`호스트 관측을 저장하지 못했습니다: ${String(error)}`);
      }
    }
    void now;
    return saved;
  }

  /** 저장된 관측 + 아직 저장 안 한 관측 */
  async report(tier: DeploymentTier, now = Date.now()): Promise<HostDiscoveryReport> {
    const rows = await this.prisma.observedHost
      .findMany({ where: { tier }, orderBy: { requests: "desc" } })
      .catch((error: unknown) => {
        this.logger.warn(`호스트 관측을 읽지 못했습니다: ${String(error)}`);
        return [];
      });

    const stored: HostSighting[] = rows.map((row) => ({
      host: row.host,
      requests: row.requests,
      firstSeenAt: row.firstSeenAt.getTime(),
      lastSeenAt: row.lastSeenAt.getTime(),
    }));

    const report = judgeHostDiscovery({
      sightings: mergeSightings(stored, []),
      now,
      // 아직 저장 안 한 것까지 더한다 — 버린 요청은 저장되지 않으므로
      // 여기서 세지 않으면 화면에서 영영 보이지 않는다
      rejected: this.rejectedTotal + this.buffer.rejected,
    });

    // 저장 뒤에도 "관측이 잘린 적이 있다"를 잊지 않는다 — 잊으면 불완전한
    // 관측이 완전한 관측처럼 보인다
    return this.sawOverflow && !report.overflowed
      ? {
          ...report,
          overflowed: true,
          detail:
            report.detail +
            " 이번 주기에 관측 상한에 걸린 적이 있어 담기지 못한 호스트가 " +
            "있습니다 — 목록에 없는 호스트가 더 있을 수 있습니다.",
        }
      : report;
  }
}

/**
 * 요청마다 `Host`를 담는 미들웨어.
 *
 * 응답을 기다리지 않고 바로 넘깁니다 — 관측이 요청 지연을 만들면 안 됩니다.
 */
@Injectable()
export class HostObserverMiddleware implements NestMiddleware {
  constructor(private readonly discovery: HostDiscoveryService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    // `X-Forwarded-Host`를 보지 않는 이유: 앞단이 붙이는 값과 클라이언트가
    // 붙이는 값을 우리가 구분할 수 없습니다. 구분할 수 없는 출처를 섞으면
    // 관측이 "누가 적었는지 모르는 이름"으로 채워집니다.
    this.discovery.observe(req.headers.host);
    next();
  }
}
