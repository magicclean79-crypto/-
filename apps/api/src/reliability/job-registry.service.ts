import { Injectable, Logger } from "@nestjs/common";

import type { JobResult } from "./job-runner.service";

/**
 * 작업 종류별 실행기 등록소. (TASK-4701, Sprint 47 — 지시 3)
 *
 * ## 왜 필요한가
 *
 * 자동 이어하기는 `job_runs`의 한 **행**을 보고 시작합니다. 행에는 `kind`와
 * `input`이 있을 뿐, "이 종류를 어떻게 돌리는가"는 없습니다. 큐가 그것을
 * 알려면 종류마다 if를 늘어놓거나, 각 작업이 스스로 등록해야 합니다.
 *
 * if를 늘어놓으면 **작업을 새로 만든 사람이 큐를 고치는 것을 잊습니다.**
 * 그러면 그 종류만 조용히 자동 이어하기에서 빠지고, 빠졌다는 사실은
 * 프로세스가 죽은 날에야 드러납니다. 그래서 등록소를 둡니다.
 *
 * ## 모르는 종류를 짐작하지 않습니다
 *
 * 등록되지 않은 종류가 큐에 올라오면 **이어하지 않고 그 사실을 말합니다.**
 * 비슷한 종류로 대신 돌리는 길은 없습니다 — 다른 일을 시키는 것보다
 * 안 하는 것이 낫습니다.
 */

/** 이어할 수 있는 작업 — 저장된 입력을 받아 다시 돌린다 */
export type JobResumer = (jobId: string, input: unknown) => Promise<JobResult>;

export interface RegisteredJob {
  resume: JobResumer;
  /**
   * 저장된 입력에 항목이 몇 개인가.
   *
   * "3/5단계"를 적으려면 분모가 필요한데, 분모는 종류마다 다른 칸에
   * 있습니다(`imageIds` · `productIds` · `versions` · `contentIds`).
   * 컨트롤러가 종류별로 그 칸 이름을 알고 있으면 **작업을 새로 만들 때마다
   * 컨트롤러를 고쳐야** 하고, 고치는 것을 잊으면 그 종류만 분모가 0이
   * 됩니다 — 그러면 화면에 "3/0단계"가 뜹니다.
   */
  countItems: (input: unknown) => number;
}

@Injectable()
export class JobRegistryService {
  private readonly logger = new Logger(JobRegistryService.name);
  private readonly resumers = new Map<string, RegisteredJob>();

  /**
   * 종류 하나를 등록한다.
   *
   * 같은 종류를 두 번 등록하면 **뒤엣것이 이깁니다.** 다만 조용히 넘어가지
   * 않습니다 — 두 곳에서 같은 종류를 다르게 돌리고 있다는 뜻이고, 그건
   * 언젠가 "왜 이 작업만 다르게 도나"가 됩니다.
   */
  register(kind: string, job: RegisteredJob): void {
    if (this.resumers.has(kind)) {
      this.logger.warn(
        `작업 종류 "${kind}"가 이미 등록돼 있습니다 — 나중에 등록한 것으로 덮어씁니다.`,
      );
    }
    this.resumers.set(kind, job);
  }

  /**
   * 이 작업의 항목 수 — 등록되지 않은 종류면 0.
   *
   * 0은 "항목이 없다"가 아니라 **"셀 줄 모른다"** 입니다. 그래서 화면은
   * 분모가 0일 때 비율 대신 진행 단계 수만 말합니다.
   */
  countItems(kind: string, input: unknown): number {
    return this.resumers.get(kind)?.countItems(input) ?? 0;
  }

  /** 등록된 종류인가 */
  knows(kind: string): boolean {
    return this.resumers.has(kind);
  }

  /** 등록된 종류들 — 화면에 그대로 보여 준다 */
  kinds(): string[] {
    return [...this.resumers.keys()].sort();
  }

  /**
   * 이어한다. 등록되지 않은 종류면 `null`.
   *
   * `null`은 "실패했다"가 아니라 **"우리가 이 종류를 모른다"** 입니다 —
   * 부르는 쪽이 그 둘을 갈라서 기록해야 합니다.
   */
  async resume(kind: string, jobId: string, input: unknown): Promise<JobResult | null> {
    const registered = this.resumers.get(kind);
    if (registered === undefined) {
      return null;
    }
    return registered.resume(jobId, input);
  }
}
