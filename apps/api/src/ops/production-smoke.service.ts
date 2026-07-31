import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  SMOKE_TARGETS,
  SMOKE_TARGET_TITLES,
  judgeSmokeProbe,
  resolveCallTarget,
  summarizeSmoke,
} from "@acos/core";
import type {
  EgressStatus,
  OcrProvider,
  SmokeProbe,
  SmokeResult,
  SmokeSummary,
} from "@acos/core";
import type { SmokeReportDto } from "@acos/shared";
import { RequestContextService } from "../common/request-context.service";
import { LlmService } from "../llm/llm.service";
import { OCR_PROVIDER } from "../ocr/ocr.constants";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { EgressService } from "./egress.service";

/**
 * 운영 스모크. (TASK-3701, Sprint 37 — CTO 정책 3701-②)
 *
 * LLM · OCR · S3를 **실제로 한 번씩 불러** 봅니다. 지금까지의 판정은 전부
 * 간접 증거였습니다 — 키 형식, 주소, TCP 도달, DB 성공 기록. 그 넷을 다
 * 통과하고도 결제 정지·모델 접근 거부·버킷 쓰기 권한 없음은 보이지 않습니다.
 * 그런 것들은 **불러야만** 보입니다.
 *
 * ## 왜 예약으로 돌리지 않는가
 *
 * 실 호출은 돈이 나갑니다. 사람이 명시적으로 누를 때만 돕니다
 * (결정 1301-①과 같은 판단). 그래서 누가 눌렀는지도 함께 적습니다.
 *
 * ## 무엇을 부르는가
 *
 * 가장 작은 호출입니다 — 토큰 몇 개짜리 완성, 1x1 PNG 인식, 수십 바이트
 * 오브젝트 쓰기·읽기·삭제. 검증에 필요한 최소치를 넘겨 쓰지 않습니다.
 *
 * 판정은 `@acos/core`가 합니다. 여기서는 **부르고, 무슨 일이 있었는지 그대로
 * 넘길** 뿐입니다 — 성공을 통과로 바꾸는 판단은 어댑터가 하지 않습니다.
 */
@Injectable()
export class ProductionSmokeService {
  private readonly logger = new Logger(ProductionSmokeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly storage: StorageService,
    @Inject(OCR_PROVIDER) private readonly ocr: OcrProvider,
    // 실패가 **길** 때문인지 보려고 도달 점검을 함께 읽는다 (라이브 검증)
    private readonly egress: EgressService,
    @Optional() private readonly context?: RequestContextService,
  ) {}

  /** 마지막 스모크 결과 — 아직 한 번도 안 돌렸으면 빈 목록 */
  async latest(): Promise<SmokeReportDto> {
    const rows = await this.prisma.smokeRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    // 대상별 **가장 최근 1건**으로 요약한다 — 어제의 통과와 오늘의 실패를
    // 함께 세면 "1/2 통과" 같은 무의미한 숫자가 나온다.
    //
    // 그리고 **한 번도 안 돌린 대상도 자리를 차지한다.** 그러지 않으면 둘만
    // 돌린 상태가 "2/2 통과"로 읽힌다 — 안 돌린 것이 통과가 되는, 우리가
    // 가장 경계해 온 셈법이다.
    const results: SmokeResult[] = SMOKE_TARGETS.map((target) => {
      const row = rows.find((candidate) => candidate.target === target);
      if (row === undefined) {
        return {
          target,
          title: SMOKE_TARGET_TITLES[target],
          status: "skipped" as const,
          provider: "-",
          baseUrl: null,
          latencyMs: null,
          detail: "한 번도 돌린 적이 없습니다.",
          next: "POST /ops/smoke로 실제 호출을 한 번 돌리세요.",
        };
      }
      return {
        target,
        title: SMOKE_TARGET_TITLES[target],
        status: row.status as SmokeResult["status"],
        provider: row.provider,
        baseUrl: row.baseUrl,
        latencyMs: row.latencyMs,
        detail: row.detail,
        next: "",
      };
    });

    return {
      ...toDto(summarizeSmoke(results)),
      history: rows.map((row) => ({
        id: row.id,
        target: row.target,
        status: row.status,
        provider: row.provider,
        baseUrl: row.baseUrl,
        latencyMs: row.latencyMs,
        detail: row.detail,
        createdAt: row.createdAt.toISOString(),
      })),
      ranAt: rows[0]?.createdAt.toISOString() ?? null,
    };
  }

