const fs = require('fs-extra');
const path = require('path');
const { ValidationError } = require('../middleware/errorHandler');

const PROJECT_ROOT = path.join(__dirname, '..');
const STORAGE_SETTINGS_FILE = path.join(PROJECT_ROOT, 'storage.config.json');
const DEFAULT_DATA_DIR = 'data';
const DATA_DIR_ENV_KEY = 'HERMES_DATA_DIR';

function normalizeRelativePath(input) {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
}

function resolveProjectRelativeDir(relativeDir = DEFAULT_DATA_DIR) {
  const normalized = normalizeRelativePath(relativeDir);

  if (!normalized) {
    throw new ValidationError('数据目录不能为空');
  }

  if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
    throw new ValidationError('数据目录仅支持项目内相对路径');
  }

  const resolved = path.resolve(PROJECT_ROOT, normalized);
  const rootWithSep = PROJECT_ROOT.endsWith(path.sep) ? PROJECT_ROOT : `${PROJECT_ROOT}${path.sep}`;

  if (resolved !== PROJECT_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new ValidationError('数据目录必须位于项目目录内');
  }

  return resolved;
}

function getStorageSettings() {
  const envDataDir = normalizeRelativePath(process.env[DATA_DIR_ENV_KEY] || '');
  if (envDataDir) {
    return { dataDir: envDataDir };
  }

  if (!fs.existsSync(STORAGE_SETTINGS_FILE)) {
    return { dataDir: DEFAULT_DATA_DIR };
  }

  try {
    const data = fs.readJsonSync(STORAGE_SETTINGS_FILE);
    return {
      dataDir: normalizeRelativePath(data.dataDir || DEFAULT_DATA_DIR) || DEFAULT_DATA_DIR
    };
  } catch {
    return { dataDir: DEFAULT_DATA_DIR };
  }
}

function setStorageSettings(settings = {}) {
  const dataDir = normalizeRelativePath(settings.dataDir || DEFAULT_DATA_DIR) || DEFAULT_DATA_DIR;
  fs.writeJsonSync(STORAGE_SETTINGS_FILE, { dataDir }, { spaces: 2 });
  return { dataDir };
}

function getDataDir() {
  const settings = getStorageSettings();
  return resolveProjectRelativeDir(settings.dataDir);
}

function getDisplayDataDir() {
  const settings = getStorageSettings();
  return `./${normalizeRelativePath(settings.dataDir || DEFAULT_DATA_DIR)}`;
}

function getBackupsDir() {
  return path.join(getDataDir(), 'backups');
}

module.exports = {
  PROJECT_ROOT,
  STORAGE_SETTINGS_FILE,
  DEFAULT_DATA_DIR,
  DATA_DIR_ENV_KEY,
  resolveProjectRelativeDir,
  getStorageSettings,
  setStorageSettings,
  getDataDir,
  getDisplayDataDir,
  getBackupsDir
};
