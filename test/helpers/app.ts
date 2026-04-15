import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

export async function closeTestApp(app: INestApplication | undefined) {
  if (app) await app.close();
}
