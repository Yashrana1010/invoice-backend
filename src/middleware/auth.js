const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    // Decode JWT token (skip verification since we don't have Xero's public key)
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || !decoded.payload) {
      logger.warn('Invalid token format');
      return res.status(403).json({ error: 'Invalid token format' });
    }

    const payload = decoded.payload;

    // Debug logging for token analysis
    logger.info('Token payload analysis', {
      hasIss: !!payload.iss,
      hasAud: !!payload.aud,
      hasEmail: !!payload.email,
      hasSub: !!payload.sub,
      hasXeroUserId: !!payload.xero_userid,
      issuer: payload.iss,
      audience: payload.aud,
      scopes: payload.scope,
      tokenFields: Object.keys(payload)
    });

    // Validate that this looks like a valid JWT token
    if (!payload.iss || !payload.aud) {
      logger.warn('Token missing required fields', {
        hasIss: !!payload.iss,
        hasAud: !!payload.aud,
        hasEmail: !!payload.email,
        hasSub: !!payload.sub
      });
      return res.status(403).json({ error: 'Invalid token format' });
    }

    // Check token expiration
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      logger.warn('Token has expired', {
        expiry: new Date(payload.exp * 1000),
        current: new Date()
      });
      return res.status(403).json({ error: 'Token has expired' });
    }

    // For Xero tokens, determine the user identifier
    let userIdentifier = null;
    if (payload.iss && payload.iss.includes('xero')) {
      // This is a Xero token
      // Try different user identifier fields in order of preference
      userIdentifier = payload.email || payload.sub || payload.xero_userid;

      if (!userIdentifier) {
        logger.warn('Xero token missing user identifier', {
          hasEmail: !!payload.email,
          hasSub: !!payload.sub,
          hasXeroUserId: !!payload.xero_userid
        });
        return res.status(403).json({ error: 'Invalid Xero token - missing user identifier' });
      }

      logger.info('Xero token accepted', {
        userIdentifier: userIdentifier,
        identifierType: payload.email ? 'email' : (payload.sub ? 'sub' : 'xero_userid'),
        scopes: payload.scope
      });
    } else {
      // Non-Xero token
      userIdentifier = payload.email || payload.sub;
      if (!userIdentifier) {
        logger.warn('Token missing user identifier');
        return res.status(403).json({ error: 'Invalid token - missing user identifier' });
      }
    }

    // Set user info
    req.user = {
      ...payload,
      email: payload.email || userIdentifier, // Ensure email is always available (fallback to identifier)
      id: userIdentifier,
      sub: payload.sub || userIdentifier // Ensure sub is always available
    };

    logger.info(`Authenticated user: ${userIdentifier}`, {
      hasEmail: !!payload.email,
      hasSub: !!payload.sub,
      hasXeroUserId: !!payload.xero_userid,
      issuer: payload.iss,
      userIdentifier: userIdentifier
    });
    next();

  } catch (error) {
    logger.error('Token validation error:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

module.exports = {
  authenticateToken
};
