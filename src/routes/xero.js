// routes/xero.js
const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const TokenStore = require('../services/tokenStore');

const router = express.Router();

// GET /xero/auth - Initiate Xero OAuth flow
router.get('/auth', (req, res) => {
  try {
    const client_id = process.env.XERO_CLIENT_ID;
    const callback_url = process.env.XERO_CALLBACK_URL;

    if (!client_id || !callback_url) {
      logger.error('Missing Xero OAuth configuration');
      return res.status(500).json({
        error: 'Server configuration error - missing OAuth credentials'
      });
    }

    // Generate state parameter for security
    const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // Xero OAuth 2.0 authorization URL
    const authUrl = new URL('https://login.xero.com/identity/connect/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', client_id);
    authUrl.searchParams.append('redirect_uri', callback_url);
    authUrl.searchParams.append('scope', 'openid profile email accounting.transactions accounting.contacts');
    authUrl.searchParams.append('state', state);

    logger.info('Initiating Xero OAuth flow', {
      clientId: client_id.substring(0, 8) + '...',
      redirectUri: callback_url,
      state: state
    });

    res.json({
      authUrl: authUrl.toString(),
      state: state
    });

  } catch (error) {
    logger.error('Error initiating Xero auth:', error);
    res.status(500).json({ error: 'Failed to initiate authentication' });
  }
});

// POST /xero/callback - Handle OAuth callback and token exchange
router.post('/callback', async (req, res) => {
  const requestId = req.requestId || 'unknown';

  logger.info(`[${requestId}] Xero OAuth callback received`, {
    requestId,
    hasCode: !!req.body.code,
    hasState: !!req.body.state
  });

  try {
    const { code, state } = req.body;

    if (!code) {
      logger.error(`[${requestId}] No authorization code provided`);
      return res.status(400).json({
        error: 'No authorization code provided',
        requestId
      });
    }

    logger.info(`[${requestId}] Processing authorization code`, {
      requestId,
      codeLength: code.length,
      state: state
    });

    // Get environment variables
    const client_id = process.env.XERO_CLIENT_ID;
    const client_secret = process.env.XERO_CLIENT_SECRET;
    const callback_url = process.env.XERO_CALLBACK_URL;

    if (!client_id || !client_secret || !callback_url) {
      logger.error(`[${requestId}] Missing required environment variables`, {
        requestId,
        hasClientId: !!client_id,
        hasClientSecret: !!client_secret,
        hasCallbackUrl: !!callback_url
      });
      return res.status(500).json({
        error: 'Server configuration error - missing environment variables',
        requestId
      });
    }

    logger.info(`[${requestId}] Environment variables validated`, {
      requestId,
      clientId: client_id.substring(0, 8) + '...',
      callbackUrl: callback_url
    });

    // Prepare token exchange request
    const tokenData = {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: callback_url,
    };

    const formData = new URLSearchParams(tokenData).toString();
    const basicAuth = Buffer.from(`${client_id}:${client_secret}`).toString('base64');

    logger.info(`[${requestId}] Sending token exchange request to Xero`, {
      requestId,
      grantType: tokenData.grant_type,
      redirectUri: tokenData.redirect_uri
    });

    const startTime = Date.now();

    const response = await axios.post(
      'https://identity.xero.com/connect/token',
      formData,
      {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        timeout: 15000, // 15 seconds
      }
    );

    const responseTime = Date.now() - startTime;

    logger.info(`[${requestId}] Token exchange successful`, {
      requestId,
      responseTime,
      status: response.status,
      tokenType: response.data.token_type,
      expiresIn: response.data.expires_in,
      hasAccessToken: !!response.data.access_token,
      hasRefreshToken: !!response.data.refresh_token,
      hasIdToken: !!response.data.id_token
    });

    const { access_token, refresh_token, id_token, expires_in, token_type } = response.data;

    // Decode user info from id_token if present
    let user_info = null;
    if (id_token) {
      try {
        logger.info(`[${requestId}] Decoding ID token`);

        const tokenParts = id_token.split('.');
        if (tokenParts.length === 3) {
          const base64Url = tokenParts[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(
            Buffer.from(base64, 'base64')
              .toString()
              .split('')
              .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
              .join('')
          );
          user_info = JSON.parse(jsonPayload);

          logger.info(`[${requestId}] ID token decoded successfully`, {
            requestId,
            userEmail: user_info.email,
            userName: user_info.name || `${user_info.given_name} ${user_info.family_name}`,
            userId: user_info.sub
          });
        }
      } catch (decodeError) {
        logger.error(`[${requestId}] Failed to decode ID token`, {
          requestId,
          error: decodeError.message
        });
      }
    }

    // Get tenant information
    let tenants = [];
    try {
      logger.info(`[${requestId}] Fetching tenant information`);
      const tenantsResponse = await axios.get('https://api.xero.com/connections', {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        }
      });
      tenants = tenantsResponse.data;
      logger.info(`[${requestId}] Found ${tenants.length} tenants`);
    } catch (tenantError) {
      logger.error(`[${requestId}] Failed to fetch tenants`, {
        requestId,
        error: tenantError.message
      });
    }

    // Store tokens for the user (using both email and sub for lookup)
    let userId = null;
    if (user_info && (user_info.email || user_info.sub)) {
      const email = user_info.email;
      const sub = user_info.sub;

      // Store tokens with tenant ID
      const tokensToStore = {
        access_token,
        refresh_token,
        expires_in,
        tenant_id: tenants.length > 0 ? tenants[0].tenantId : process.env.XERO_TENANT_ID
      };

      // Store tokens using email as primary identifier (if available)
      if (email) {
        userId = email;
        TokenStore.storeUserTokens(email, tokensToStore);
        logger.info(`[${requestId}] Stored tokens for user ${email}`);
      }

      // Also store tokens using sub as identifier for access token lookups
      if (sub && sub !== email) {
        TokenStore.storeUserTokens(sub, tokensToStore);
        logger.info(`[${requestId}] Stored tokens for sub ${sub}`);
      }

      // Set primary userId for response
      userId = email || sub;
    }

    // Return tokens to frontend
    const responseData = {
      access_token,
      refresh_token,
      id_token,
      expires_in,
      token_type,
      user_info,
      tenants,
      timestamp: new Date().toISOString(),
      userId: userId
    };

    logger.info(`[${requestId}] Sending tokens to frontend`, {
      requestId,
      hasAccessToken: !!access_token,
      hasRefreshToken: !!refresh_token,
      expiresIn: expires_in
    });

    res.json(responseData);

  } catch (error) {
    const responseTime = Date.now() - (req.startTime || Date.now());

    logger.error(`[${requestId}] Token exchange failed`, {
      requestId,
      responseTime,
      error: {
        message: error.message,
        name: error.name,
        code: error.code
      }
    });

    if (error.response) {
      logger.error(`[${requestId}] Xero API error response`, {
        requestId,
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });

      const xeroError = error.response.data;
      if (xeroError && xeroError.error) {
        return res.status(400).json({
          error: `${xeroError.error}: ${xeroError.error_description || 'Unknown error'}`,
          requestId,
          xeroErrorCode: xeroError.error
        });
      }

      // Handle specific HTTP status codes
      if (error.response.status === 400) {
        return res.status(400).json({
          error: 'Bad Request - Invalid authorization code or configuration',
          requestId,
          details: 'The authorization code may have expired or already been used'
        });
      } else if (error.response.status === 401) {
        return res.status(401).json({
          error: 'Unauthorized - Invalid client credentials',
          requestId,
          details: 'Check your XERO_CLIENT_ID and XERO_CLIENT_SECRET'
        });
      }
    } else if (error.request) {
      logger.error(`[${requestId}] Network error during token exchange`, {
        requestId,
        error: 'No response received from Xero'
      });

      return res.status(503).json({
        error: 'Service unavailable - Could not reach Xero token endpoint',
        requestId
      });
    }

    res.status(500).json({
      error: 'Token exchange failed',
      requestId,
      message: error.message
    });
  }
});

