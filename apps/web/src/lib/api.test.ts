import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, emailFromToken, messageOf, tokenStore } from '@/lib/api';

const fetchMock = vi.fn();

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  window.localStorage.clear();
});

describe('apiFetch', () => {
  it('sends JSON with the stored token and returns the parsed body', async () => {
    tokenStore.set('abc');
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'q-1' }));

    const result = await apiFetch<{ id: string }>('/documents/d-1/questions', {
      method: 'POST',
      json: { question: 'Why?' },
    });

    expect(result).toEqual({ id: 'q-1' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/documents/d-1/questions', {
      method: 'POST',
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
      body: '{"question":"Why?"}',
    });
  });

  it('sends form data without a content type, so the browser adds the boundary', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'd-1' }));
    const formData = new FormData();
    formData.append('text', 'hello');

    await apiFetch('/documents', { method: 'POST', formData });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/documents', {
      method: 'POST',
      headers: {},
      body: formData,
    });
  });

  it('returns undefined for a 204 response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch('/documents/d-1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('joins a list of validation messages into one readable message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { message: ['email must be an email', 'password is too short'], error: 'Bad Request' }),
    );
    await expect(apiFetch('/auth/register', { method: 'POST', json: {} })).rejects.toMatchObject({
      status: 400,
      message: 'email must be an email. password is too short',
    });
  });

  it('uses the message of the API for other errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'Document not found' }));
    const failure = apiFetch('/documents/d-9');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 404, message: 'Document not found' });
  });

  it('shows one fixed message when rate limited', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { message: 'ThrottlerException: Too Many Requests' }));
    await expect(apiFetch('/documents')).rejects.toMatchObject({
      status: 429,
      message: 'Limit reached. Try again in a minute.',
    });
  });

  it('reports a network failure with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(apiFetch('/documents')).rejects.toMatchObject({
      status: 0,
      message: 'Could not reach the server. Check your connection and try again.',
    });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(apiFetch('/documents')).rejects.toMatchObject({
      status: 502,
      message: 'Request failed with status 502',
    });
  });
});

describe('session handling', () => {
  it('clears an expired session on 401 and tells subscribers', async () => {
    tokenStore.set('expired');
    const listener = vi.fn();
    const unsubscribe = tokenStore.subscribe(listener);
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Invalid or expired token' }));

    await expect(apiFetch('/documents')).rejects.toMatchObject({
      status: 401,
      message: 'Your session expired. Sign in again.',
    });
    expect(tokenStore.get()).toBeNull();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps the API message on 401 when there was no session, as with wrong credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Invalid credentials' }));
    await expect(apiFetch('/auth/login', { method: 'POST', json: {} })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials',
    });
  });

  it('notices a sign-out or sign-in made in another tab', () => {
    const listener = vi.fn();
    const unsubscribe = tokenStore.subscribe(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'docqa.token', newValue: null }));
    expect(listener).toHaveBeenCalledTimes(1);

    // Another key, or a change that is not ours, is ignored
    window.dispatchEvent(new StorageEvent('storage', { key: 'something.else', newValue: 'x' }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: 'docqa.token', newValue: 'abc' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('remembers once that the last session ended by expiring', async () => {
    tokenStore.set('expired');
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Invalid or expired token' }));
    await expect(apiFetch('/documents')).rejects.toBeInstanceOf(ApiError);

    expect(tokenStore.consumeExpired()).toBe(true);
    expect(tokenStore.consumeExpired()).toBe(false);
  });

  it('does not report an expiry when the user signs out', () => {
    tokenStore.set('abc');
    tokenStore.clear();
    expect(tokenStore.consumeExpired()).toBe(false);
  });

  it('stops notifying a listener after it unsubscribes', () => {
    const listener = vi.fn();
    tokenStore.subscribe(listener)();
    tokenStore.set('abc');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('reads the email from a token payload', () => {
    const token = ['header', btoa(JSON.stringify({ sub: 'u-1', email: 'ada@example.com' })), 'signature'].join('.');
    expect(emailFromToken(token)).toBe('ada@example.com');
  });

  it('returns null for a token it cannot read', () => {
    expect(emailFromToken('not-a-token')).toBeNull();
    expect(emailFromToken('a.%%%.c')).toBeNull();
  });

  it('turns any thrown value into a message', () => {
    expect(messageOf(new ApiError(404, 'Document not found'))).toBe('Document not found');
    expect(messageOf('boom')).toBe('Something went wrong. Try again.');
  });
});
