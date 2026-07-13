export class AppError extends Error {
  constructor(
    message: string,
    public readonly code = 'unexpected_error',
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function toAppError(error: unknown, fallback = 'Something went wrong.'): AppError {
  if (error instanceof AppError) return error
  if (error instanceof Error) return new AppError(error.message || fallback, 'unexpected_error', error)
  return new AppError(fallback, 'unexpected_error', error)
}
