import { Injectable } from "@nestjs/common";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { judgeMigrations } from "@acos/core";
import type { MigrationGovernance, MigrationState } from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Migration Governance 어댑터. (TASK-2401, Sprint 24 — CTO 결정 2301-①·②)
 *
 * 스키마 적용 상태를 **한 곳에서만** 읽는다. 배포 체크리스트와 감시(watchdog)가
 * 각자 읽으면 두 화면이 다른 말을 할 수 있다 — 복구 판정을 단일 원천으로
 * 모은 것과 같은 이유다.
 *
 * **애플리케이션은 적용하지 않는다** — 읽기만 한다 (CTO 결정 2201-①).
 */
@Injectable()
export class MigrationGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 스키마 적용 상태.
   *
   * **실패 행만 세면 미적용을 알 수 없다** — 적용하지 않은 마이그레이션은
   * 실패 행조차 남기지 않으므로, 그것만 보면 "미적용 없음"이라는 거짓 통과가
   * 나온다. 그래서 디렉터리와 적용 기록을 **대조한다.**
   */
  async state(): Promise<MigrationState> {
    const [directories, applied, failed] = await Promise.all([
      this.directories(),
      this.applied(),
      this.failed(),
    ]);
    return { directories, applied, failed };
  }

  /** 판정까지 (core 순수 로직) */
  async judge(production: boolean): Promise<MigrationGovernance> {
    return judgeMigrations(await this.state(), { production });
  }

  private async directories(): Promise<string[] | null> {
    try {
      const entries = await readdir(
        join(process.cwd(), "prisma", "migrations"),
        { withFileTypes: true },
      );
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      // 읽지 못한 것을 "없음"으로 세지 않는다
      return null;
    }
  }

  private async applied(): Promise<string[] | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at ASC
      `;
      return rows.map((row) => row.migration_name);
    } catch {
      return null;
    }
  }

  private async failed(): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM _prisma_migrations
        WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
      `;
      return Number(rows[0]?.count ?? 0);
    } catch {
      return null;
    }
  }
}
