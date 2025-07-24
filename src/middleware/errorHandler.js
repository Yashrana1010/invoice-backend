const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled error:', err);

  // Default error response
  let status = 500;
  let message = 'Internal server error';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Validation error';
  } else if (err.name === 'UnauthorizedError') {
    status = 401;
    message = 'Unauthorized';
  } else if (err.name === 'NotFoundError') {
    status = 404;
    message = 'Resource not found';
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

module.exports = {
  errorHandler
};
