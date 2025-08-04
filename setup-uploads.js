#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🛠️  Setting up uploads directory...\n');

// Create uploads directory with proper permissions
const uploadsDir = path.resolve(process.cwd(), 'uploads');

try {
  // Remove existing directory if it exists
  if (fs.existsSync(uploadsDir)) {
    console.log('📁 Uploads directory already exists');
  } else {
    // Create directory
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ Created uploads directory');
  }

  // Set permissions (755 is usually better than 777 for security)
  fs.chmodSync(uploadsDir, 0o755);
  console.log('✅ Set directory permissions to 755');

  // Test write access
  const testFile = path.join(uploadsDir, 'test-write.txt');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('✅ Write permissions verified');

  console.log(`\n📍 Uploads directory ready at: ${uploadsDir}`);

} catch (error) {
  console.error(`❌ Setup failed: ${error.message}`);
  process.exit(1);
}
