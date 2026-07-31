import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { SettingValidationError, validateSetting } from "@acos/core";
import type { AdminAuditEntryDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 운영 설정 오버라이드 저장소. (TASK-1201, Sprint 12)
 *
 * 설정 원칙은 그대로 **Code-first(환경변수)** 이고, 이 서비스는 그 위에
 * 얹는 **운영 오버라이드**를 다룬다. 오버라이드가 없으면 기존 동작 그대로다.
 *
 * **읽기는 동기**다 — 라우팅·실험·Failover 해석은 LLM 호출마다 일어나므로
 * DB 왕복을 넣을 수 없다. 시작 시 전부 읽어 인메모리 맵에 두고, 쓰기 때
 * 즉시 갱신하며, TTL이 지나면 다시 읽는다(다중 인스턴스에서 다른 인스턴스의
 * 변경이 최대 TTL만큼 늦게 보인다 — 설정 변경 빈도를 생각하면 충분하다).
 */
@Injectable()
export class AdminSettingsService implements OnModuleInit {
  private readonly logger = new Logger(AdminSettingsService.name);
  private cache = new Map<string, string>();
  private loadedAt = 0;
  private refreshing: Promise<void> | null = null;

  /** 캐시 수명(ms) — 다른 인스턴스의 변경이 반영되는 최대 지연 */
  private readonly ttlMs = Math.max(
    0,
    Number(process.env.ADMIN_SETTINGS_TTL_MS ?? 10_000) || 10_000,
  );

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // 기동 시 1회 적재 — 실패해도 서비스는 뜬다(환경변수로 동작)
    await this.refresh().catch((error) =>
      this.logger.warn(`설정 오버라이드 초기 적재 실패 (환경변수로 동작): ${error}`),
    );
  }

  /** DB에서 오버라이드 전체를 다시 읽는다 */
  async refresh(): Promise<void> {
    const rows = await this.prisma.adminSetting.findMany();
    this.cache = new Map(rows.map((row) => [row.key, row.value]));
    this.loadedAt = Date.now();
  }

  /**
   * 동기 조회 — 캐시가 오래됐으면 **백그라운드로** 갱신하고 현재 값을 준다.
   * 호출 지연을 만들지 않는 것이 우선이다.
   */
  get(key: string): string | null {
    if (this.ttlMs > 0 && Date.now() - this.loadedAt > this.ttlMs) {
      this.scheduleRefresh();
    }
    return this.cache.get(key) ?? null;
  }

  private scheduleRefresh(): void {
    if (this.refreshing) {
      return;
    }
    this.loadedAt = Date.now(); // 중복 예약 방지
    this.refreshing = this.refresh()
      .catch((error) => this.logger.warn(`설정 오버라이드 갱신 실패: ${error}`))
      .finally(() => {
        this.refreshing = null;
      });
  }

  /**
   * 현재 오버라이드 전체.
   *
   * **`get`과 같은 갱신 규칙을 쓴다** (TASK-3901 라이브 검증에서 고침).
   * 그전에는 `all()`만 갱신을 예약하지 않아서, 이 맵을 읽는 쪽
   * (KPI 임계값·보존 정책·자동 승격 — 전부 TASK-3901에서 추가됐다)은
   * **다른 인스턴스가 바꾼 설정도, 이 인스턴스가 뜬 뒤에 바뀐 설정도**
   * 재시작 전까지 보지 못했습니다. 운영자는 값을 바꾸고 화면이 안 바뀌는
   * 것을 보게 되고, 그때 의심하는 것은 자기가 입력한 값입니다.
   */
  all(): Record<string, string> {
    if (this.ttlMs > 0 && Date.now() - this.loadedAt > this.ttlMs) {
      this.scheduleRefresh();
    }
    return Object.fromEntries(this.cache);
  }

  /**
   * 오버라이드 저장/해제. `value === null`이면 삭제 = 환경변수로 되돌린다.
   * 검증은 **저장 시점에** 한다 — 잘못된 값이 들어가면 다음 호출부터
   * 라우팅이 깨지기 때문이다. 모든 변경은 감사 기록으로 남는다.
   */
  async set(
    key: string,
    value: string | null,
    actor: string | null,
    note?: string | null,
  ): Promise<{ key: string; value: string | null }> {
    try {
      validateSetting(key, value);
    } catch (error) {
      if (error instanceof SettingValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const before = this.cache.get(key) ?? null;
    await this.prisma.$transaction([
      value === null
        ? this.prisma.adminSetting.deleteMany({ where: { key } })
        : this.prisma.adminSetting.upsert({
            where: { key },
            create: { key, value, updatedBy: actor },
            update: { value, updatedBy: actor },
          }),
      this.prisma.adminAuditLog.create({
        data: {
          actor,
          action: value === null ? "SETTING_CLEARED" : "SETTING_UPDATED",
          key,
          before,
          after: value,
          note: note ?? null,
        },
      }),
    ]);

    if (value === null) {
      this.cache.delete(key);
    } else {
      this.cache.set(key, value);
    }
    this.logger.log(
      `설정 ${value === null ? "해제" : "변경"} (${key}): ${before ?? "(없음)"} → ${value ?? "(환경변수)"}` +
        `${actor ? ` by ${actor}` : ""}`,
    );
    return { key, value };
  }

  /** 콘솔 조작 감사 이력 (최신순) */
  async audit(limit = 50): Promise<AdminAuditEntryDto[]> {
    const rows = await this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action as AdminAuditEntryDto["action"],
      key: row.key,
      before: row.before,
      after: row.after,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
