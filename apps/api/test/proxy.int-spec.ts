import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

// The login route allows 10 requests per minute per client address

let app: INestApplication;
let api: string;

async function login(forwardedFor: string): Promise<number> {
  const response = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
  });
  return response.status;
}

beforeAll(async () => {
  // Set before the module is imported, because the configuration is read at import time
  process.env.TRUST_PROXY_HOPS = '1';
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  api = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  delete process.env.TRUST_PROXY_HOPS;
  await app.close();
});

describe('rate limits behind a proxy', () => {
  it('counts each forwarded client address separately', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push(await login('203.0.113.10'));

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);

    // Another client is not affected by the first one's limit
    expect(await login('203.0.113.20')).toBe(401);
  });
});
