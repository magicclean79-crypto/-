import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/acos?schema=public";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasourceUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    });
  }

  async onModuleInit(): Promise<void> {
    // DB가 꺼져 있어도 API 서버 기동은 막지 않는다.
    try {
      await this.$connect();
      this.logger.log("Database connected");
    } catch {
      this.logger.warn(
        "Database is not reachable. Run `pnpm docker:up` to start PostgreSQL.",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
