export type ServiceErrorCode =
  | "EMAIL_TAKEN"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_NOT_VERIFIED"
  | "ACCOUNT_DISABLED"
  | "INVALID_OR_EXPIRED_TOKEN"
  | "USER_NOT_FOUND"
  | "SUBSCRIPTION_NOT_FOUND"
  | "QUERY_LIMIT_EXCEEDED";

export class ServiceError extends Error {
  code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}
