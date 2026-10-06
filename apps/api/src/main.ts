import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  // One JSON object per line, so log tools can filter by field
  const app = await NestFactory.create(AppModule, { logger: new ConsoleLogger({ json: true }) });
  const config = configureApp(app);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
