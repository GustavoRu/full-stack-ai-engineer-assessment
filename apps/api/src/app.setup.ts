import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { requestLogger } from './common/request-logger.js';
import type { Env } from './config/env.js';

// Shared by the server entry point and the integration tests, so both run the same pipeline
export function configureApp(app: INestApplication): ConfigService<Env, true> {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix('api');
  app.use(requestLogger());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }) });
  app.enableShutdownHooks();

  // Behind a load balancer the client address comes from X-Forwarded-For
  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', proxyHops);
  }

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

  return config;
}
