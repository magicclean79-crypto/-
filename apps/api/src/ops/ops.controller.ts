import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  DRILL_TRIGGERS,
  MAX_MANUAL_REMOTE_VERIFY_COUNT,
  resolveRemoteVerifyCount,
  SCHEDULED_JOBS,
  summarizeAlerts,
} from "@acos/core";
import type {
  PricingStage,
  DrillTrigger as ScheduledDrillTrigger,
  ScheduledJob,
} from "@acos/core";
import type {
  ActivationHistoryDto,
  OperationsKpiDto,
  OpsAuditDto,
  OpsEventDto,
  OpsSettingsDto,
  AdvancePricingRequest,
  AlertArchiveResultDto,
  AlertBoardDto,
  AlertHistoryDto,
  BillingReportDto,
  CheckRunResultDto,
  CostForecastDto,
  PricingBoardDto,
  PricingDetectionDto,
  PricingProposalDto,
  ProposePricingRequest,
  NotificationDeliveryDto,
  NotificationQueueStatusDto,
  DrillRequirementDto,
  IncidentBoardDto,
  IncidentDto,
  OperationsReadinessDto,
  ProductionActivationDto,
  ProductionCutoverDto,
  ProviderRolloutDto,
  RecoveryDrillDto,
  RemoteVerifyResultDto,
  SmokeReportDto,
  SmtpValidationDto,
  // TASK-4001 (CTO 정책 4001-①②③④⑤⑥)
  DiagnosticReportDto,
  DraftLifecycleDto,
  KpiSettingChangeDto,
  KpiTrendReportDto,
  ValidationPlanDto,
  // TASK-4101 (CTO 정책 4101-①~⑥)
  DiagnosticRunDto,
  DraftRevivalSummaryDto,
  ValidationRunDto,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.guard";
import { ProviderProductionService } from "../llm/provider-production.service";
import { PricingService } from "../pricing/pricing.service";
import { StorageService } from "../storage/storage.service";
import { AlertService } from "./alert.service";
import { BackupService } from "./backup.service";
import { CostIntelligenceService } from "./cost-intelligence.service";
import { ActivationHistoryService } from "./activation-history.service";
import { IncidentService } from "./incident.service";
import { IncidentPromotionService } from "./incident-promotion.service";
import { KpiService } from "./kpi.service";
import { OpsSettingsService } from "./ops-settings.service";
import { OpsAuditInterceptor, OpsAuditService } from "./ops-audit.interceptor";
import { OpsEventService } from "./ops-event.service";
import { ProductionCutoverService } from "./production-cutover.service";
import { ProductionSmokeService } from "./production-smoke.service";
import { DistributedLockService } from "./distributed-lock.service";
import { NotificationQueueService } from "./notification-queue.service";
import { NotificationService } from "./notification.service";
import { RecoveryDrillService } from "./recovery-drill.service";
import { RecoveryEvaluationService } from "./recovery-evaluation.service";
import { ScheduledChecksService } from "./scheduled-checks.service";
import { DiagnosticsService } from "./diagnostics.service";
import { DraftLifecycleService } from "./draft-lifecycle.service";
import { KpiTrendService } from "./kpi-trend.service";
import { ValidationPlanService } from "./validation-plan.service";
import { DraftRevivalService } from "./draft-revival.service";
import { ValidationRunService } from "./validation-run.service";

/**
 * 단가 제안의 단계 전이 경로 (TASK-3101).
 *
 * 경로 이름을 단계 값과 따로 두는 이유: URL은 **행동**이고(`approve`) 저장되는
 * 것은 **상태**다(`APPROVED`). 둘을 같게 두면 나중에 상태 이름을 바꿀 때
 * 외부 호출이 함께 깨진다.
 */
const PRICING_ACTIONS: Record<string, PricingStage> = {
  review: "REVIEWED",
  approve: "APPROVED",
  // 2차 승인 (TASK-3301, CTO 정책 3301-②) — 다른 ADMIN의 최종 승인
  confirm: "CONFIRMED",
  apply: "APPLIED",
  reject: "REJECTED",
  // 예약 취소 (TASK-3301, CTO 정책 3301-③) — 삭제가 아니라 상태다
  cancel: "CANCELLED",
};

/**
 * 운영 자동화·경보 API. (TASK-1302, Sprint 13)
 *
 * 조회·실행 모두 **ADMIN 전용**이다 — 경보 본문에는 예산 지출·Provider
 * 구성·설정 오류가 그대로 드러나고(결정 1201-⑤와 같은 판단), 수동 실행은
 * 실제 점검을 돌린다.
 */
@Controller("ops")
@UseGuards(AuthGuard)
@RequireRole("ADMIN")
// 운영을 **바꾸는** 요청은 전부 남긴다 (TASK-3801, CTO 정책 3801-④).
// 서비스마다 부르게 하면 다음에 추가되는 엔드포인트에서 누군가 빠뜨리고,
// **빠진 감사 기록은 실패하지 않는다** — 사고가 난 뒤에야 알게 된다.
@UseInterceptors(OpsAuditInterceptor)
export class OpsController {
  constructor(
    private readonly alerts: AlertService,
    private readonly checks: ScheduledChecksService,
    private readonly notifications: NotificationService,
    private readonly queue: NotificationQueueService,
    private readonly backups: BackupService,
    private readonly drills: RecoveryDrillService,
    private readonly locks: DistributedLockService,
    private readonly storage: StorageService,
    private readonly recovery: RecoveryEvaluationService,
    // Provider 연결 순서 (TASK-2901, CTO 결정 2801-⑤)
    private readonly providers: ProviderProductionService,
    // 가격표 거버넌스·비용 인텔리전스 (TASK-3101, CTO 정책 3101-①③④)
    private readonly pricing: PricingService,
    private readonly costs: CostIntelligenceService,
    // 운영 전환 검증 (TASK-3401, CTO 지시 4·5·6)
    private readonly cutover: ProductionCutoverService,
    // 활성화 이력 · 스모크 · 장애 이력 (TASK-3701, CTO 정책 3701-①②④)
    private readonly activationHistoryService: ActivationHistoryService,
    private readonly smoke: ProductionSmokeService,
    private readonly incidents: IncidentService,
    // 운영 이벤트 · KPI · 감사 기록 (TASK-3801, CTO 정책 3801-①③④)
    private readonly events: OpsEventService,
    private readonly kpis: KpiService,
    private readonly audit: OpsAuditService,
    // 운영 설정 · 초안 승격 (TASK-3901, CTO 정책 3901-②③④⑤)
    private readonly opsSettings: OpsSettingsService,
    private readonly promotion: IncidentPromotionService,
    // KPI 추세·설정 이력 · 초안 수명 · 진단 · 검증 준비
    // (TASK-4001, CTO 정책 4001-①②③④⑤⑥)
    private readonly trends: KpiTrendService,
    private readonly drafts: DraftLifecycleService,
    private readonly diagnostics: DiagnosticsService,
    private readonly validation: ValidationPlanService,
    // 만료 초안 되살림 · 검증 실행 잠금 (TASK-4101, CTO 정책 4101-④⑤⑥)
    private readonly revival: DraftRevivalService,
    private readonly validationRun: ValidationRunService,
  ) {}

  /**
   * Provider 연결 순서 현황 (TASK-2901, CTO 결정 2801-⑤).
   *
   * 확정된 순서(OpenAI → Anthropic → Gemini → Vision → OCR)의 단계별 상태와
   * **다음에 붙일 단계**를 돌려준다.
   *
   * 판정에서 가장 중요한 것은 `unverified`를 `connected`로 세지 않는 것이다 —
   * 키 형식이 맞다는 것은 오타가 없다는 뜻일 뿐이고, 그것을 연결 완료로 세면
   * 붙지 않은 시스템이 붙은 것처럼 보고된다.
   */
  @Get("providers")
  async providerRollout(): Promise<ProviderRolloutDto> {
    return this.providers.rollout();
  }

  /**
   * 운영 전환 검증 (TASK-3401, CTO 지시 4·5·6).
   *
   * `/ops/providers`와 목적이 다르다 — 그쪽은 "어디까지 붙였는가", 이쪽은
   * **"붙은 상대가 진짜인가"** 다. 계약 스텁을 상대로 만든 성공 기록은
   * 연결의 증거가 아니고, 그것을 가려내지 못하면 화면은 붙지 않은 시스템을
   * 붙었다고 보고한다.
   */
  /**
   * 운영 활성화 판정 (TASK-3601, CTO 정책 3601-①).
   *
   * `/ops/cutover`가 "붙은 상대가 진짜인가"에 답한다면, 이쪽은
   * **"이제 운영으로 볼 수 있는가"** 에 답한다 — 자격 증명 · 네트워크 ·
   * 전환 판정 세 조건이 모두 충족될 때만 완료다.
   */
  @Get("activation")
  async productionActivation(
    @Query("branch") branch?: string,
  ): Promise<ProductionActivationDto> {
    return this.cutover.activation(branch?.trim() || undefined);
  }

  /**
   * 활성화 이력 (TASK-3701, CTO 정책 3701-①).
   *
   * `/ops/activation`이 **지금**에 답한다면, 이쪽은 **과정**에 답한다 —
   * 언제부터 이 상태인지, 되던 것이 되돌아간 적이 있는지, 그리고 이 상태가
   * 오래된 것이 확인해서인지 아무도 안 봐서인지.
   */
  @Get("activation/history")
  async activationHistory(@Query("limit") limit?: string): Promise<ActivationHistoryDto> {
    const parsed = Number(limit);
    return this.activationHistoryService.history(
      Number.isInteger(parsed) && parsed > 0 ? parsed : 50,
    );
  }

  /** 마지막 스모크 결과 (TASK-3701, CTO 정책 3701-②) — 호출하지 않는다 */
  @Get("smoke")
  async smokeReport(): Promise<SmokeReportDto> {
    return this.smoke.latest();
  }

  /**
   * 운영 스모크 실행 (TASK-3701, CTO 정책 3701-②).
   *
   * **실제 호출이 발생하고 과금될 수 있다.** 그래서 예약이 아니라 사람이
   * 누를 때만 돌고, 누가 눌렀는지 기록에 남는다 (결정 1301-①과 같은 판단).
   */
  @Post("smoke")
  @HttpCode(200)
  async runSmoke(@Req() request: AuthenticatedRequest): Promise<SmokeReportDto> {
    return this.smoke.run(request.user?.id);
  }

  /**
   * 운영 장애 이력 (TASK-3701, CTO 정책 3701-④).
   *
   * 경보와 장애는 다르다 — 경보는 자동으로 뜨는 신호이고, 장애는 사람이
   * 여는 사건이다. 그래서 이 목록은 자동으로 채워지지 않는다.
   */
  @Get("incidents")
  async incidentBoard(@Query("limit") limit?: string): Promise<IncidentBoardDto> {
    const parsed = Number(limit);
    return this.incidents.board(Number.isInteger(parsed) && parsed > 0 ? parsed : 50);
  }

  @Post("incidents")
  @HttpCode(201)
  async openIncident(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      component?: string;
      severity?: string;
      summary?: string;
      startedAt?: string;
      detectedAt?: string | null;
      cause?: string | null;
    },
  ): Promise<IncidentDto> {
    if (!body.component || !body.severity || !body.summary || !body.startedAt) {
      throw new BadRequestException(
        "구성 요소 · 등급 · 한 줄 설명 · 시작 시각은 반드시 있어야 합니다.",
      );
    }
    return this.incidents.open({
      component: body.component,
      severity: body.severity,
      summary: body.summary,
      startedAt: body.startedAt,
      detectedAt: body.detectedAt,
      cause: body.cause,
      actorId: request.user?.id,
    });
  }

  /**
   * 운영 KPI (TASK-3801, CTO 정책 3801-③).
   *
   * 판정은 이미 일곱 군데에 있었고, 문제는 사람이 일곱 군데를 돌지 않는다는
   * 것이었다. **모르는 지표를 좋음으로 세지 않는다** — 절반을 모르는 초록
   * 화면이 가장 위험하다.
   */
  @Get("kpi")
  async operationsKpi(@Query("branch") branch?: string): Promise<OperationsKpiDto> {
    return this.kpis.report(branch?.trim() || undefined);
  }

  /**
   * KPI 추세 (TASK-4001, CTO 정책 4001-②).
   *
   * 현재값만으로는 아무 행동도 만들어지지 않는다 — 사람이 알아야 하는 것은
   * **나아지는 중인가**이고, 그건 두 번 재야 안다. 임계값이 바뀐 구간에서는
   * 값은 비교할 수 있어도 **상태는 비교할 수 없다**고 말한다.
   */
  @Get("kpi/trend")
  async kpiTrend(@Query("days") days?: string): Promise<KpiTrendReportDto> {
    const parsed = Number(days);
    return this.trends.trend(
      Number.isInteger(parsed) && parsed > 0 && parsed <= 365 ? parsed : undefined,
    );
  }

  /**
   * KPI 임계값 변경 이력 (TASK-4001, CTO 정책 4001-③).
   *
   * 임계값은 화면 색을 바꾸는 설정이므로 다른 설정과 섞어 두면 **언제 왜
   * 기준이 움직였는지**를 사람이 눈으로 골라야 한다. 각 줄에 느슨해진
   * 변경인지도 붙는다 — 판정할 수 없으면 null이고, null을 false로 바꾸지
   * 않는다.
   */
  @Get("kpi/history")
  async kpiSettingHistory(@Query("limit") limit?: string): Promise<KpiSettingChangeDto[]> {
    const parsed = Number(limit);
    return this.trends.settingHistory(
      Number.isInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 50,
    );
  }

  /**
   * 오늘 스냅샷을 지금 찍는다 (TASK-4001, CTO 정책 4001-②).
   *
   * 예약으로도 찍지만, 기준선을 만들 때 하루를 기다릴 이유는 없다.
   * 이미 오늘 찍었으면 아무것도 하지 않는다.
   */
  @Post("kpi/snapshot")
  @HttpCode(200)
  async takeKpiSnapshot(): Promise<{ taken: boolean; detail: string }> {
    return this.trends.snapshot();
  }

  /**
   * 장애 초안 수명 (TASK-4001, CTO 정책 4001-①).
   *
   * **만료는 기각이 아니다** — 기각은 "아무것도 아니었다"는 사람의 판단이고,
   * 만료는 "아무도 판단하지 않았다"는 기록이다.
   */
  @Get("incidents/drafts")
  async draftLifecycle(): Promise<DraftLifecycleDto> {
    return this.drafts.report();
  }

  /**
   * 운영 진단 (TASK-4001, CTO 정책 4001-④⑤).
   *
   * **진단은 서비스를 막지 않는다** — 경보와 차단은 다르다.
   */
  @Get("diagnostics")
  async runDiagnostics(@Query("stage") stage?: string): Promise<DiagnosticReportDto> {
    return this.diagnostics.run(stage === "startup" ? "startup" : "daily");
  }

  /**
   * Production Validation Sprint 준비 (TASK-4001, CTO 정책 4001-⑥).
   *
   * "준비 완료"를 스스로 선언하지 않는다 — 남은 것은 자격 증명·나가는
   * 길·검증용 환경이고 셋 다 사람이 주는 것이다. 대신 단계마다 담당과
   * 증거를 밝히고, **못 하고 있는 것과 안 하고 있는 것을 가른다.**
   */
  @Get("validation-plan")
  async validationPlan(): Promise<ValidationPlanDto> {
    return this.validation.report();
  }

  /**
   * 진단 이력 (TASK-4101, CTO 정책 4101-②).
   *
   * 이력이 없으면 "오늘 실패 2건"이 **새로 생긴 것인지 계속 그랬던
   * 것인지** 알 수 없습니다. 그 둘은 완전히 다른 소식입니다.
   */
  @Get("diagnostics/history")
  async diagnosticHistory(
    @Query("limit") limit?: string,
    @Query("tier") tier?: string,
  ): Promise<DiagnosticRunDto[]> {
    const parsed = Number(limit);
    return this.diagnostics.history(
      Number.isInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 30,
      tier?.trim() || undefined,
    );
  }

  /**
   * 만료 초안 되살림 (TASK-4101, CTO 정책 4101-④).
   *
   * **만료됐던 사실을 지우지 않습니다** — 지우면 목록은 깨끗해지지만
   * 나중에 이력을 읽는 사람이 "우리 팀은 초안을 잘 처리한다"고 읽습니다.
   * `action`은 `confirm` | `dismiss` | `reopen`이고, 셋 다 **사유가
   * 필요합니다.**
   */
  @Post("incidents/:id/revive")
  @HttpCode(200)
  async reviveDraft(
    @Param("id") id: string,
    @Body() body: { action?: string; reason?: string; summary?: string },
    @Req() request: AuthenticatedRequest,
  ): Promise<IncidentDto> {
    if (typeof body?.action !== "string" || typeof body?.reason !== "string") {
      throw new BadRequestException("action과 reason을 담아 주세요.");
    }
    return this.revival.revive(id, {
      action: body.action,
      reason: body.reason,
      summary: body.summary,
      actorId: request.user?.id,
    });
  }

  /** 되살림 이력 (TASK-4101, CTO 정책 4101-④) */
  @Get("incidents/revivals")
  async draftRevivals(@Query("limit") limit?: string): Promise<DraftRevivalSummaryDto> {
    const parsed = Number(limit);
    return this.revival.history(
      Number.isInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 50,
    );
  }

  /**
   * 검증 실행 잠금과 순서 (TASK-4101, CTO 정책 4101-⑤⑥).
   *
   * 준비되지 않았으면 **막고 이유를 말합니다.** 강제로 여는 방법은
   * 없습니다 — 막는 조건을 없애는 것이 유일한 길입니다.
   */
  @Get("validation-run")
  async validationRunGate(): Promise<ValidationRunDto> {
    return this.validationRun.gate();
  }

  /**
   * 검증 실행을 시작한다 (TASK-4101, CTO 정책 4101-⑥).
   *
   * **준비되지 않았으면 403으로 거절합니다.** 이것이 정책 ⑥을 문서가
   * 아니라 코드로 만드는 지점입니다 — 준비되지 않은 채 돌리면 스텁을
   * 상대로 한 성공 기록이 남고, 그 기록은 나중에 실연결의 증거로 읽힙니다.
   *
   * 이 호출 자체는 아무것도 실행하지 않습니다. **순서를 돌려줄 뿐**이고,
   * 각 단계는 사람이 확인하며 진행합니다 — 되돌릴 수 없는 단계가 섞여
   * 있는 절차를 한 번의 버튼으로 돌리지 않습니다.
   */
  @Post("validation-run")
  @HttpCode(200)
  async startValidationRun(): Promise<ValidationRunDto> {
    return this.validationRun.assertRunnable();
  }

  /**
   * 운영 이벤트 (TASK-3801, CTO 정책 3801-①).
   *
   * 시스템이 관측한 **상태 변화**다 — 감사 기록(누가 했나)과 목적이 다르다.
   */
  @Get("events")
  async opsEvents(@Query("limit") limit?: string): Promise<OpsEventDto[]> {
    const parsed = Number(limit);
    return this.events.recent(Number.isInteger(parsed) && parsed > 0 ? parsed : 50);
  }

  /**
   * 운영 감사 기록 (TASK-3801, CTO 정책 3801-④).
   *
   * **실패한 시도도 남는다** — 거절된 시도는 그 자체가 신호다.
   */
  @Get("audit")
  async opsAudit(
    @Query("limit") limit?: string,
    @Query("action") action?: string,
  ): Promise<OpsAuditDto[]> {
    const parsed = Number(limit);
    return this.audit.recent({
      limit: Number.isInteger(parsed) && parsed > 0 ? parsed : 50,
      action: action?.trim() || undefined,
    });
  }

  /**
   * 운영 설정 현황 (TASK-3901, CTO 정책 3901-②③④⑤).
   *
   * 임계값·보존 기간·긴급 경로·자동 승격은 각자 다른 곳에서 판정되지만
   * 운영자에게는 하나의 질문이다 — **"지금 이 시스템은 어떤 기준으로 돌고
   * 있는가."**
   */
  @Get("settings")
  opsSettingsStatus(): OpsSettingsDto {
    return this.opsSettings.status();
  }

  /**
   * 초안 승격을 지금 돌린다 (TASK-3901, CTO 정책 3901-⑤).
   *
   * 예약으로도 돌지만, 설정을 켠 직후 확인할 수 있어야 한다.
   */
  @Post("incidents/promote")
  @HttpCode(200)
  async promoteIncidents(): Promise<{ created: number; detail: string }> {
    return this.promotion.promote();
  }

  /**
   * 초안을 장애로 확인한다 (TASK-3901, CTO 정책 3901-⑤).
   *
   * 경보 제목을 그대로 두지 못하게 한다 — 그것은 **경보의 이름**이지 장애의
   * 설명이 아니다.
   */
  @Post("incidents/:id/confirm")
  @HttpCode(200)
  async confirmIncident(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { summary?: string; component?: string },
  ): Promise<IncidentDto> {
    return this.promotion.confirm(id, {
      summary: body.summary ?? "",
      component: body.component,
      actorId: request.user?.id,
    });
  }

  /** 초안 기각 — **사유 없이 기각하지 않는다** */
  @Post("incidents/:id/dismiss")
  @HttpCode(200)
  async dismissIncident(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { reason?: string },
  ): Promise<IncidentDto> {
    return this.promotion.dismiss(id, {
      reason: body.reason ?? "",
      actorId: request.user?.id,
    });
  }

  /**
   * 장애 사후 분석 (TASK-3801, CTO 정책 3801-②).
   *
   * 닫는 것과 **원인을 알아내는 것**은 다른 일이고 대개 다른 날에 일어난다.
   * 근본 원인 없이 재발 방지만 적을 수는 없다.
   */
  @Post("incidents/:id/analysis")
  @HttpCode(200)
  async analyzeIncident(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body()
    body: { rootCause?: string | null; permanentFix?: string | null; prevention?: string | null },
  ): Promise<IncidentDto> {
    return this.incidents.analyze(id, { ...body, actorId: request.user?.id });
  }

  /** 복구 기록 — **무엇으로 살렸는지 없이는 닫히지 않는다** */
  @Post("incidents/:id/resolve")
  @HttpCode(200)
  async resolveIncident(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      resolvedAt?: string;
      recovery?: string;
      /** temporary | permanent — 기본값을 두지 않는다 (정책 3801-②) */
      fixKind?: string;
      cause?: string | null;
    },
  ): Promise<IncidentDto> {
    return this.incidents.resolve(id, {
      resolvedAt: body.resolvedAt,
      recovery: body.recovery ?? "",
      fixKind: body.fixKind ?? "",
      cause: body.cause,
      actorId: request.user?.id,
    });
  }

  @Get("cutover")
  async productionCutover(
    @Query("branch") branch?: string,
  ): Promise<ProductionCutoverDto> {
    return this.cutover.report(branch?.trim() || undefined);
  }

  /**
   * Operations Dashboard · Disaster Recovery Checklist (TASK-1601).
   *
   * 배포 체크리스트(1202)와 목적이 다르다 — 그쪽은 "지금 배포해도 되는가",
   * 이쪽은 **"지금 무너지면 되살릴 수 있는가"** 다.
   */
  @Get("readiness")
  async readiness(): Promise<OperationsReadinessDto> {
    // 판정은 **한 곳에서만** 한다 (CTO 결정 2301-①) — 이 컨트롤러는
    // 조립하지 않고 DTO로 옮기기만 한다
    const evaluation = await this.recovery.evaluate();
    const {
      health,
      backupHistory,
      restoreHistory,
      smtp,
      redis,
      drill,
      drillHistory,
      requirements,
      protection,
      backupProtection,
      storageProtection,
      backupBucketProtection,
      storageStandard,
      restoreTarget,
      remoteIntegrity,
      remoteVerifyIntervalMs,
      remoteVerifyScheduled,
      checklist,
      summary,
      restoreTargetVerdict,
    } = evaluation;
    const unhealthySince = this.locks.unhealthySince;

    return {
      recoverable: summary.recoverable,
      summary: {
        pass: summary.pass,
        fail: summary.fail,
        warn: summary.warn,
        manual: summary.manual,
      },
      checklist,
      backup: {
        verdict: health.backup.verdict,
        message: health.backup.message,
        ageMs: health.backup.ageMs,
        sizeBytes: health.backup.sizeBytes,
        history: backupHistory,
        directory: this.backups.describeDirectory(),
        retentionDays: this.backups.retentionDays,
      },
      restore: {
        verdict: health.restore.verdict,
        message: health.restore.message,
        ageMs: health.restore.ageMs,
        tables: health.restore.tables,
        history: restoreHistory,
        configured: this.backups.restoreTarget !== null,
      },
      smtp,
      redis: {
        configured: this.locks.distributed,
        ok: redis.ok,
        detail: redis.detail,
        latencyMs: redis.latencyMs,
        unhealthySince:
          unhealthySince === null ? null : new Date(unhealthySince).toISOString(),
        outageThresholdMs: this.checks.lockOutageThresholdMs,
      },
      enterprise: {
        integrity: health.integrity,
        offsite: {
          ...health.offsite,
          configured: this.backups.offsiteEnabled,
          copies: backupHistory.filter(
            (entry: { offsite: boolean }) => entry.offsite,
          ).length,
        },
        storageProtection: { ...storageProtection, ...protection },
        objectives: health.objectives,
        restoreTarget: { ...restoreTarget, verdict: restoreTargetVerdict },
        drill: {
          status: drill.status,
          detail: drill.detail,
          ageMs: drill.ageMs,
          dueAt: drill.dueAt === null ? null : new Date(drill.dueAt).toISOString(),
          overdueDays: drill.overdueDays,
          intervalDays: Math.round(drill.intervalMs / (24 * 60 * 60 * 1000)),
          history: drillHistory,
          pendingTriggers: drill.pendingTriggers,
          requirements,
          // 재기동 후 자동 등록을 확인할 수 있어야 한다 (CTO 결정 2001-④)
          autoRegistration: this.drills.lastAutoRegistration(),
        },
        backupBucket: {
          name: this.storage.backupBucket,
          // 이미지 버킷과 같으면 한 쪽이 사라질 때 둘 다 사라진다 (결정 1701-②)
          separated: this.storage.backupBucket !== this.storage.bucket,
          protection: { ...backupBucketProtection, ...backupProtection },
        },
        performance: health.performance,
        backupIntegrity: {
          chain: {
            status: health.chain.status,
            detail: health.chain.detail,
            expected: health.chain.expected,
            actual: health.chain.actual,
            longestGapMs: health.chain.longestGapMs,
            windowMs: health.chainWindow.windowMs,
            windowSource: health.chainWindow.source,
            windowDetail: health.chainWindow.detail,
          },
          remote: {
            status: remoteIntegrity.status,
            detail: remoteIntegrity.detail,
            verdict: remoteIntegrity.verdict,
            maxManualCount: MAX_MANUAL_REMOTE_VERIFY_COUNT,
            checkedAt:
              health.remoteRecord === null
                ? null
                : new Date(health.remoteRecord.checkedAt).toISOString(),
            intervalMs: remoteVerifyIntervalMs,
            scheduled: remoteVerifyScheduled,
          },
          scale: {
            status: health.scale.status,
            detail: health.scale.detail,
            bytes: health.scale.bytes,
            reachedMilestone: health.scale.reachedMilestone,
            nextMilestone: health.scale.nextMilestone,
          },
          storageStandard,
        },
        // 운영에서는 버킷·IAM을 운영 담당자가 준비한다 (CTO 결정 2101-④)
        storageProvisioning: {
          mode: this.storage.provisioning.mode,
          detail: this.storage.provisioning.detail,
        },
      },
      checkedAt: new Date().toISOString(),
    };
  }

  @Post("notifications/verify-smtp")
  @HttpCode(200)
  async verifySmtp(): Promise<SmtpValidationDto> {
    return this.notifications.verifySmtp();
  }

  /** 백업 수동 실행 */
  @Post("backup/run")
  @HttpCode(200)
  async runBackup() {
    return this.backups.backup("manual");
  }

  /** 복원 검증 수동 실행 — 운영 DB가 아니라 별도 DB에 복원한다 */
  @Post("backup/verify-restore")
  @HttpCode(200)
  async runRestoreVerify() {
    return this.backups.verifyRestore("manual");
  }

  /**
   * 복구 리허설 기록 (TASK-1801, CTO 결정 1701-⑤).
   *
   * 리허설 자체는 사람이 한다 — 여기서는 **한 사실을 남긴다**.
   * 실패한 리허설도 기록한다: 절차가 깨졌다는 것을 사고 전에 알아낸 것이다.
   */
  @Post("drills")
  @HttpCode(201)
  async recordDrill(
    @Body()
    body: {
      ok?: boolean;
      performedBy?: string;
      durationMs?: number;
      findings?: string;
      notes?: string;
    },
  ): Promise<RecoveryDrillDto> {
    if (typeof body?.ok !== "boolean") {
      throw new BadRequestException(
        "ok는 true/false여야 합니다 — 리허설이 성공했는지 실패했는지가 기록의 핵심입니다.",
      );
    }
    const performedBy = body.performedBy?.trim();
    if (!performedBy) {
      throw new BadRequestException(
        "performedBy는 필수입니다 — 누가 확인했는지 남지 않으면 기록이 아닙니다.",
      );
    }
    return this.drills.record({
      ok: body.ok,
      performedBy,
      durationMs:
        typeof body.durationMs === "number" && body.durationMs >= 0
          ? Math.round(body.durationMs)
          : null,
      findings: body.findings?.trim() || null,
      notes: body.notes?.trim() || null,
    });
  }

  /** 복구 리허설 이력 */
  @Get("drills")
  async drillHistory(@Query("limit") limit?: string): Promise<RecoveryDrillDto[]> {
    return this.drills.history(Number(limit) || 20);
  }

  /**
   * 변경 후 추가 리허설 요구 등록 (TASK-1901, CTO 결정 1801-⑤).
   *
   * **달력이 아니라 변경이 리허설을 부른다** — DR 절차·DB·백업 방식이 크게
   * 바뀌면 마지막 리허설이 검증한 것은 지금의 시스템이 아니다.
   */
  @Post("drills/require")
  @HttpCode(201)
  async requireDrill(
    @Body() body: { trigger?: string; description?: string; registeredBy?: string },
  ): Promise<DrillRequirementDto> {
    const trigger = body?.trigger?.trim() as ScheduledDrillTrigger | undefined;
    if (!trigger || !(DRILL_TRIGGERS as readonly string[]).includes(trigger)) {
      throw new BadRequestException(
        `trigger는 ${DRILL_TRIGGERS.join(" | ")} 중 하나여야 합니다.`,
      );
    }
    const description = body.description?.trim();
    if (!description) {
      throw new BadRequestException(
        "description은 필수입니다 — 무엇이 바뀌었는지 남지 않으면 다음 리허설이 무엇을 확인해야 할지 알 수 없습니다.",
      );
    }
    const registeredBy = body.registeredBy?.trim();
    if (!registeredBy) {
      throw new BadRequestException("registeredBy는 필수입니다.");
    }
    return this.drills.requireDrill({ trigger, description, registeredBy });
  }

  /**
   * 요구 취소 (CTO 결정 1901-②) — **삭제는 금지한다.**
   * 왜 취소했는지가 다음 판단의 근거가 되므로 사유를 필수로 받는다.
   */
  @Post("drills/requirements/:id/cancel")
  @HttpCode(200)
  async cancelRequirement(
    @Param("id") id: string,
    @Body() body: { cancelledBy?: string; reason?: string },
  ): Promise<DrillRequirementDto> {
    const cancelledBy = body?.cancelledBy?.trim();
    const reason = body?.reason?.trim();
    if (!cancelledBy || !reason) {
      throw new BadRequestException(
        "cancelledBy와 reason은 필수입니다 — 왜 취소했는지가 남지 않으면 기록이 아닙니다.",
      );
    }
    return this.drills.cancelRequirement(id, { cancelledBy, reason });
  }

  /**
   * 원격 사본 무결성 검증 (TASK-2001).
   * **내려받아 대조하므로 전송 비용이 든다** — 눌러야만 실행한다.
   */
  /**
   * 원격 사본 대조 — 수동은 **최근 3건까지** (CTO 결정 2101-①).
   *
   * 자동(주 1회)은 1건만 본다. 사람이 필요할 때 한 번 더 보는 쪽에만 폭을
   * 주고, 상한을 둔다 — "전부"를 허용하면 이력이 쌓인 뒤 한 번의 클릭이
   * 예상치 못한 전송 비용이 된다.
   */
  @Post("backup/verify-remote")
  @HttpCode(200)
  async verifyRemote(
    @Query("count") count?: string,
  ): Promise<RemoteVerifyResultDto> {
    const wanted = resolveRemoteVerifyCount(count ?? 1);
    if (count !== undefined && !/^\d+$/.test(count.trim())) {
      throw new BadRequestException(
        `count는 1~${MAX_MANUAL_REMOTE_VERIFY_COUNT} 사이의 숫자입니다.`,
      );
    }
    return this.backups.verifyRemoteCopies(wanted);
  }

  /** 변경 사건 목록 */
  @Get("drills/requirements")
  async drillRequirements(
    @Query("limit") limit?: string,
  ): Promise<DrillRequirementDto[]> {
    return this.drills.requirements(Number(limit) || 20);
  }

  /** 경보 현황 + 예약 점검 구성·마지막 결과 */
  @Get("alerts")
  async board(@Query("limit") limit?: string): Promise<AlertBoardDto> {
    const [active, recent, schedules, deliveries, coordination] =
      await Promise.all([
        this.alerts.active(),
        this.alerts.recent(Number(limit) || 20),
        this.checks.status(),
        this.notifications.deliveries(10),
        this.checks.coordination(),
      ]);
    const summary = summarizeAlerts(active);
    return {
      ok: summary.ok,
      summary: {
        total: summary.total,
        critical: summary.critical,
        warning: summary.warning,
      },
      active,
      recent,
      schedules,
      // URL 자체는 노출하지 않는다 — 웹훅 주소도 비밀이다
      webhookConfigured: this.alerts.webhookConfigured,
      cooldownMs: this.alerts.cooldownMs,
      cooldownByKind: this.alerts.cooldownByKind,
      channels: this.notifications.status(),
      deliveries,
      coordination,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Alert History (TASK-1401) — 보관된 것까지 포함한 전체 이력과 요약.
   * 평균 해소 시간을 함께 낸다 — 경보가 많은 것보다 **오래 방치되는 것**이
   * 더 나쁜 신호다.
   */
  @Get("alerts/history")
  async history(
    @Query("kind") kind?: string,
    @Query("level") level?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<AlertHistoryDto> {
    return this.alerts.history({
      kind,
      level: level === "warning" || level === "critical" ? level : undefined,
      status:
        status === "ACTIVE" || status === "RESOLVED" || status === "ARCHIVED"
          ? status
          : undefined,
      limit: Number(limit) || undefined,
    });
  }

  /**
   * Alert Archive (TASK-1401, CTO 결정 1302-④) — **삭제하지 않는다**.
   * 해소 후 유예(기본 90일)가 지난 경보를 보관으로 옮긴다.
   */
  @Post("alerts/archive")
  @HttpCode(200)
  async archive(): Promise<AlertArchiveResultDto> {
    return this.alerts.archive();
  }

  /**
   * 알림 큐 현황 (TASK-1501, CTO 결정 1401-②) — 대기·성공·**Dead Letter**.
   * Dead Letter는 지우지 않는다 — 무엇이 전달되지 못했는지 남아 있어야
   * 사람이 고친 뒤 다시 보낼 수 있다.
   */
  @Get("notifications/queue")
  async queueStatus(): Promise<NotificationQueueStatusDto> {
    return this.queue.status();
  }

  /** 큐를 지금 비운다 — 예약 워커를 기다리지 않고 확인할 때 */
  @Post("notifications/queue/drain")
  @HttpCode(200)
  async drainQueue(): Promise<{
    processed: number;
    sent: number;
    retried: number;
    dead: number;
    skipped: string | null;
  }> {
    // 수동 실행은 잠금을 요구하지 않는다 — 사람이 지금 확인하려는 것이다
    return this.queue.drain({ force: true });
  }

  /**
   * Dead Letter 재시도 — 설정을 고친 뒤 다시 보낸다.
   * `ids`가 없으면 전부.
   */
  @Post("notifications/queue/requeue")
  @HttpCode(200)
  async requeue(@Body() body?: { ids?: string[] }): Promise<{ requeued: number }> {
    return this.queue.requeue(body?.ids);
  }

  /** 최근 알림 전송 시도 — "왜 아무도 못 받았는가"를 추적한다 */
  @Get("notifications")
  async deliveries(
    @Query("limit") limit?: string,
  ): Promise<NotificationDeliveryDto[]> {
    return this.notifications.deliveries(Number(limit) || 20);
  }

  /**
   * 알림 채널 시험 — **실제로 전송한다**. 설정 직후 확인용이라
   * 눌러야만 실행되고, 본문에 "실제 문제가 아님"을 명시한다.
   */
  @Post("notifications/test")
  @HttpCode(200)
  async testNotification(
    @Body() body: { level?: string } = {},
  ): Promise<{
    sent: number;
    /** 어느 경로로 나갔는가 (TASK-3901, 정책 3901-④) */
    routing: string;
    results: { ok: boolean; attempts: number; status: number | null; error: string | null }[];
  }> {
    // **긴급 경로를 시험할 수 있어야 한다** (TASK-3901): 등급을 못 고르면
    // 경로가 실제로 갈리는지 확인할 방법이 없고, 확인할 수 없는 분리는
    // 분리됐다고 믿기만 하는 것이다.
    const level =
      body.level === "critical" || body.level === "resolved" ? body.level : "warning";
    const results = await this.notifications.test(level);
    return {
      sent: results.length,
      routing: this.notifications.describeRouting(level),
      results,
    };
  }

  /**
   * 점검 수동 실행 — `?job=`으로 하나만, 없으면 전부.
   * 예약을 기다리지 않고 지금 상태를 확인해야 할 때 쓴다(배포 직후 등).
   */
  @Post("checks/run")
  @HttpCode(200)
  async run(@Query("job") job?: string): Promise<CheckRunResultDto[]> {
    if (!job) {
      return this.checks.runAll("manual");
    }
    if (!(SCHEDULED_JOBS as readonly string[]).includes(job)) {
      throw new BadRequestException(
        `지원하지 않는 점검입니다: ${job} (${SCHEDULED_JOBS.join(" / ")})`,
      );
    }
    return [await this.checks.run(job as ScheduledJob, "manual")];
  }

  // ── 가격표 거버넌스 (TASK-3101, CTO 정책 3101-①②) ─────────────

  /**
   * 단가 제안 목록 + 실효 가격표 (GET /ops/pricing).
   *
   * 지금 무슨 단가로 계산하고 있는지, 그 단가가 **누구의 승인으로** 적용된
   * 것인지를 한 화면에서 본다. 코드 기본값과 승인된 값이 구분되지 않으면
   * "이 금액은 왜 이런가"에 아무도 답할 수 없다.
   */
  @Get("pricing")
  async pricingBoard(): Promise<PricingBoardDto> {
    return this.pricing.board();
  }

  /** 단가 변경 제안 (DRAFT) — 사유 없이는 등록되지 않는다 */
  @Post("pricing")
  @HttpCode(201)
  async proposePricing(
    @Body() body: ProposePricingRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<PricingProposalDto> {
    return this.pricing.propose({
      target: body?.target,
      key: body?.key,
      price: body?.price,
      reason: body?.reason,
      actor: request.user?.email ?? null,
    });
  }

  /**
   * 단계 진행 — 검토 → 승인 → 적용 순서를 건너뛸 수 없다 (정책 3101-①).
   *
   * 시스템이 만든 제안은 운영에서 **최종 승인**(`confirm`)을 한 번 더 거치고
   * (정책 3301-②), 발효 전 예약은 **취소**(`cancel`)할 수 있습니다 —
   * 취소는 삭제가 아니라 `CANCELLED` 상태입니다 (정책 3301-③).
   *
   * **적용만 실효 가격표를 바꾼다.** 승인은 "적용해도 된다"는 뜻이고, 실제로
   * 계산에 쓰이기 시작한 시점은 적용 시각이다 — 그 시각이 있어야 "언제부터
   * 이 단가로 계산됐나"에 답할 수 있다.
   */
  @Post("pricing/:id/:stage")
  @HttpCode(200)
  async advancePricing(
    @Param("id") id: string,
    @Param("stage") stage: string,
    @Body() body: AdvancePricingRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<PricingProposalDto> {
    const action = PRICING_ACTIONS[stage];
    if (action === undefined) {
      throw new BadRequestException(
        `지원하지 않는 단계입니다: ${stage} (${Object.keys(PRICING_ACTIONS).join(" / ")})`,
      );
    }
    return this.pricing.advance(id, action, request.user?.email ?? null, {
      reason: body?.reason,
      // 적용에만 쓰인다 — 미지정이면 즉시 발효 (CTO 정책 3201-③)
      effectiveFrom: body?.effectiveFrom,
    });
  }

  /**
   * 가격 변경 감지 (POST /ops/pricing/detect) — 예약을 기다리지 않고 지금.
   *
   * **감지는 적용이 아닙니다** (CTO 정책 3201-①): 기록과 가격표를 대조해
   * `DETECTED` 제안을 만들 뿐이고, 승인·적용은 사람이 합니다.
   */
  @Post("pricing/detect")
  @HttpCode(200)
  async detectPricing(): Promise<PricingDetectionDto> {
    // **수동 실행은 주기를 무시한다** (TASK-3301, CTO 정책 3301-④) — 사람이
    // "지금 보라"고 누른 것이므로 주기 미도래로 아무것도 하지 않으면 버튼이
    // 거짓말이 된다. 예약 점검은 Provider별 주기를 지킨다.
    const result = await this.pricing.detect({ force: true });
    return { ...result, checkedAt: new Date().toISOString() };
  }

  // ── 비용 인텔리전스 (TASK-3101, CTO 정책 3101-③④) ─────────────

  /**
   * 운영 비용 리포트 (GET /ops/billing?from=&to=).
   *
   * **회계 청구서가 아니다** (정책 3101-④) — 응답에 그 사실이 항상 담긴다.
   */
  @Get("billing")
  async billing(
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<BillingReportDto> {
    return this.costs.billing({ from, to });
  }

  /**
   * 월말 비용 예측 (GET /ops/cost-forecast).
   *
   * **참고자료다** (정책 3101-③) — 이 값으로 호출을 막지 않는다. 차단은
   * 실제 지출을 보는 예산 관문만 한다.
   */
  @Get("cost-forecast")
  async costForecast(): Promise<CostForecastDto> {
    return this.costs.forecast();
  }
}
