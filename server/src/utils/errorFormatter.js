class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function formatErrorResponse(err) {
  if (err instanceof AppError) {
    return {
      success: false,
      error: {
        message: err.message,
        ...(err.details && { details: err.details }),
      },
    };
  }

  return {
    success: false,
    error: {
      message: 'Internal server error',
    },
  };
}

module.exports = { AppError, formatErrorResponse };
