import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = configureApp(app);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
