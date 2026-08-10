export class LatestRequestTracker {
  private latestRequestId: number | undefined;

  begin(requestId: number): void {
    this.latestRequestId = requestId;
  }

  isLatest(requestId: number): boolean {
    return requestId === this.latestRequestId;
  }
}
