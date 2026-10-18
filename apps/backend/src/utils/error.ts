export class AppError extends Error {
    public status_code: number;

    constructor(message: string, status_code: number = 500) {
      super(message);
      this.status_code = status_code;

      Object.setPrototypeOf(this, AppError.prototype);
    }
  }
