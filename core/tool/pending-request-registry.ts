export class PendingRequestRegistry<T> {
  private readonly requests = new Map<string, Map<string, T>>();

  set(requestId: string, key: string, value: T): void {
    const entries = this.requests.get(requestId) ?? new Map();
    entries.set(key, value);
    this.requests.set(requestId, entries);
  }

  delete(requestId: string, key: string): void {
    const entries = this.requests.get(requestId);
    if (!entries) return;
    entries.delete(key);
    if (entries.size === 0) this.requests.delete(requestId);
  }

  drain(requestId: string): T[] {
    const entries = this.requests.get(requestId);
    if (!entries) return [];
    this.requests.delete(requestId);
    return [...entries.values()];
  }
}
