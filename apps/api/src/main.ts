import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }) });
  app.enableShutdownHooks();

  if (config.get('API_DOCS_ENABLED', { infer: true })) {
    const docsConfig = new DocumentBuilder()
      .setTitle('Document Q&A Assistant')
      .setDescription('Upload a document and ask questions answered from it with citations.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    // Served at /api/docs, with the OpenAPI JSON at /api/docs-json
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, docsConfig), {
      useGlobalPrefix: true,
    });
  }

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
