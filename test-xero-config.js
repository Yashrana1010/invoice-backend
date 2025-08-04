#!/usr/bin/env node

/**
 * Xero Configuration Tester
 * This script helps diagnose Xero OAuth configuration issues
 */

require('dotenv').config();
const axios = require('axios');

async function testXeroConfiguration() {
  console.log('🔍 Testing Xero OAuth Configuration...\n');

  // Step 1: Check Environment Variables
  console.log('1. Environment Variables Check:');
  const client_id = process.env.XERO_CLIENT_ID;
  const client_secret = process.env.XERO_CLIENT_SECRET;
  const callback_url = process.env.XERO_CALLBACK_URL;
  const scopes = process.env.XERO_SCOPES;

  console.log(`   CLIENT_ID: ${client_id ? '✅ Present (' + client_id.substring(0, 8) + '...)' : '❌ Missing'}`);
  console.log(`   CLIENT_SECRET: ${client_secret ? '✅ Present (' + client_secret.length + ' chars)' : '❌ Missing'}`);
  console.log(`   CALLBACK_URL: ${callback_url ? '✅ ' + callback_url : '❌ Missing'}`);
  console.log(`   SCOPES: ${scopes ? '✅ ' + scopes : '❌ Missing (will use defaults)'}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);

  if (!client_id || !client_secret || !callback_url) {
    console.log('\n❌ Missing required environment variables. Please check your .env file.');
    return;
  }

  // Step 2: Generate Test Auth URL
  console.log('\n2. Auth URL Generation Test:');
  try {
    const authUrl = new URL('https://login.xero.com/identity/connect/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', client_id);
    authUrl.searchParams.append('redirect_uri', callback_url);

    const finalScopes = scopes || 'openid profile email accounting.transactions accounting.contacts accounting.settings accounting.reports.read accounting.journals.read accounting.attachments';
    authUrl.searchParams.append('scope', finalScopes);
    authUrl.searchParams.append('state', 'test-state-123');

    console.log('   ✅ Auth URL generated successfully');
    console.log(`   🔗 URL: ${authUrl.toString()}`);
  } catch (error) {
    console.log(`   ❌ Failed to generate auth URL: ${error.message}`);
    return;
  }

  // Step 3: Test Basic Auth Header
  console.log('\n3. Basic Auth Header Test:');
  try {
    const basicAuth = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
    console.log(`   ✅ Basic auth header generated (${basicAuth.length} chars)`);
  } catch (error) {
    console.log(`   ❌ Failed to generate basic auth: ${error.message}`);
  }

  // Step 4: Recommendations
  console.log('\n4. Troubleshooting Recommendations:');
  console.log('   📋 Checklist for Xero Developer Console:');
  console.log('   1. Go to: https://developer.xero.com/myapps');
  console.log('   2. Open your app');
  console.log('   3. Verify these settings:');
  console.log(`      - App Type: Web App`);
  console.log(`      - Redirect URI: ${callback_url}`);
  console.log('      - Required Scopes:');
  console.log('        ✓ openid');
  console.log('        ✓ profile');
  console.log('        ✓ email');
  console.log('        ✓ accounting.transactions');
  console.log('        ✓ accounting.contacts');
  console.log('        ✓ accounting.settings');
  console.log('        ✓ accounting.reports.read');
  console.log('        ✓ accounting.journals.read');
  console.log('        ✓ accounting.attachments');

  console.log('\n   🔧 Common Issues:');
  console.log('   • Redirect URI mismatch (must match EXACTLY)');
  console.log('   • Missing required scopes in Xero app');
  console.log('   • App not published/approved (if required)');
  console.log('   • Incorrect client credentials');
  console.log('   • Using development credentials in production');

  console.log('\n   🚀 Next Steps if "unauthorized_client" persists:');
  console.log('   1. Double-check redirect URI in Xero app console');
  console.log('   2. Regenerate client secret in Xero app');
  console.log('   3. Ensure app has all required scopes enabled');
  console.log('   4. Test with a fresh authorization code');
  console.log('   5. Check if app needs to be published/approved');

  console.log('\n✅ Configuration test completed!');
}

// Run the test
testXeroConfiguration().catch(console.error);
