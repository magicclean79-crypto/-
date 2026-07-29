import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  DEFAULT_JOB_INTERVALS,
  AUTO_REMOTE_VERIFY_COUNT,
  defaultRpoTargetMs,
  judgeBackup,
  resolveChainWindowMs,
  resolveRemoteVerifyCount,
  summarizeRemoteBatch,
  judgeIntegrity,
  judgeOffsite,
  judgeRecoveryObjectives,
  judgeBackupChain,
  judgeBackupPerformance,
  judgeDatabaseScale,
  judgeRemoteIntegrity,
  judgeRestore,
  judgeRestoreTarget,
  resolveSchedules,
} from "@acos/core";
import type {
  BackupChain,
  BackupHealth,
  BackupPerformance,
  ChainWindowResolution,
  DatabaseScale,
  RemoteBatch,
  RemoteBatchEntry,
  RemoteIntegrity,
  RemoteRecord,
  OffsiteHealth,
  RecoveryObjectives,
  RestoreHealth,
} from "@acos/core";
import type { BackupRunDto, RestoreRunDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

const run = promisify(execFile);

/** 백업·복원은 오래 걸린다 — 무한정 매달리지 않게 상한을 둔다 */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

interface BackupRow {
  id: string;
  ok: boolean;
  sizeBytes: bigint | null;
  fileName: string | null;
  durationMs: number;
  trigger: string;
  error: string | null;
  checksum: string | null;
  integrityOk: boolean | null;
  entries: number | null;
  offsiteKey: string | null;
  createdAt: Date;
}

interface RestoreRow {
  id: string;
  ok: boolean;
  tables: number | null;
  fileName: string | null;
  durationMs: number;
  trigger: string;
  error: string | null;
  createdAt: Date;
}

function toBackupDto(row: BackupRow): BackupRunDto {
  return {
    id: row.id,
    ok: row.ok,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    fileName: row.fileName,
    durationMs: row.durationMs,
    trigger: row.trigger,
    error: row.error,
    checksum: row.checksum ?? null,
    integrityOk: row.integrityOk ?? null,
    entries: row.entries ?? null,
    // 키는 있는지만 알린다 — 저장소 구조를 드러낼 이유가 없다
    offsite: Boolean(row.offsiteKey),
    createdAt: row.createdAt.toISOString(),
  };
}

function toRestoreDto(row: RestoreRow): RestoreRunDto {
  return {
    id: row.id,
    ok: row.ok,
    tables: row.tables,
    fileName: row.fileName,
    durationMs: row.durationMs,
    trigger: row.trigger,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Backup Automation & Restore Verification. (TASK-1601, Sprint 16)
 *
 * **백업은 있다는 것만으로 아무것도 보장하지 않는다** — 복원해 보기 전까지는
 * 백업이 아니라 파일일 뿐이다. 그래서 백업과 **복원 검증**을 한 쌍으로 둔다.
 *
 * 설계 원칙:
 * - **크기를 기록한다.** `pg_dump`는 부분 실패에도 0에 가까운 파일을 남길 수
 *   있고, 그걸 "성공"으로 세면 복구 계획이 통째로 거짓이 된다.
 * - **복원은 별도 데이터베이스에** 한다(`BACKUP_RESTORE_DB_URL`). 운영 DB에
 *   복원하는 자동화는 만들지 않는다 — 검증하려다 데이터를 잃는 것이 최악이다.
 * - 대상 DB가 없으면 **실패가 아니라 미구성**으로 알린다. 못 한 것과
 *   실패한 것은 다르다.
 * - 보존 기간이 지난 덤프만 지운다. 지울 때도 **최근 N개는 남긴다**.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  get directory(): string {
    return process.env.BACKUP_DIR?.trim() || "/var/backups/acos";
  }

  get retentionDays(): number {
    const raw = Number(process.env.BACKUP_RETENTION_DAYS);
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 14;
  }

  /** 보존 기간이 지나도 최소 이만큼은 남긴다 — 정리가 마지막 백업을 지우면 안 된다 */
  get keepMinimum(): number {
    const raw = Number(process.env.BACKUP_KEEP_MINIMUM);
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 3;
  }

  private get timeoutMs(): number {
    const raw = Number(process.env.BACKUP_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_TIMEOUT_MS;
  }

  /**
   * 복원 검증용 별도 DB — 없으면 검증을 "미구성"으로 남긴다.
   *
   * **운영 DB를 가리키면 null을 돌려준다** (CTO 결정 1601-②). 복원은 대상을
   * 지우고 쓰므로, 잘못 지정된 설정을 그대로 실행하면 검증이 곧 사고가 된다.
   * 기동 시 환경 검증이 이미 막지만, 실행 직전에 한 번 더 본다 — 설정은
   * 기동 후에도 바뀔 수 있다.
   */
  get restoreTarget(): string | null {
    const raw = process.env.BACKUP_RESTORE_DB_URL?.trim();
    if (!raw) {
      return null;
    }
    if (this.restoreTargetSafety.verdict === "same-as-production") {
      return null;
    }
    return BackupService.toLibpqUrl(raw);
  }

  /** 복원 대상이 운영 DB와 분리되어 있는가 (CTO 결정 1601-②) */
  get restoreTargetSafety(): ReturnType<typeof judgeRestoreTarget> {
    return judgeRestoreTarget(
      process.env.DATABASE_URL,
      process.env.BACKUP_RESTORE_DB_URL,
    );
  }

  /** 백업을 오브젝트 저장소에도 올릴 것인가 */
  get offsiteEnabled(): boolean {
    const value = (process.env.BACKUP_OFFSITE ?? "").trim().toLowerCase();
    return ["on", "1", "true", "yes"].includes(value);
  }

  private get offsitePrefix(): string {
    const raw = process.env.BACKUP_OFFSITE_PREFIX?.trim() || "backups/";
    return raw.endsWith("/") ? raw : `${raw}/`;
  }

  /** 백업 신선도 한계 (CTO 결정 1601-⑤ — 기본 2일) */
  get maxBackupAgeMs(): number {
    const raw = Number(process.env.BACKUP_MAX_AGE_HOURS);
    return Number.isFinite(raw) && raw > 0
      ? raw * 60 * 60 * 1000
      : 48 * 60 * 60 * 1000;
  }

  /** 복원 검증 신선도 한계 (CTO 결정 1601-⑤ — 기본 8일) */
  get maxRestoreAgeMs(): number {
    const raw = Number(process.env.RESTORE_MAX_AGE_HOURS);
    return Number.isFinite(raw) && raw > 0
      ? raw * 60 * 60 * 1000
      : 192 * 60 * 60 * 1000;
  }

  /**
   * 손실 한도 목표 — 지정하지 않으면 **백업 간격의 2배**를 쓴다
   * (CTO 결정 1701-①). 간격을 바꿨는데 목표가 굳어 있으면 백업이 오래 멈춰도
   * "정상"으로 보인다.
   */
  get rpoTargetMs(): number {
    const raw = Number(process.env.BACKUP_RPO_HOURS);
    if (Number.isFinite(raw) && raw > 0) {
      return raw * 60 * 60 * 1000;
    }
    const backup = resolveSchedules(
      process.env as Record<string, string | undefined>,
    ).find((entry) => entry.job === "backup");
    return defaultRpoTargetMs(
      backup?.intervalMs ?? DEFAULT_JOB_INTERVALS.backup,
    );
  }

  /** 서버 기동 시각 — 그 이전 구간은 사슬 판정에서 제외한다 */
  private readonly startedAt = Date.now();

  /** 백업 예약 간격 — 사슬 판정의 기준 */
  get backupIntervalMs(): number {
    const backup = resolveSchedules(
      process.env as Record<string, string | undefined>,
    ).find((entry) => entry.job === "backup");
    return backup?.intervalMs ?? DEFAULT_JOB_INTERVALS.backup;
  }

  /**
   * 사슬 관측 창 (TASK-2101, CTO 결정 2001-①).
   *
   * `BACKUP_CHAIN_WINDOW_HOURS`로 설정하되 **간격의 4배 미만이면 올린다** —
   * 표본이 없는 판정은 판정이 아니다. 올렸다는 사실은 숨기지 않는다.
   */
  get chainWindow(): ChainWindowResolution {
    return resolveChainWindowMs(
      process.env.BACKUP_CHAIN_WINDOW_HOURS,
      this.backupIntervalMs,
    );
  }

  /** 원격 대조 예약 간격 — 낡음 판정의 기준 (CTO 결정 2001-②) */
  get remoteVerifyIntervalMs(): number {
    const schedule = resolveSchedules(
      process.env as Record<string, string | undefined>,
    ).find((entry) => entry.job === "remote-verify");
    return (
      schedule?.intervalMs ?? DEFAULT_JOB_INTERVALS["remote-verify"]
    );
  }

  /**
   * 운영 데이터베이스 크기 (CTO 결정 1901-④).
   *
   * 덤프 크기와 다르다 — 덤프는 압축되고 인덱스를 담지 않는다. 재평가 기준은
   * **운영 DB 크기**로 판단해야 한다.
   */
  async databaseSizeBytes(): Promise<number | null> {
    try {
      const rows = (await this.prisma.$queryRawUnsafe(
        "SELECT pg_database_size(current_database()) AS size",
      )) as { size: bigint | number }[];
      const raw = rows[0]?.size;
      return raw === undefined ? null : Number(raw);
    } catch {
      // 권한이 없거나 다른 엔진이면 모른다 — 0으로 채우지 않는다
      return null;
    }
  }

  /**
   * 원격 사본 무결성 검증 (TASK-2001, CTO 결정 1701-④ 후속 · 2001-②).
   *
   * 원격에서 **실제로 내려받아** 체크섬을 대조한다. **마지막 백업 1건만**
   * 본다 — 전송 비용이 드는 확인을 이력 전체에 돌릴 이유가 없다.
   *
   * TASK-2101부터 **결과를 남긴다.** 남기지 않으면 주 1회 자동 대조를 돌려도
   * 화면은 계속 "확인하지 않았습니다"라고 말한다.
   */
  async verifyRemoteCopy(): Promise<RemoteIntegrity> {
    const batch = await this.verifyRemoteCopies(AUTO_REMOTE_VERIFY_COUNT);
    return (
      batch.entries[0]?.result ??
      judgeRemoteIntegrity(null)
    );
  }

  /**
   * 최근 N건 대조 (TASK-2201, CTO 결정 2101-①).
   *
   * **자동은 1건, 수동은 최대 3건.** 주기적으로 도는 것은 비용이 반복되므로
   * 최소로 두고, 사람이 필요할 때 한 번 더 보는 쪽에만 폭을 준다. 상한을
   * 두는 이유는 "전부"를 허용하면 이력이 쌓인 뒤 한 번의 클릭이 예상치 못한
   * 전송 비용이 되기 때문이다.
   */
  async verifyRemoteCopies(count: number): Promise<RemoteBatch> {
    const wanted = resolveRemoteVerifyCount(count);
    const targets = (await this.backupHistory(50))
      .filter((entry) => entry.ok && entry.offsite && entry.fileName)
      .slice(0, wanted);

    const entries: RemoteBatchEntry[] = [];
    for (const target of targets) {
      let result: RemoteIntegrity;
      try {
        const key = `${this.offsitePrefix}${target.fileName}`;
        const buffer = await this.storage.getBackupObject(key);
        const hash = createHash("sha256").update(buffer).digest("hex");
        result = judgeRemoteIntegrity({
          found: true,
          remoteChecksum: hash,
          recordedChecksum: target.checksum,
        });
      } catch (error) {
        this.logger.error(
          `원격 사본 검증 실패(${target.fileName}): ${error instanceof Error ? error.message : String(error)}`,
        );
        result = judgeRemoteIntegrity({
          found: false,
          remoteChecksum: null,
          recordedChecksum: target.checksum,
        });
      }
      // 건마다 남긴다 — 어느 백업이 온전한지가 복구 시점 선택의 근거다
      await this.recordRemoteVerdict(target.id, result.verdict);
      entries.push({ fileName: target.fileName, result });
    }

    return summarizeRemoteBatch(entries);
  }

  private async recordRemoteVerdict(
    id: string,
    verdict: RemoteIntegrity["verdict"],
  ): Promise<void> {
    try {
      await this.prisma.backupRun.update({
        where: { id },
        data: { remoteCheckedAt: new Date(), remoteVerdict: verdict },
      });
    } catch (error) {
      // 기록 실패가 대조 결과를 무효로 만들지는 않는다 — 다만 조용히 넘기지 않는다
      this.logger.warn(
        `원격 대조 결과 기록 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 마지막으로 기록된 원격 대조 결과 (CTO 결정 2001-②).
   *
   * 판정은 core가 한다 — 여기서는 **읽어 오기만** 한다.
   */
  async lastRemoteRecord(): Promise<RemoteRecord | null> {
    try {
      const row = (await this.prisma.backupRun.findFirst({
        where: { remoteCheckedAt: { not: null } },
        orderBy: { remoteCheckedAt: "desc" },
      })) as {
        fileName: string | null;
        remoteCheckedAt: Date | null;
        remoteVerdict: string | null;
      } | null;
      if (!row?.remoteCheckedAt || !row.remoteVerdict) {
        return null;
      }
      return {
        verdict: row.remoteVerdict as RemoteRecord["verdict"],
        checkedAt: row.remoteCheckedAt.getTime(),
        fileName: row.fileName,
      };
    } catch {
      return null;
    }
  }

  get rtoTargetMs(): number {
    const raw = Number(process.env.BACKUP_RTO_MINUTES);
    return Number.isFinite(raw) && raw > 0 ? raw * 60 * 1000 : 30 * 60 * 1000;
  }

  /**
   * `pg_dump`/`psql`에 넘길 수 있는 연결 문자열.
   *
   * Prisma의 `DATABASE_URL`에는 `?schema=public` 같은 **Prisma 전용 파라미터**가
   * 붙는데, `pg_dump`는 이를 `invalid URI query parameter`로 거부한다.
   * 라이브 검증에서 이 실패를 발견해 제거하도록 고쳤다.
   */
  static toLibpqUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // libpq가 아는 파라미터만 남긴다
      const allowed = new Set([
        "sslmode",
        "connect_timeout",
        "application_name",
        "options",
      ]);
      for (const key of [...parsed.searchParams.keys()]) {
        if (!allowed.has(key)) {
          parsed.searchParams.delete(key);
        }
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /** 파일명만 노출한다 — 절대 경로는 서버 구조를 드러낸다 */
  private fileName(now: Date): string {
    return `acos-${now.toISOString().replace(/[:.]/g, "-")}.dump`;
  }

  /**
   * 백업 1회 — `pg_dump`로 custom 형식 덤프를 만든다.
   * 실패해도 예외를 던지지 않고 이력에 남긴다(예약 실행이 죽으면 안 된다).
   */
  async backup(trigger: "schedule" | "manual" = "manual"): Promise<BackupRunDto> {
    const startedAt = Date.now();
    const url = process.env.DATABASE_URL;
    const name = this.fileName(new Date());

    if (!url) {
      return this.recordBackup({
        ok: false,
        sizeBytes: null,
        fileName: null,
        durationMs: 0,
        trigger,
        error: "DATABASE_URL이 없습니다.",
        checksum: null,
        integrityOk: null,
        entries: null,
        offsiteKey: null,
      });
    }

    try {
      await mkdir(this.directory, { recursive: true });
      const target = join(this.directory, name);
      await run(
        "pg_dump",
        ["--format=custom", "--file", target, BackupService.toLibpqUrl(url)],
        {
          timeout: this.timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const info = await stat(target);

      // 받자마자 확인한다 — 읽히지 않는 덤프를 복원 시점에 알면 늦다
      const integrity = await this.inspect(target);
      const checksum = await this.checksum(target);
      const offsiteKey = await this.replicate(name, target);
      await this.prune();

      return this.recordBackup({
        ok: true,
        sizeBytes: info.size,
        fileName: name,
        durationMs: Date.now() - startedAt,
        trigger,
        error: null,
        checksum,
        integrityOk: integrity.readable,
        entries: integrity.entries,
        offsiteKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`백업 실패: ${message}`);
      return this.recordBackup({
        ok: false,
        sizeBytes: null,
        fileName: null,
        durationMs: Date.now() - startedAt,
        trigger,
        error: message.slice(0, 500),
        checksum: null,
        integrityOk: null,
        entries: null,
        offsiteKey: null,
      });
    }
  }

  /**
   * 덤프 무결성 판독 — `pg_restore --list`로 목차를 읽어 본다.
   *
   * 복원하지 않고도 **파일이 온전한지**를 알 수 있는 가장 싼 검사다.
   * 읽히지 않으면 그 백업은 존재하지만 쓸 수 없는 파일이다.
   */
  private async inspect(
    path: string,
  ): Promise<{ readable: boolean; entries: number | null }> {
    try {
      const { stdout } = await run("pg_restore", ["--list", path], {
        timeout: this.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      });
      const entries = stdout
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith(";")).length;
      // 목차가 비어 있으면 읽힌 것이 아니다
      return { readable: entries > 0, entries };
    } catch (error) {
      this.logger.error(
        `덤프 판독 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { readable: false, entries: null };
    }
  }

  /** SHA-256 — 원격 사본이 같은 파일인지 확인할 근거 */
  private async checksum(path: string): Promise<string | null> {
    try {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) {
        hash.update(chunk as Buffer);
      }
      return hash.digest("hex");
    } catch {
      // 체크섬을 못 구한 것이 백업을 실패시키지는 않는다
      return null;
    }
  }

  /**
   * 원격 복제 — 덤프를 오브젝트 저장소에도 올린다.
   *
   * 백업이 데이터베이스와 **같은 곳에만** 있으면, 그 곳이 사라질 때 백업도
   * 사라진다. 복제 실패가 백업을 실패시키지는 않지만(덤프는 이미 있다),
   * 로그로 남기고 화면에서 드러낸다.
   */
  private async replicate(
    name: string,
    path: string,
  ): Promise<string | null> {
    if (!this.offsiteEnabled) {
      return null;
    }
    try {
      // 이미지 버킷이 아니라 **백업 전용 버킷**에 올린다 (CTO 결정 1701-②)
      const key = `${this.offsitePrefix}${name}`;
      await this.storage.putBackupObject(key, await readFile(path));
      return key;
    } catch (error) {
      this.logger.error(
        `백업 원격 복제 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 보존 기간이 지난 덤프 삭제 — 최근 N개는 반드시 남긴다 */
  private async prune(): Promise<number> {
    try {
      const names = (await readdir(this.directory)).filter((file) =>
        file.endsWith(".dump"),
      );
      const files = await Promise.all(
        names.map(async (file) => ({
          file,
          mtime: (await stat(join(this.directory, file))).mtimeMs,
        })),
      );
      files.sort((a, b) => b.mtime - a.mtime);

      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      // 최근 keepMinimum개는 나이와 무관하게 남긴다
      const candidates = files.slice(this.keepMinimum);
      let removed = 0;
      for (const entry of candidates) {
        if (entry.mtime < cutoff) {
          await rm(join(this.directory, entry.file), { force: true });
          removed += 1;
        }
      }
      return removed;
    } catch (error) {
      // 정리 실패가 백업을 실패시키지는 않는다
      this.logger.warn(
        `백업 정리 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * 복원 검증 1회 — 최신 덤프를 **별도 DB**에 복원하고 테이블 수를 센다.
   *
   * 운영 DB에는 절대 복원하지 않는다. 대상이 없으면 실패가 아니라
   * **미구성**으로 남긴다 — 못 한 것과 실패한 것은 다르다.
   */
  async verifyRestore(
    trigger: "schedule" | "manual" = "manual",
  ): Promise<RestoreRunDto & { configured: boolean }> {
    const startedAt = Date.now();
    const target = this.restoreTarget;

    if (!target) {
      return {
        ...toRestoreDto({
          id: "not-configured",
          ok: false,
          tables: null,
          fileName: null,
          durationMs: 0,
          trigger,
          error: "BACKUP_RESTORE_DB_URL이 없어 복원 검증을 하지 않았습니다.",
          createdAt: new Date(),
        }),
        configured: false,
      };
    }

    let name: string | null = null;
    try {
      const files = (await readdir(this.directory))
        .filter((file) => file.endsWith(".dump"))
        .sort();
      name = files.at(-1) ?? null;
      if (!name) {
        throw new Error("복원할 덤프가 없습니다 — 먼저 백업을 받으세요.");
      }

      // 깨끗한 상태에서 복원한다 — 이전 검증 잔재가 결과를 속이면 안 된다
      await run(
        "pg_restore",
        ["--clean", "--if-exists", "--no-owner", "--dbname", target, join(this.directory, name)],
        { timeout: this.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      ).catch(async (error: unknown) => {
        // pg_restore는 무해한 경고에도 비영점 종료할 수 있다 —
        // 실제 판정은 아래 테이블 수로 한다
        this.logger.warn(
          `pg_restore 경고: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
        );
      });

      const { stdout } = await run(
        "psql",
        [
          "--tuples-only",
          "--no-align",
          "--command",
          "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
          target,
        ],
        { timeout: this.timeoutMs },
      );
      const tables = Number(stdout.trim());
      if (!Number.isFinite(tables) || tables <= 0) {
        throw new Error(`복원 후 테이블이 없습니다 (${stdout.trim()}).`);
      }

      return {
        ...(await this.recordRestore({
          ok: true,
          tables,
          fileName: name,
          durationMs: Date.now() - startedAt,
          trigger,
          error: null,
        })),
        configured: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`복원 검증 실패: ${message}`);
      return {
        ...(await this.recordRestore({
          ok: false,
          tables: null,
          fileName: name,
          durationMs: Date.now() - startedAt,
          trigger,
          error: message.slice(0, 500),
        })),
        configured: true,
      };
    }
  }

  private async recordBackup(entry: {
    ok: boolean;
    sizeBytes: number | null;
    fileName: string | null;
    durationMs: number;
    trigger: string;
    error: string | null;
    checksum: string | null;
    integrityOk: boolean | null;
    entries: number | null;
    offsiteKey: string | null;
  }): Promise<BackupRunDto> {
    try {
      const row = (await this.prisma.backupRun.create({
        data: {
          ...entry,
          sizeBytes: entry.sizeBytes === null ? null : BigInt(entry.sizeBytes),
        },
      })) as BackupRow;
      return toBackupDto(row);
    } catch (error) {
      this.logger.warn(
        `백업 이력 기록 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      const { offsiteKey, ...rest } = entry;
      return {
        id: "unrecorded",
        ...rest,
        offsite: Boolean(offsiteKey),
        createdAt: new Date().toISOString(),
      };
    }
  }

  private async recordRestore(entry: {
    ok: boolean;
    tables: number | null;
    fileName: string | null;
    durationMs: number;
    trigger: string;
    error: string | null;
  }): Promise<RestoreRunDto> {
    try {
      const row = (await this.prisma.restoreRun.create({
        data: entry,
      })) as RestoreRow;
      return toRestoreDto(row);
    } catch (error) {
      this.logger.warn(
        `복원 검증 이력 기록 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        id: "unrecorded",
        ...entry,
        createdAt: new Date().toISOString(),
      };
    }
  }

  async backupHistory(limit = 10): Promise<BackupRunDto[]> {
    const rows = (await this.prisma.backupRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    })) as BackupRow[];
    return rows.map(toBackupDto);
  }

  /**
   * 관측 창 안의 백업 기록 — **개수가 아니라 기간으로 읽는다.**
   *
   * 개수로 자르면 창 안의 오래된 쪽이 통째로 빠져 **없는 공백이 생긴다.**
   * 20초 간격으로 돌리자 창 안 4320건 중 500건만 읽혀 21시간짜리 가짜 공백이
   * 보고됐다(라이브 검증에서 드러난 결함).
   */
  async backupHistorySince(sinceMs: number): Promise<BackupRunDto[]> {
    const rows = (await this.prisma.backupRun.findMany({
      where: { createdAt: { gte: new Date(sinceMs) } },
      orderBy: { createdAt: "desc" },
    })) as BackupRow[];
    return rows.map(toBackupDto);
  }

  async restoreHistory(limit = 10): Promise<RestoreRunDto[]> {
    const rows = (await this.prisma.restoreRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    })) as RestoreRow[];
    return rows.map(toRestoreDto);
  }

  /**
   * 백업·복원 건강 판정 (core 순수 로직).
   *
   * TASK-1701부터 무결성·원격 복제·복구 목표(RPO·RTO)도 함께 판정한다.
   */
  async health(): Promise<{
    backup: BackupHealth;
    restore: RestoreHealth;
    integrity: ReturnType<typeof judgeIntegrity>;
    offsite: OffsiteHealth;
    objectives: RecoveryObjectives;
    performance: BackupPerformance;
    chain: BackupChain;
    scale: DatabaseScale;
    chainWindow: ChainWindowResolution;
    remoteRecord: RemoteRecord | null;
  }> {
    const now = Date.now();
    const chainWindow = this.chainWindow;
    const [backups, restores, chainRecords, remoteRecord] = await Promise.all([
      this.backupHistory(20),
      this.restoreHistory(20),
      // 사슬 판정은 관측 창 전체를 **기간으로** 읽는다 — 개수로 자르면
      // 창 안의 오래된 쪽이 빠져 없는 공백이 생긴다
      this.backupHistorySince(now - chainWindow.windowMs),
      this.lastRemoteRecord(),
    ]);

    const backup = judgeBackup(
      backups.map((entry) => ({
        ok: entry.ok,
        sizeBytes: entry.sizeBytes,
        createdAt: new Date(entry.createdAt).getTime(),
      })),
      { now, maxAgeMs: this.maxBackupAgeMs },
    );
    const restore = judgeRestore(
      restores.map((entry) => ({
        ok: entry.ok,
        tables: entry.tables,
        createdAt: new Date(entry.createdAt).getTime(),
      })),
      { now, maxAgeMs: this.maxRestoreAgeMs },
    );

    const latestOk = backups.find((entry) => entry.ok) ?? null;
    // RTO는 **측정치**다 — 마지막으로 성공한 복원에 실제로 걸린 시간
    const measuredRestore = restores.find((entry) => entry.ok) ?? null;

    return {
      backup,
      restore,
      integrity: judgeIntegrity({
        readable: latestOk?.integrityOk ?? null,
        checksum: latestOk?.checksum ?? null,
        entries: latestOk?.entries ?? null,
      }),
      offsite: judgeOffsite({
        configured: this.offsiteEnabled,
        latestReplicated: latestOk === null ? null : latestOk.offsite,
        copies: backups.filter((entry) => entry.offsite).length,
      }),
      objectives: judgeRecoveryObjectives({
        lastBackupAgeMs: backup.ageMs,
        measuredRestoreMs: measuredRestore?.durationMs ?? null,
        rpoTargetMs: this.rpoTargetMs,
        rtoTargetMs: this.rtoTargetMs,
      }),
      // 백업 소요 시간 (CTO 결정 1801-①) — 관측만 하던 값에 기준을 붙였다
      performance: judgeBackupPerformance(
        backups.map((entry) => ({
          ok: entry.ok,
          durationMs: entry.durationMs,
          createdAt: new Date(entry.createdAt).getTime(),
        })),
      ),
      // 백업 사슬 (TASK-2001) — 개별 백업이 모두 성공이어도 사슬은 끊길 수 있다
      chain: judgeBackupChain(
        chainRecords.map((entry) => ({
          ok: entry.ok,
          createdAt: new Date(entry.createdAt).getTime(),
        })),
        {
          now,
          intervalMs: this.backupIntervalMs,
          windowMs: chainWindow.windowMs,
          startedAt: this.startedAt,
        },
      ),
      scale: judgeDatabaseScale(await this.databaseSizeBytes()),
      chainWindow,
      remoteRecord,
    };
  }

  /** 저장 위치 표시용 — 파일명만, 절대 경로는 노출하지 않는다 */
  describeDirectory(): string {
    return basename(this.directory);
  }
}
