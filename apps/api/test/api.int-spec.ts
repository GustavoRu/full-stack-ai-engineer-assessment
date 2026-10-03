import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { like } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { type Database, DRIZZLE } from '../src/database/database.module.js';
import { users } from '../src/database/schema.js';

// Runs the real app against the Compose database, with the offline LLM provider

const RUN = `int-${Date.now()}`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

type RequestOptions = {
  token?: string;
  json?: unknown;
  form?: Record<string, string>;
  raw?: { body: string; contentType: string };
};

let app: INestApplication;
let api: string;
let alice: string;
let bob: string;
let carol: string;

async function call(method: string, path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.form) {
    const form = new FormData();
    for (const [name, value] of Object.entries(options.form)) form.append(name, value);
    body = form;
  } else if (options.raw) {
    headers['Content-Type'] = options.raw.contentType;
    body = options.raw.body;
  }

  const response = await fetch(`${api}${path}`, { method, headers, body });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function signUp(name: string): Promise<string> {
  const reply = await call('POST', '/auth/register', {
    json: { email: `${RUN}-${name}@example.com`, password: 'correct-horse' },
  });
  expect(reply.status).toBe(201);
  return reply.body.accessToken;
}

async function upload(token: string, text: string, title?: string): Promise<{ id: string; title: string }> {
  const reply = await call('POST', '/documents', { token, form: title ? { text, title } : { text } });
  expect(reply.status).toBe(201);
  return reply.body;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  api = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;

  alice = await signUp('alice');
  bob = await signUp('bob');
  carol = await signUp('carol');
});

afterAll(async () => {
  // Cascades to the documents, chunks and questions these users created
  await app.get<Database>(DRIZZLE).delete(users).where(like(users.email, `${RUN}-%`));
  await app.close();
});

describe('isolation between users', () => {
  it("hides one user's document from another on every route", async () => {
    const document = await upload(alice, 'Paris is the capital of France.');
    const path = `/documents/${document.id}`;

    expect((await call('GET', path, { token: bob })).status).toBe(404);
    expect((await call('DELETE', path, { token: bob })).status).toBe(404);
    expect((await call('GET', `${path}/questions`, { token: bob })).status).toBe(404);
    expect((await call('POST', `${path}/questions`, { token: bob, json: { question: 'Capital?' } })).status).toBe(404);

    expect((await call('GET', '/documents', { token: bob })).body).toEqual([]);
    expect((await call('GET', path, { token: alice })).status).toBe(200);
  });

  it('rejects every protected route without a token', async () => {
    expect((await call('GET', '/documents')).status).toBe(401);
    expect((await call('POST', '/documents', { form: { text: 'hello' } })).status).toBe(401);
    expect((await call('GET', `/documents/${MISSING_ID}`)).status).toBe(401);
    expect((await call('DELETE', `/documents/${MISSING_ID}`)).status).toBe(401);
    expect((await call('GET', `/documents/${MISSING_ID}/questions`)).status).toBe(401);
    expect((await call('POST', `/documents/${MISSING_ID}/questions`, { json: { question: 'Hi?' } })).status).toBe(401);
  });
});

describe('retrieval', () => {
  it('searches only the chunks of the document being asked about', async () => {
    const france = await upload(alice, 'Paris is the capital of France.');
    await upload(alice, 'Berlin is the capital of Germany.');

    // The question matches the other document better, so an unscoped search would cite it
    const reply = await call('POST', `/documents/${france.id}/questions`, {
      token: alice,
      json: { question: 'Is Berlin the capital of Germany?' },
    });

    expect(reply.status).toBe(201);
    // The offline model quotes the nearest source, so the answer shows which chunk won the search
    expect(reply.body.answer).toBe('[mock] Paris is the capital of France.');
    expect(reply.body.citations).toEqual([{ chunkIndex: 0, content: 'Paris is the capital of France.' }]);
  });
});

describe('malformed input', () => {
  it('answers 400 when the upload has no usable body', async () => {
    expect((await call('POST', '/documents', { token: carol })).status).toBe(400);
    expect((await call('POST', '/documents', { token: carol, json: {} })).status).toBe(400);
    const plainText = { body: 'hello', contentType: 'text/plain' };
    expect((await call('POST', '/documents', { token: carol, raw: plainText })).status).toBe(400);
  });

  it('answers 400 for malformed JSON', async () => {
    const reply = await call('POST', '/auth/login', { raw: { body: '{"email":', contentType: 'application/json' } });
    expect(reply.status).toBe(400);
  });

  it('stores a title and a question clean when they carry null characters', async () => {
    const document = await upload(carol, 'Paris is the capital of France.', 'Capitals\u0000 of Europe');
    expect(document.title).toBe('Capitals of Europe');

    const reply = await call('POST', `/documents/${document.id}/questions`, {
      token: carol,
      json: { question: 'What is\u0000 the capital?' },
    });
    expect(reply.status).toBe(201);
    expect(reply.body.question).toBe('What is the capital?');
  });
});

describe('deletion', () => {
  it('removes a document together with its questions', async () => {
    const document = await upload(alice, 'Paris is the capital of France.');
    const path = `/documents/${document.id}`;
    expect((await call('POST', `${path}/questions`, { token: alice, json: { question: 'Capital?' } })).status).toBe(201);

    expect((await call('DELETE', path, { token: alice })).status).toBe(204);
    expect((await call('GET', `${path}/questions`, { token: alice })).status).toBe(404);
    expect((await call('GET', path, { token: alice })).status).toBe(404);
  });
});
