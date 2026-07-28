import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DEFAULT_BUDGET_ALERT_RATIO,
  LLM_FEATURE_EXPERIMENT_ENV,
  LLM_FEATURE_MODEL_ENV,
  LLM_PROVIDER_REGISTRY,
  experimentKey,
  modelKey,
  providerEnabledKey,
  resolveSetting,
} from "@acos/core";
import type {
  AdminAuditEntryDto,
  AdminConsoleDto,
  AdminSettingUpdateRequest,
  AdminSettingUpdatedDto,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.guard";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { LlmService } from "../llm/llm.service";
import { AdminSettingsService } from "./admin-settings.service";

/**
 * Provider Administration Console. (TASK-1201, Sprint 12)
 *
 * Provider Enable/Disable · Model Management · Budget Management ·
 * Experiment Management · Audit Log를 한 화면에서 다룬다.
 *
 * **전부 ADMIN 전용**이다 — 라우팅·예산·실험을 바꾸는 것은 트래픽과 비용에
 * 직결되므로, 승격(1101-④)과 같은 등급으로 둔다.
 *
 * 전역 WriteProtectionGuard는 쓰기만 막으므로 **조회에도 AuthGuard를 건다** —
 * 콘솔의 GET은 예산·모델 구성과 감사 이력(수행자 이메일)을 노출하기 때문에
 * 일반 조회 API와 같은 비보호 정책을 둘 수 없다 (`/llm/health`와 같은 이유).
 *
 * 설정 원칙은 그대로 **Code-first(환경변수)** 이며 콘솔은 오버라이드다.
 * 각 값의 출처(override/env/default)를 함께 돌려주어, 화면에서 "지금 무엇이
 * 적용 중이고 해제하면 무엇으로 돌아가는지"가 보이게 했다.
 */
@Controller("admin")
@UseGuards(AuthGuard)
@RequireRole("ADMIN")
export class AdminController {
  constructor(
    private readonly settings: AdminSettingsService,
    private readonly llm: LlmService,
    private readonly budget: LlmBudgetService,
  ) {}

  /** 콘솔 전체 현황 — Provider·모델·예산·실험 */
  @Get("console")
  async console(): Promise<AdminConsoleDto> {
    const overrides = this.settings.all();
    const routing = this.llm.routing();
    const budget = await this.budget.status();

    return {
      providers: LLM_PROVIDER_REGISTRY.map((info) => {
        const key = providerEnabledKey(info.name);
        const keyConfigured = info.keyEnv
          ? Boolean(process.env[info.keyEnv])
          : true;
        const disabled = overrides[key] === "false";
        return {
          name: info.name,
          title: info.title,
          connection: info.connection,
          defaultModel: info.defaultModel,
          models: info.models,
          keyConfigured,
          /** 키가 있고 콘솔에서 끄지 않았을 때만 실제 후보가 된다 */
          enabled: !disabled,
          available: routing.availableProviders.includes(info.name),
          setting: resolveSetting({
            key,
            override: overrides[key] ?? null,
            envName: info.keyEnv ?? null,
            defaultValue: "true",
          }),
        };
      }),
      models: Object.entries(LLM_FEATURE_MODEL_ENV).map(([feature, env]) => {
        const key = modelKey(feature);
        return {
          feature,
          setting: resolveSetting({
            key,
            override: overrides[key] ?? null,
            envName: env,
            envValue: process.env[env] ?? null,
          }),
          /** 라우팅이 실제로 고른 모델 (null이면 Provider 기본) */
          effective:
            routing.routes.find((route) => route.feature === feature)?.model ??
            null,
        };
      }),
      budget: {
        daily: resolveSetting({
          key: "budget.daily",
          override: overrides["budget.daily"] ?? null,
          envName: "LLM_DAILY_BUDGET_USD",
          envValue: process.env.LLM_DAILY_BUDGET_USD ?? null,
        }),
        monthly: resolveSetting({
          key: "budget.monthly",
          override: overrides["budget.monthly"] ?? null,
          envName: "LLM_MONTHLY_BUDGET_USD",
          envValue: process.env.LLM_MONTHLY_BUDGET_USD ?? null,
        }),
        alertRatio: resolveSetting({
          key: "budget.alertRatio",
          override: overrides["budget.alertRatio"] ?? null,
          envName: "LLM_BUDGET_ALERT_RATIO",
          envValue: process.env.LLM_BUDGET_ALERT_RATIO ?? null,
          defaultValue: String(DEFAULT_BUDGET_ALERT_RATIO),
        }),
        status: budget,
      },
      experiments: Object.entries(LLM_FEATURE_EXPERIMENT_ENV).map(
        ([feature, env]) => {
          const key = experimentKey(feature);
          return {
            feature,
            setting: resolveSetting({
              key,
              override: overrides[key] ?? null,
              envName: env,
              envValue: process.env[env] ?? null,
            }),
          };
        },
      ),
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * 설정 변경/해제. body `{ value: null }`이면 오버라이드를 지워
   * **환경변수 값으로 되돌린다**. 검증 실패는 400.
   */
  @Put("settings/:key")
  async updateSetting(
    @Param("key") key: string,
    @Body() body: AdminSettingUpdateRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<AdminSettingUpdatedDto> {
    if (body === undefined || body === null || !("value" in body)) {
      throw new BadRequestException(
        "본문에 value를 담아 주세요 (해제하려면 null).",
      );
    }
    const value =
      body.value === null || body.value === undefined ? null : String(body.value);

    // 마지막 Provider를 끄면 호출이 전멸한다 — 저장 전에 막는다
    const providerMatch = /^provider\.([a-z0-9-]+)\.enabled$/.exec(key);
    if (providerMatch && value === "false") {
      const remaining = this.llm
        .routing()
        .availableProviders.filter((name) => name !== providerMatch[1]);
      if (remaining.length === 0) {
        throw new BadRequestException(
          "마지막으로 남은 Provider는 비활성화할 수 없습니다 — 다른 Provider를 먼저 활성화하세요.",
        );
      }
    }

    const saved = await this.settings.set(
      key,
      value,
      request.user?.email ?? null,
      body.note ?? null,
    );
    return { ...saved, updatedAt: new Date().toISOString() };
  }

  /** 콘솔 조작 감사 이력 (최신순) */
  @Get("audit")
  async audit(@Query("limit") limit?: string): Promise<AdminAuditEntryDto[]> {
    return this.settings.audit(Number(limit) || 50);
  }
}