// GET /xero/auth/url - Generate authorization URL (optional helper endpoint)
router.get('/auth/url', (req, res) => {
  const requestId = req.requestId || 'unknown';

  try {
    const client_id = process.env.XERO_CLIENT_ID;
    const callback_url = process.env.XERO_CALLBACK_URL;
    const scopes = process.env.XERO_SCOPES || 'openid profile email accounting.settings accounting.reports.read accounting.journals.read accounting.contacts accounting.attachments';

    if (!client_id || !callback_url) {
      return res.status(500).json({
        error: 'Server configuration error',
        requestId
      });
    }

    // Generate a random state parameter for CSRF protection
    const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const authUrl = `https://login.xero.com/identity/connect/authorize?` +
      `response_type=code&` +
      `client_id=${encodeURIComponent(client_id)}&` +
      `redirect_uri=${encodeURIComponent(callback_url)}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `state=${state}`;

    logger.info(`[${requestId}] Generated Xero auth URL`, {
      requestId,
      state,
      scopes
    });

    res.json({
      authUrl,
      state,
      requestId
    });

  } catch (error) {
    logger.error(`[${requestId}] Failed to generate auth URL`, {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to generate authorization URL',
      requestId
    });
  }
});

// POST /xero/store-tokens - Store tokens for a user
router.post('/store-tokens', async (req, res) => {
  const requestId = req.requestId || 'unknown';

  try {
    const { userId, access_token, refresh_token, expires_in, tenant_id } = req.body;

    if (!userId || !access_token) {
      return res.status(400).json({
        error: 'userId and access_token are required',
        requestId
      });
    }

    const tokensToStore = {
      access_token,
      refresh_token,
      expires_in: expires_in || 1800, // default 30 minutes
      tenant_id: tenant_id || process.env.XERO_TENANT_ID
    };

    TokenStore.storeUserTokens(userId, tokensToStore);

    logger.info(`[${requestId}] Tokens stored for user ${userId}`);

    res.json({
      success: true,
      message: 'Tokens stored successfully',
      requestId
    });

  } catch (error) {
    logger.error(`[${requestId}] Failed to store tokens`, {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to store tokens',
      requestId
    });
  }
});

// GET /xero/tokens/status - Check if user has valid tokens
router.get('/tokens/status', (req, res) => {
  const requestId = req.requestId || 'unknown';
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({
      error: 'userId is required',
      requestId
    });
  }

  const hasValidTokens = TokenStore.hasValidTokens(userId);

  res.json({
    hasValidTokens,
    userId,
    requestId
  });
});

// GET /xero/tokens/debug - Debug endpoint to see all stored tokens (development only)
router.get('/tokens/debug', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoint not available in production' });
  }

  const allTokens = TokenStore.listAllTokens();
  res.json({
    tokens: allTokens,
    count: Object.keys(allTokens).length
  });
});

module.exports = router;