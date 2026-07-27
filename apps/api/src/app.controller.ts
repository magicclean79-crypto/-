import { Controller, Get } from "@nestjs/common";
import { AppService } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRoot(): { name: string; docs: string } {
    return this.appService.getInfo();
  }

  @Get("health")
  getHealth(): string {
    return this.appService.getHealth();
  }
}
