// Errors we throw on purpose (wrong password, duplicate email, …).
// The error-handler middleware turns these into clean HTTP responses;
// anything else is treated as an unexpected 500.
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string) {
    return new ApiError(400, message);
  }

  static unauthorized(message = 'Not authenticated') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Not allowed') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }

  static conflict(message: string) {
    return new ApiError(409, message);
  }
}
