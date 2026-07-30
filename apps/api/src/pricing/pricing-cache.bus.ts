import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import Redis from "ioredis";

/** 무효화를 알리는 채널 — 인스턴스마다 같은 이름을 듣는다 */
export const PRICING_INVALIDATE_CHANNEL = "acos:pricing:invalidate";

/**
 * 실효 가격표 캐시 무효화 버스. (TASK-3201, Sprint 32 — CTO 정책 3201-⑤)
 *
 * **가격 적용 즉시 캐시를 무효화합니다.**
 *
 * 한 인스턴스가 적용해도 다른 인스턴스는 자기 캐시를 들고 있습니다. 그 사이에
 * 기록되는 비용은 **인스턴스마다 다른 단가**로 계산되고, 나중에 "왜 같은 시각의
 * 호출이 다른 금액인가"에 아무도 답할 수 없습니다. 그래서 적용한 인스턴스가
 * 나머지에게 **바로 알립니다**(Redis pub/sub).
 *
 * `REDIS_URL`이 없으면 **단일 인스턴스 모드**입니다(분산 잠금과 같은 판단,
 * 결정 1401-①). 그 경우 프로세스 내 무효화가 곧 전체 무효화이므로 버스가
 * 필요 없습니다 — **미구성은 실패가 아닙니다.** 다만 어느 모드인지는 상태에
 * 드러냅니다: 다중 인스턴스인데 단일 모드로 돌고 있으면 그것이 바로 사고입니다.
 *
 * 발행이 실패하면 **숨기지 않습니다** — 다른 인스턴스는 캐시 수명(TTL)이 지날
 * 때까지 옛 단가로 계산하므로, 그 사실을 로그와 응답이 말해야 합니다.
 */
@Injectable()
export class PricingCacheBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PricingCacheBus.name);
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private readonly listeners: ((reason: string) => void)[] = [];

  /** Redis로 전파하는가 — 아니면 단일 인스턴스 모드 */
  get distributed(): boolean {
    return this.publisher !== null;
  }

  onModuleInit(): void {
    const url = process.env.REDIS_URL;
    if (url === undefined || url.trim() === "") {
      this.logger.log(
        "가격표 캐시 무효화: 단일 인스턴스 모드 — 프로세스 내 무효화가 곧 전체 무효화입니다.",
      );
      return;
    }
    // 구독 연결은 발행에 쓸 수 없다(Redis 제약) — 두 개를 따로 둔다
    const options = { maxRetriesPerRequest: 2, lazyConnect: false };
    this.publisher = new Redis(url, options);
    this.subscriber = new Redis(url, options);
    // 연결이 끊겨도 서비스를 죽이지 않는다 — 캐시 수명이 안전망이다
    for (const client of [this.publisher, this.subscriber]) {
      client.on("error", (error: Error) => {
        this.logger.warn(`가격표 캐시 버스 연결 오류: ${error.message}`);
      });
    }
    void this.subscriber
      .subscribe(PRICING_INVALIDATE_CHANNEL)
      .then(() => {
        this.logger.log(
          `가격표 캐시 무효화 구독 시작 — ${PRICING_INVALIDATE_CHANNEL}`,
        );
      })
      .catch((error: unknown) => {
        this.logger.warn(`가격표 캐시 무효화 구독 실패: ${String(error)}`);
      });
    this.subscriber.on("message", (channel: string, message: string) => {
      if (channel !== PRICING_INVALIDATE_CHANNEL) {
        return;
      }
      for (const listener of this.listeners) {
        listener(message);
      }
    });
  }

  /** 무효화 신호를 받을 때 할 일 (PricingService가 자기 캐시를 버린다) */
  onInvalidate(listener: (reason: string) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 무효화를 알린다 — 전파에 성공하면 true.
   *
   * 단일 인스턴스 모드에서는 알릴 상대가 없으므로 false를 돌려주고, 호출부는
   * 그 사실을 상태에 담습니다("전파 없음"과 "전파 실패"는 다릅니다).
   */
  async publish(reason: string): Promise<boolean> {
    if (this.publisher === null) {
      return false;
    }
    try {
      await this.publisher.publish(PRICING_INVALIDATE_CHANNEL, reason);
      return true;
    } catch (error) {
      this.logger.warn(
        `가격표 캐시 무효화 발행 실패 — 다른 인스턴스는 캐시 수명이 지난 뒤 반영합니다: ${String(error)}`,
      );
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [this.publisher, this.subscriber].map(async (client) => {
        if (client !== null) {
          await client.quit().catch(() => undefined);
        }
      }),
    );
    this.publisher = null;
    this.subscriber = null;
  }
}
