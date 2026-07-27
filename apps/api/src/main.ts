import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.WEB_URL ?? "http://localhost:3000",
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API server is running on http://localhost:${port}`, "Bootstrap");
}

bootstrap();
