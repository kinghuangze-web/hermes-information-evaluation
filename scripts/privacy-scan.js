#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['.git', 'node_modules', 'logs']);
const ignoredFiles = new Set(['scripts/privacy-scan.js']);

const checks = [
  {
    label: 'Raw email address',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  },
  {
    label: 'Windows user path',
    pattern: /C:\\Users\\\d+|C:\\Users\\[A-Za-z0-9._-]+/i
  },
  {
    label: 'WSL home path',
    pattern: /\/home\/[A-Za-z0-9._-]+/i
  },
  {
    label: 'Raw secret key prefix',
    pattern: /\bsk-[A-Za-z0-9]{10,}\b/
  }
];

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function isTextFile(filePath) {
  const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.tgz']);
  return !binaryExtensions.has(path.extname(filePath).toLowerCase());
}

const files = listFiles(root).filter(isTextFile);
const findings = [];

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (ignoredFiles.has(rel)) {
    continue;
  }
  const content = fs.readFileSync(file, 'utf8');

  for (const check of checks) {
    if (!check.pattern.test(content)) {
      continue;
    }

    findings.push(`${check.label}: ${rel}`);
  }
}

if (findings.length > 0) {
  console.error('Privacy scan failed:\n' + findings.join('\n'));
  process.exit(1);
}

console.log('privacy scan passed');
