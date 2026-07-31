import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

/** 지금 도는 작업의 끈 */
export interface JobTrace {
  jobId: string;
  kind: string;
  /** 지금 어느 단계인가 — 단계가 바뀌면 갱신된다 */
  stage: string;
}

/**
 * 작업 추적 컨텍스트. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * `RequestContextService`(TASK-3601)와 **나란히** 있습니다. 고치지
 * 않습니다 — 둘은 다른 것을 묶습니다:
 *
 * | | 무엇을 묶는가 | 언제 끝나는가 |
 * | --- | --- | --- |
 * | `RequestContextService` | 사용자 요청 1건이 부른 호출들 | 응답이 나가면 |
 * | `JobContextService` | 오래 도는 작업 1건의 단계들 | 작업이 끝나면 |
 *
 * 요청은 끝났는데 작업은 계속되는 경우가 있고, 그때 요청 끈만으로는
 * **작업이 어디까지 갔는지** 알 수 없습니다.
 *
 * 인자로 넘기지 않는 이유는 3601과 같습니다 — 사이의 함수 하나만 빠뜨려도
 * **그 경로만 조용히 추적이 끊깁니다.**
 */
@Injectable()
export class JobContextService {
  private readonly storage = new AsyncLocalStorage<JobTrace>();

  /** 지금 도는 작업 — 작업 밖에서 부르면 null */
  current(): JobTrace | null {
    return this.storage.getStore() ?? null;
  }

  run<T>(trace: JobTrace, fn: () => T): T {
    return this.storage.run(trace, fn);
  }

  /**
   * 지금 단계를 바꾼다.
   *
   * 저장된 객체를 그 자리에서 고칩니다 — 새 저장소를 열면 이미 시작된
   * 하위 호출들이 **옛 단계 이름을 계속 들고 갑니다.**
   */
  setStage(stage: string): void {
    const trace = this.storage.getStore();
    if (trace !== undefined) {
      trace.stage = stage;
    }
  }
}