  /**
   * 스모크를 돌린다 — **실제 호출이 발생하고 과금될 수 있습니다.**
   */
  async run(actorId?: string): Promise<SmokeReportDto> {
    const probes = [await this.probeLlm(), await this.probeOcr(), await this.probeStorage()];
    // 실패한 호출에 한해 **길** 상태를 붙인다 — 키를 먼저 의심하지 않도록.
    // 점검을 못 읽으면 `null`로 두고, 모르는 것을 "열려 있었다"로 바꾸지 않는다.
    const paths = await this.egressByHost();
    const results = probes
      .map((probe) => ({ ...probe, pathStatus: pathOf(probe, paths) }))
      .map(judgeSmokeProbe);
    const requestId = this.context?.current()?.requestId ?? null;

    for (const result of results) {
      await this.prisma.smokeRun.create({
        data: {
          target: result.target,
          status: result.status,
          provider: result.provider,
          baseUrl: result.baseUrl,
          latencyMs: result.latencyMs,
          detail: result.detail,
          actorId: actorId ?? null,
          requestId,
        },
      });
    }

    const summary = summarizeSmoke(results);
    this.logger.log(`운영 스모크: ${summary.detail}`);
    const report = await this.latest();
    return { ...report, ...toDto(summary) };
  }

  /** 호스트별 도달 점검 — 못 읽으면 빈 목록(모른다) */
  private async egressByHost(): Promise<Map<string, EgressStatus>> {
    const map = new Map<string, EgressStatus>();
    try {
      for (const probe of await this.egress.probe()) {
        map.set(probe.host, probe.status);
      }
    } catch (error) {
      this.logger.warn(`도달 점검을 읽지 못했습니다: ${String(error)}`);
    }
    return map;
  }

  /** LLM 실 호출 — 가장 짧은 완성 1회 */
  private async probeLlm(): Promise<SmokeProbe> {
    const provider = (process.env.LLM_PROVIDER ?? "mock").trim().toLowerCase();
    if (provider === "mock") {
      return {
        target: "llm",
        provider,
        baseUrl: null,
        attempted: false,
        ok: false,
        latencyMs: null,
        detail: "LLM_PROVIDER=mock — 실 Provider를 부르지 않습니다.",
      };
    }

    const target = resolveCallTarget(provider, process.env as Record<string, string | undefined>);
    const startedAt = Date.now();
    try {
      const completion = await this.llm.complete(
        { messages: [{ role: "user", content: "ping" }], maxTokens: 8 },
        { provider, failover: false, diagnostic: true, feature: "dev" },
      );
      return {
        target: "llm",
        provider,
        baseUrl: target.baseUrl,
        attempted: true,
        ok: true,
        latencyMs: Date.now() - startedAt,
        detail: `${completion.provider}/${completion.model} 응답 수신`,
      };
    } catch (error) {
      return {
        target: "llm",
        provider,
        baseUrl: target.baseUrl,
        attempted: true,
        ok: false,
        latencyMs: Date.now() - startedAt,
        detail: String(error instanceof Error ? error.message : error).slice(0, 500),
      };
    }
  }

