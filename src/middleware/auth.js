const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // Accept both JWT (from backend) and Xero access tokens (which are JWTs but signed by Xero)
  const jwtSecret = process.env.JWT_SECRET;

  // Try to verify with backend secret first
  require('jsonwebtoken').verify(token, jwtSecret, (err, user) => {
    if (!err) {
      req.user = user;
      return next();
    }

    // If verification fails due to "invalid algorithm", try to decode as Xero JWT (skip verification)
    if (err.name === 'JsonWebTokenError' && err.message === 'invalid algorithm') {
      try {
        const decoded = require('jsonwebtoken').decode(token, { complete: true });
        if (decoded && decoded.payload && decoded.payload.iss && decoded.payload.aud) {
          // Optionally, add more checks for Xero tokens here
          req.user = decoded.payload;
          return next();
        }
      } catch (decodeErr) {
        // fall through to error
      }
    }

    // If not a valid backend JWT or Xero JWT, reject
    return res.status(403).json({ error: 'Invalid or expired token' });
  });
}

module.exports = {
  authenticateToken
};
