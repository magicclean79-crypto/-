import { Injectable, Logger } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { judgeCiRuns, judgeCiWorkflow } from "@acos/core";
import type { CiRunInput, CiRunJudgement, CiWorkflowJudgement } from "@acos/core";

/** GitHub API 조회 제한 시간 — 여기 매달려 화면이 멈추면 안 된다 */
export const CI_STATUS_TIMEOUT_MS = 5_000;

/**
 * GitHub Actions 상태 어댑터. (TASK-3401, Sprint 34 — CTO 지시 6)
 *
 * 두 가지를 각각 읽습니다. **파일에 적혀 있는 것**과 **초록으로 끝나는 것**은
 * 다른 사실이기 때문입니다:
 *
 * 1. 워크플로 **파일** — 돌려야 할 게이트가 순서대로 있는가
 * 2. 최근 **실행 결과** — 그 게이트가 실제로 통과하는가
 *
 * 실제로 이 저장소의 CI는 워크플로에 게이트가 다 적혀 있는 상태로 13회 연속
 * 실패했습니다(러너에 Playwright 브라우저가 없었습니다). 파일만 보는 판정은
 * 그 사실을 끝까지 알려 주지 못합니다.
 *
 * 실행 이력은 `GITHUB_REPOSITORY`가 설정됐을 때만 읽습니다. **없으면 모르는
 * 것으로 둡니다** — 못 읽은 것을 "통과"로 바꾸지 않습니다.
 */
@Injectable()
export class CiStatusService {
  private readonly logger = new Logger(CiStatusService.name);

  /** 워크플로 파일을 읽는다 — 못 읽으면 null (짐작하지 않는다) */
  workflow(): CiWorkflowJudgement | null {
    const path =
      process.env.CI_WORKFLOW_PATH?.trim() ||
      join(process.cwd(), "..", "..", ".github", "workflows", "ci.yml");
    try {
      return judgeCiWorkflow(readFileSync(path, "utf8"));
    } catch (error) {
      this.logger.warn(
        `CI 워크플로 파일을 읽지 못했습니다 (${path}): ${String(error)} — ` +
          "게이트가 있는지 모르는 상태입니다(있다고 가정하지 않습니다).",
      );
      return null;
    }
  }

  /** 이 저장소의 실행 이력을 읽는다 — 미설정이면 빈 이력(=모름) */
  async runs(branch?: string): Promise<CiRunJudgement> {
    const repository = process.env.GITHUB_REPOSITORY?.trim();
    if (!repository) {
      return judgeCiRuns({ runs: [] });
    }
    const base =
      process.env.GITHUB_API_URL?.trim().replace(/\/+$/, "") || "https://api.github.com";
    const url = `${base}/repos/${repository}/actions/runs?per_page=20`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CI_STATUS_TIMEOUT_MS);
    try {
      const token = process.env.GITHUB_TOKEN;
      const response = await globalThis.fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/vnd.github+json",
          // 토큰 값은 로그에도 판정 결과에도 남기지 않는다
          ...(token !== undefined && token.trim() !== ""
            ? { authorization: `Bearer ${token.trim()}` }
            : {}),
        },
      });
      if (!response.ok) {
        this.logger.warn(
          `GitHub Actions 이력을 읽지 못했습니다: HTTP ${response.status} — ` +
            "통과로 세지 않습니다.",
        );
        return judgeCiRuns({ runs: [] });
      }
      const body = (await response.json()) as {
        workflow_runs?: {
          id: number;
          head_branch: string | null;
          head_sha: string;
          status: string;
          conclusion: string | null;
          created_at: string;
        }[];
      };
      const runs: CiRunInput[] = (body.workflow_runs ?? []).map((run) => ({
        id: run.id,
        branch: run.head_branch ?? "",
        sha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        createdAt: run.created_at,
      }));
      return judgeCiRuns({ runs, branch });
    } catch (error) {
      this.logger.warn(
        `GitHub Actions 이력을 읽지 못했습니다: ${String(error)} — 통과로 세지 않습니다.`,
      );
      return judgeCiRuns({ runs: [] });
    } finally {
      clearTimeout(timer);
    }
  }
}
