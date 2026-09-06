export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (m: string, code = "bad_request") => new AppError(m, 400, code);
export const unauthorized = (m = "Authentication required") => new AppError(m, 401, "unauthorized");
export const forbidden = (m = "Not permitted") => new AppError(m, 403, "forbidden");
export const notFound = (m: string) => new AppError(m, 404, "not_found");
export const conflict = (m: string, code = "conflict") => new AppError(m, 409, code);
