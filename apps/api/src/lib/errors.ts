/** Stable application errors mapped to documented error codes. */
import type { ErrorCode } from "@heat/domain";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const invalidRequest = (m = "Invalid request") =>
  new AppError("INVALID_REQUEST", m, 400);
export const authRequired = (m = "Authentication required") =>
  new AppError("AUTH_REQUIRED", m, 401);
export const rateLimited = (m = "Too many requests") =>
  new AppError("RATE_LIMITED", m, 429);
export const eventNotFound = () => new AppError("EVENT_NOT_FOUND", "Event not found", 404);
export const duplicateLikely = (m = "Duplicate event likely") =>
  new AppError("DUPLICATE_EVENT_LIKELY", m, 409);
export const routeUnavailable = (m = "No route available for requested modes") =>
  new AppError("ROUTE_UNAVAILABLE", m, 422);
export const locationRequired = (m = "A valid origin location is required") =>
  new AppError("LOCATION_REQUIRED", m, 400);
export const locationRequiredError = locationRequired;
export const internalError = (m = "Internal error") =>
  new AppError("INTERNAL_ERROR", m, 500);
