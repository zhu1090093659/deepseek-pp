import { vi, type Mock } from 'vitest';

export function createFetchStub(
  impl: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>,
): typeof fetch {
  return Object.assign(impl, fetch);
}