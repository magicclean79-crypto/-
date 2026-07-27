import { Injectable } from "@nestjs/common";
import { APP_NAME } from "@acos/shared";

@Injectable()
export class AppService {
  getInfo(): { name: string; docs: string } {
    return { name: APP_NAME, docs: "/health" };
  }

  getHealth(): string {
    return "OK";
  }
}
