export class NewDesignError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly issues?: Record<string, string>,
  ) {
    super(message);
  }
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new NewDesignError(message, 404);
  return value;
}
