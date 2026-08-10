import { describe, expect, it } from "vitest";

import {
  consumeSelectedFile,
  nextItemBatch,
  WARNING_BATCH_SIZE,
} from "./ui-helpers.js";

describe("UI helpers", () => {
  it("clears a consumed file input so selecting the same file fires again", () => {
    const file = { name: "submission.txt" };
    const input = { files: [file], value: "C:\\fakepath\\submission.txt" };

    expect(consumeSelectedFile(input)).toBe(file);
    expect(input.value).toBe("");
  });

  it("leaves an empty file input unchanged", () => {
    const input = { files: [] as object[], value: "" };

    expect(consumeSelectedFile(input)).toBeUndefined();
    expect(input.value).toBe("");
  });

  it("limits warning rendering to bounded batches", () => {
    const entries = Array.from({ length: WARNING_BATCH_SIZE * 2 + 17 }, (_, index) => index);
    const first = nextItemBatch(entries, 0);
    const second = nextItemBatch(entries, first.nextCursor);
    const third = nextItemBatch(entries, second.nextCursor);

    expect(first.items).toHaveLength(WARNING_BATCH_SIZE);
    expect(first.remaining).toBe(WARNING_BATCH_SIZE + 17);
    expect(second.items).toHaveLength(WARNING_BATCH_SIZE);
    expect(second.remaining).toBe(17);
    expect(third.items).toHaveLength(17);
    expect(third.remaining).toBe(0);
  });
});
