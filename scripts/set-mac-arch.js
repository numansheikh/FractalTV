/**
 * Set or restore mac.target.arch in electron-builder.json.
 * Usage: node scripts/set-mac-arch.js [arm64|x64|restore]
 */
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'electron-builder.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const arg = process.argv[2];
if (arg === 'arm64') {
  config.mac.target.arch = ['arm64'];
} else if (arg === 'x64') {
  config.mac.target.arch = ['x64'];
} else if (arg === 'restore') {
  config.mac.target.arch = ['x64', 'arm64'];
} else {
  console.error('Usage: node scripts/set-mac-arch.js [arm64|x64|restore]');
  process.exit(1);
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
