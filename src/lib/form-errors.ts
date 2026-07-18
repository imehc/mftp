export function firstFormError(errors: unknown[]): string | null {
  const error = errors[0];
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : String(message);
  }
  return String(error);
}
