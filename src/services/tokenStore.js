const logger = require('../utils/logger');

// In-memory token store (in production, use Redis or database)
const tokenStore = new Map();

class TokenStore {
  static storeUserTokens(userId, tokens) {
    logger.info(`Storing tokens for user ${userId}`);
    tokenStore.set(userId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000),
      tenant_id: tokens.tenant_id,
      stored_at: Date.now()
    });
  }

  static getUserTokens(userId) {
    const tokens = tokenStore.get(userId);
    if (!tokens) {
      logger.warn(`No tokens found for user ${userId}`);
      return null;
    }

    // Check if token is expired
    if (Date.now() >= tokens.expires_at) {
      logger.warn(`Tokens expired for user ${userId}`);
      this.clearUserTokens(userId);
      return null;
    }

    return tokens;
  }

  static clearUserTokens(userId) {
    logger.info(`Clearing tokens for user ${userId}`);
    tokenStore.delete(userId);
  }

  static hasValidTokens(userId) {
    const tokens = this.getUserTokens(userId);
    return tokens !== null && tokens.access_token;
  }

  static getAccessToken(userId) {
    const tokens = this.getUserTokens(userId);
    return tokens ? tokens.access_token : null;
  }

  static getTenantId(userId) {
    const tokens = this.getUserTokens(userId);
    return tokens ? tokens.tenant_id : null;
  }

  // For development - list all stored tokens
  static listAllTokens() {
    const result = {};
    for (const [userId, tokens] of tokenStore.entries()) {
      result[userId] = {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresAt: new Date(tokens.expires_at).toISOString(),
        tenantId: tokens.tenant_id,
        storedAt: new Date(tokens.stored_at).toISOString()
      };
    }
    return result;
  }
}

module.exports = TokenStore;
