import { describe, expect, it } from "vitest";

import { LatestRequestTracker } from "./latest-request.js";

describe("LatestRequestTracker", () => {
  it("invalidates an older request as soon as a newer request begins", () => {
    const tracker = new LatestRequestTracker();
    tracker.begin(1);
    expect(tracker.isLatest(1)).toBe(true);

    tracker.begin(2);
    expect(tracker.isLatest(1)).toBe(false);
    expect(tracker.isLatest(2)).toBe(true);
  });
});
