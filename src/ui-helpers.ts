export const WARNING_BATCH_SIZE = 100;

interface FileSelection<T> {
  readonly files: ArrayLike<T> | null;
  value: string;
}

export interface ItemBatch<T> {
  readonly items: readonly T[];
  readonly nextCursor: number;
  readonly remaining: number;
}

export function consumeSelectedFile<T>(input: FileSelection<T>): T | undefined {
  const file = input.files?.[0];
  if (file !== undefined) input.value = "";
  return file;
}

export function nextItemBatch<T>(
  items: readonly T[],
  cursor: number,
  batchSize = WARNING_BATCH_SIZE,
): ItemBatch<T> {
  const end = Math.min(items.length, cursor + batchSize);
  return {
    items: items.slice(cursor, end),
    nextCursor: end,
    remaining: items.length - end,
  };
}
