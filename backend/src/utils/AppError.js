'use strict';

/**
 * A custom error type that carries an HTTP status code.
 * Throw this from services/controllers and the errorHandler will use the code.
 *
 * Example:
 *   throw new AppError('Invalid Instagram URL', 400);
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    Error.captureStackTrace?.(this, AppError);
  }
}

module.exports = AppError;
