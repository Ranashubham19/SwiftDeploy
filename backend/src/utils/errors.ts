export class AppError extends Error {
  public readonly statusCode: number;
  public readonly expose: boolean;

  public constructor(message: string, statusCode = 500, expose = false) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export const isAbortError = (error: unknown): boolean => {
  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      error.message.includes("aborted") ||
      error.message.includes("The operation was aborted")
    );
  }
  return false;
};

export const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "Unknown error");
};