  /** OCR 실 호출 — 1x1 PNG 1장 */
  private async probeOcr(): Promise<SmokeProbe> {
    const provider = this.ocr.name;
    if (provider === "mock") {
      return {
        target: "ocr",
        provider,
        baseUrl: null,
        attempted: false,
        ok: false,
        latencyMs: null,
        detail: "OCR_PROVIDER=mock — 이미지에서 글자를 읽지 않습니다.",
      };
    }

    const target = resolveCallTarget(provider, process.env as Record<string, string | undefined>);
    const startedAt = Date.now();
    try {
      const recognition = await this.ocr.recognize(SMOKE_PNG, "image/png");
      return {
        target: "ocr",
        provider,
        baseUrl: target.baseUrl,
        attempted: true,
        ok: true,
        latencyMs: Date.now() - startedAt,
        // 1x1 이미지에서 글자가 안 나오는 것은 **정상**이다 — 여기서 보는
        // 것은 "인식이 됐는가"가 아니라 "호출이 성립하는가"다
        detail: `응답 수신 (추출 ${recognition.text.length}자 — 1x1 이미지이므로 0자가 정상입니다)`,
      };
    } catch (error) {
      return {
        target: "ocr",
        provider,
        baseUrl: target.baseUrl,
        attempted: true,
        ok: false,
        latencyMs: Date.now() - startedAt,
        detail: String(error instanceof Error ? error.message : error).slice(0, 500),
      };
    }
  }

  /**
   * S3 실 호출 — 쓰기·읽기·삭제.
   *
   * 존재 확인만으로는 부족합니다. 운영에서 실제로 깨지는 것은 **쓰기 권한**
   * 이고, 그것은 `bucketExists`로 보이지 않습니다.
   */
  private async probeStorage(): Promise<SmokeProbe> {
    const baseUrl = storageOrigin(process.env.S3_ENDPOINT);

    const key = `ops/smoke/${Date.now()}.txt`;
    const payload = Buffer.from("acos production smoke\n", "utf8");
    const startedAt = Date.now();
    try {
      await this.storage.putObject(key, payload, "text/plain");
      const read = await this.storage.getObject(key);
      const same = read.equals(payload);
      await this.storage.removeObjects([key]);
      return {
        target: "storage",
        provider: "s3",
        baseUrl,
        attempted: true,
        // 읽은 내용이 다르면 **성공이 아니다** — 200을 받았다는 것과 저장된
        // 것이 우리가 쓴 것이라는 사실은 다르다
        ok: same,
        latencyMs: Date.now() - startedAt,
        detail: same
          ? `버킷 ${this.storage.bucket}에 쓰기·읽기·삭제 성공`
          : "쓴 내용과 읽은 내용이 다릅니다.",
      };
    } catch (error) {
      return {
        target: "storage",
        provider: "s3",
        baseUrl,
        attempted: true,
        ok: false,
        latencyMs: Date.now() - startedAt,
        detail: String(error instanceof Error ? error.message : error).slice(0, 500),
      };
    }
  }
}

/**
 * 이 호출이 간 주소의 **길** 상태 — 점검하지 않았으면 `null`.
 *
 * 성공한 호출에는 붙이지 않습니다: 길이 열려 있었다는 것은 성공 자체로
 * 증명됐고, 굳이 적으면 문장만 길어집니다.
 */
function pathOf(
  probe: SmokeProbe,
  paths: Map<string, EgressStatus>,
): EgressStatus | null {
  if (probe.ok || probe.baseUrl === null) {
    return null;
  }
  try {
    return paths.get(new URL(probe.baseUrl).hostname) ?? null;
  } catch {
    return null;
  }
}

/**
 * 저장소 주소의 기준점 — 읽을 수 없으면 `null`.
 *
 * `null`은 "공식이었다"가 아니라 **"모른다"** 이고, 판정은 모르는 것을
 * 통과로 세지 않습니다.
 */
function storageOrigin(endpoint: string | undefined): string | null {
  const value = (endpoint ?? "").trim();
  if (value === "") {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** 1x1 투명 PNG — 검증에 필요한 최소치. 남의 서비스에 큰 것을 보내지 않는다 */
const SMOKE_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function toDto(summary: SmokeSummary): Omit<SmokeReportDto, "history" | "ranAt"> {
  return {
    results: summary.results.map((result) => ({
      target: result.target,
      title: result.title,
      status: result.status,
      provider: result.provider,
      baseUrl: result.baseUrl,
      latencyMs: result.latencyMs,
      detail: result.detail,
      next: result.next,
    })),
    passed: summary.passed,
    total: summary.total,
    ok: summary.ok,
    detail: summary.detail,
  };
}
