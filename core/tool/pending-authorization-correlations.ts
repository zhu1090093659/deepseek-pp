export class PendingAuthorizationCorrelations {
  private readonly pending = new Set<string>();
  private readonly terminated = new Set<string>();

  begin(correlationId: string): boolean {
    if (this.pending.has(correlationId)) return false;
    this.pending.add(correlationId);
    return true;
  }

  terminate(correlationId: string): void {
    if (this.pending.has(correlationId)) this.terminated.add(correlationId);
  }

  terminateAll(): void {
    for (const correlationId of this.pending) this.terminated.add(correlationId);
  }

  activate(correlationId: string): boolean {
    const ended = this.terminated.delete(correlationId);
    this.pending.delete(correlationId);
    return ended;
  }

  finish(correlationId: string): void {
    this.pending.delete(correlationId);
    this.terminated.delete(correlationId);
  }
}
