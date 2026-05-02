#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const envExamplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');

if (!fs.existsSync(envExamplePath)) {
  console.error('Missing .env.example');
  process.exit(1);
}

if (fs.existsSync(envPath)) {
  console.log('.env already exists');
  process.exit(0);
}

fs.copyFileSync(envExamplePath, envPath);
console.log('Created .env from .env.example');
