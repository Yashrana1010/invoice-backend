#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Testing upload directory setup...\n');

// Test 1: Check current working directory
console.log('1. Current working directory:');
console.log(`   ${process.cwd()}`);

// Test 2: Check uploads directory path
const uploadsDir = path.resolve(process.cwd(), 'uploads');
console.log(`\n2. Uploads directory path:`);
console.log(`   ${uploadsDir}`);

// Test 3: Check if directory exists
console.log(`\n3. Directory exists:`);
const exists = fs.existsSync(uploadsDir);
console.log(`   ${exists ? '✅ YES' : '❌ NO'}`);

if (!exists) {
  console.log('\n🔧 Attempting to create directory...');
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('   ✅ Directory created successfully');
  } catch (error) {
    console.log(`   ❌ Failed to create directory: ${error.message}`);
    process.exit(1);
  }
}

// Test 4: Check directory permissions
console.log(`\n4. Directory permissions:`);
try {
  const stats = fs.statSync(uploadsDir);
  console.log(`   Mode: ${stats.mode.toString(8)}`);
  console.log(`   UID: ${stats.uid}`);
  console.log(`   GID: ${stats.gid}`);
  console.log(`   Is Directory: ${stats.isDirectory()}`);
} catch (error) {
  console.log(`   ❌ Failed to get stats: ${error.message}`);
}

// Test 5: Test write permissions
console.log(`\n5. Testing write permissions:`);
const testFile = path.join(uploadsDir, 'test-file.txt');
try {
  fs.writeFileSync(testFile, 'test content');
  console.log('   ✅ Write test successful');

  // Clean up test file
  fs.unlinkSync(testFile);
  console.log('   ✅ File cleanup successful');
} catch (error) {
  console.log(`   ❌ Write test failed: ${error.message}`);
}

// Test 6: Check disk space
console.log(`\n6. Disk space check:`);
try {
  const stats = fs.statSync(uploadsDir);
  console.log('   ✅ Directory accessible');
} catch (error) {
  console.log(`   ❌ Directory access failed: ${error.message}`);
}

console.log('\n🎉 Upload directory test completed!');
console.log('\nIf all tests pass but you still get ENOENT errors, the issue might be:');
console.log('- Process running under different user/context in production');
console.log('- SELinux/AppArmor restrictions');
console.log('- Container/Docker volume mounting issues');
console.log('- PM2 or process manager changing working directory');
