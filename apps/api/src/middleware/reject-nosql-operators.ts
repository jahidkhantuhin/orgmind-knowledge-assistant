import type { RequestHandler } from 'express';

const MAX_INSPECTED_VALUES = 20_000;
const MAX_OBJECT_DEPTH = 32;

export function containsMongoOperatorKey(input: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
  let inspected = 0;

  while (pending.length > 0 && inspected < MAX_INSPECTED_VALUES) {
    const current = pending.pop();
    if (!current) continue;
    inspected += 1;
    if (current.depth > MAX_OBJECT_DEPTH) return true;
    if (typeof current.value !== 'object' || current.value === null) {
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const value of current.value) pending.push({ value, depth: current.depth + 1 });
      continue;
    }
    for (const [key, value] of Object.entries(current.value)) {
      if (key.startsWith('$')) return true;
      pending.push({ value, depth: current.depth + 1 });
    }
  }
  return pending.length > 0;
}

export const rejectMongoOperatorKeys: RequestHandler = (req, res, next) => {
  if (containsMongoOperatorKey(req.body) || containsMongoOperatorKey(req.query)) {
    res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: 'Input contains a reserved database operator key.',
      },
    });
    return;
  }
  next();
};
