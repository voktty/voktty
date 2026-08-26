export class CompletionHealth {
  private failures = 0;
  private pausedUntil = 0;

  constructor(
    private readonly failureLimit = 3,
    private readonly pauseMs = 60_000,
  ) {}

  canRequest(manual: boolean, now = Date.now()): boolean {
    return manual || now >= this.pausedUntil;
  }

  recordFailure(now = Date.now()): number | null {
    this.failures++;
    if (this.failures < this.failureLimit) return null;
    this.failures = 0;
    this.pausedUntil = now + this.pauseMs;
    return this.pausedUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.pausedUntil = 0;
  }

  getPauseUntil(): number {
    return this.pausedUntil;
  }
}
