#!/usr/bin/env node

/**
 * OAuth Timing Test Script
 * This script helps identify timing issues with authorization codes
 */

require('dotenv').config();
const axios = require('axios');

async function testOAuthTiming() {
  console.log('🕒 Testing OAuth Code Timing...\n');

  // Step 1: Generate auth URL
  const client_id = process.env.XERO_CLIENT_ID;
  const callback_url = process.env.XERO_CALLBACK_URL;
  const scopes = process.env.XERO_SCOPES || 'openid profile email offline_access accounting.transactions accounting.contacts';

  if (!client_id || !callback_url) {
    console.log('❌ Missing XERO_CLIENT_ID or XERO_CALLBACK_URL');
    return;
  }

  const authUrl = new URL('https://login.xero.com/identity/connect/authorize');
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', client_id);
  authUrl.searchParams.append('redirect_uri', callback_url);
  authUrl.searchParams.append('scope', scopes);
  authUrl.searchParams.append('state', 'timing-test-' + Date.now());

  console.log('📋 OAuth Configuration:');
  console.log('Client ID:', client_id.substring(0, 8) + '...');
  console.log('Callback URL:', callback_url);
  console.log('Scopes:', scopes);
  console.log();

  console.log('🔗 Test Auth URL:');
  console.log(authUrl.toString());
  console.log();

  console.log('📝 Instructions:');
  console.log('1. Copy the URL above and paste it in your browser');
  console.log('2. Complete the Xero authorization');
  console.log('3. Note the time it takes from clicking "Allow" to redirect');
  console.log('4. Check if the authorization code works immediately');
  console.log();

  console.log('⏱️  Code Expiry Notes:');
  console.log('• Authorization codes typically expire in 10 minutes');
  console.log('• Codes can only be used ONCE');
  console.log('• Processing should happen within seconds of redirect');
  console.log('• Race conditions can cause "invalid_grant" errors');
  console.log();

  console.log('🔧 Troubleshooting Tips:');
  console.log('• Ensure frontend doesn\'t make duplicate requests');
  console.log('• Check for React StrictMode causing double renders');
  console.log('• Verify no browser extensions are interfering');
  console.log('• Test in incognito mode to rule out cache issues');
  console.log('• Check server logs for duplicate callback requests');
}

// Simulate a code validation
async function testCodeValidation(code) {
  if (!code) {
    console.log('❌ No code provided for testing');
    return;
  }

  const client_id = process.env.XERO_CLIENT_ID;
  const client_secret = process.env.XERO_CLIENT_SECRET;
  const callback_url = process.env.XERO_CALLBACK_URL;

  console.log(`🧪 Testing authorization code: ${code.substring(0, 10)}...`);

  const tokenData = {
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: callback_url,
  };

  const formData = new URLSearchParams(tokenData).toString();
  const basicAuth = Buffer.from(`${client_id}:${client_secret}`).toString('base64');

  try {
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
        timeout: 10000,
      }
    );

    const responseTime = Date.now() - startTime;
    console.log(`✅ Code validation successful in ${responseTime}ms`);
    console.log('Token type:', response.data.token_type);
    console.log('Expires in:', response.data.expires_in, 'seconds');

  } catch (error) {
    console.log('❌ Code validation failed');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Error:', error.response.data.error);
      console.log('Description:', error.response.data.error_description);
    } else {
      console.log('Network error:', error.message);
    }
  }
}

// Check command line arguments
const args = process.argv.slice(2);
if (args[0] === 'test-code' && args[1]) {
  testCodeValidation(args[1]);
} else {
  testOAuthTiming();
  console.log('\n💡 To test a specific code:');
  console.log('node test-oauth-timing.js test-code YOUR_AUTH_CODE_HERE');
}
