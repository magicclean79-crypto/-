import { judgeActivationEvent } from "./activation-event";
import type { ActivationSnapshot } from "./activation-event";

/**
 * 활성화 이벤트 검증. (TASK-3801 — CTO 정책 3801-①)
 *
 * 지키는 것 셋: **경계를 넘을 때만 난다**, **풀린 것도 알린다**,
 * **모르는 것을 사건으로 만들지 않는다**.
 */
describe("활성화 이벤트 (TASK-3801)", () => {
  const snap = (overrides: Partial<ActivationSnapshot> = {}): ActivationSnapshot => ({
    activated: false,
    met: [],
    environment: "production",
    applicable: true,
    ...overrides,
  });

  const done = snap({ activated: true, met: ["credentials", "network", "cutover"] });

  it("세 조건이 모두 충족되는 순간 완료 이벤트가 난다", () => {
    const event = judgeActivationEvent(snap({ met: ["credentials", "network"] }), done);
    expect(event?.kind).toBe("activation-completed");
    expect(event?.message).toContain("세 조건이 모두 충족");
    // 마지막으로 채워진 조건을 집어 준다 — 무엇 덕분에 됐는지가 다음에 쓰인다
    expect(event?.changed).toEqual(["cutover"]);
    expect(event?.urgent).toBe(false);
  });

  it("완료 상태가 유지되는 동안에는 다시 나지 않는다 — 소음이 된 알림은 꺼진다", () => {
    expect(judgeActivationEvent(done, done)).toBeNull();
  });

  it("풀리면 알린다 — 완료만 알리는 장치는 좋은 소식 전용이 된다", () => {
    const event = judgeActivationEvent(done, snap({ met: ["network", "cutover"] }));
    expect(event?.kind).toBe("activation-lost");
    expect(event?.changed).toEqual(["credentials"]);
    // 풀린 것이 완료보다 급하다
    expect(event?.urgent).toBe(true);
    expect(event?.message).toContain("되던 것이 안 되는 상태");
  });

  it("처음 관측에서는 이벤트를 내지 않는다 — 모르는 것을 사건으로 만들지 않는다", () => {
    expect(judgeActivationEvent(null, done)).toBeNull();
    expect(judgeActivationEvent(null, snap())).toBeNull();
  });

  it("전환 대상이 아닌 환경에서는 내지 않는다 — 개발의 초록불이 운영 알림이 되면 안 된다", () => {
    const devDone = snap({
      activated: true,
      met: ["credentials", "network", "cutover"],
      applicable: false,
      environment: "development",
    });
    expect(judgeActivationEvent(snap({ applicable: false }), devDone)).toBeNull();
  });

  it("조건이 늘어도 활성화 여부가 그대로면 이벤트가 아니다 — 진행 상황은 이력이 담당한다", () => {
    expect(
      judgeActivationEvent(snap({ met: ["credentials"] }), snap({ met: ["credentials", "network"] })),
    ).toBeNull();
  });

  it("같은 순번의 전이는 같은 키를 갖는다 — 두 인스턴스가 동시에 판정해도 한 번만 나간다", () => {
    const first = judgeActivationEvent(snap({ met: ["credentials", "network"] }), done);
    const second = judgeActivationEvent(snap({ met: ["network", "cutover"] }), done);
    expect(first?.key).toBe(second?.key);
  });

  it("풀렸다가 다시 완료되면 또 알린다 — 되살아난 것은 처음 된 것만큼 중요하다", () => {
    // TASK-3901에서 고친 것: 키에 조건 집합만 넣으면 두 번째 완료가 첫
    // 번째와 같은 키가 되어 **조용히 버려졌다**.
    const first = judgeActivationEvent(snap({ met: ["credentials", "network"] }), done, {
      sequence: 0,
    });
    const lost = judgeActivationEvent(done, snap({ met: ["network"] }), { sequence: 1 });
    const again = judgeActivationEvent(snap({ met: ["network"] }), done, { sequence: 2 });

    expect(first?.kind).toBe("activation-completed");
    expect(lost?.kind).toBe("activation-lost");
    expect(again?.kind).toBe("activation-completed");
    // 세 키가 모두 다르다 — 셋 다 알림이 나간다
    expect(new Set([first!.key, lost!.key, again!.key]).size).toBe(3);
  });
});
