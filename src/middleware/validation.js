const logger = require('../utils/logger');

function validateRequest(schema) {
  return (req, res, next) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      logger.warn(`Validation error: ${error.message}`);
      res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      });
    }
  };
}

module.exports = {
  validateRequest
};
