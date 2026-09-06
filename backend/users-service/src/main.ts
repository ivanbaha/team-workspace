import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LoggerService, createLogger } from '@tw/logger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // createLogger() reads config straight from the environment, so the window before the DI
  // container exists — including the failures that stop the service from starting — is logged in
  // the same JSON shape as everything else.
  const app = await NestFactory.create(AppModule, { logger: createLogger() });

  app.useLogger(app.get(LoggerService));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = Number(process.env.PORT ?? 4001);
  await app.listen(port);

  app.get(LoggerService).info(`users-service listening on port ${port}`, 'bootstrap');
}

void bootstrap();
