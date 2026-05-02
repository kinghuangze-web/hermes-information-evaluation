const assert = require('node:assert/strict');

const path = require('node:path');

const {
  getStorageSettings,
  DEFAULT_DATA_DIR,
  DATA_DIR_ENV_KEY,
  PROJECT_ROOT,
  getDataDir
} = require('../utils/storagePaths');
const { detectPlatform } = require('../utils/sourceLibrary');
const { getHermesAgentExecutionConfig } = require('../hermes/multiAgentDispatcher');

assert.equal(DEFAULT_DATA_DIR, 'data');
assert.equal(DATA_DIR_ENV_KEY, 'HERMES_DATA_DIR');
assert.equal(getStorageSettings().dataDir, 'data');
assert.equal(getDataDir(), path.join(PROJECT_ROOT, 'data'));

assert.equal(detectPlatform('https://x.com/example/status/123'), 'x');
assert.equal(detectPlatform('https://mp.weixin.qq.com/s/example'), 'wechat');
assert.equal(detectPlatform('https://example.com/article'), 'other');

const config = getHermesAgentExecutionConfig({
  USER: 'tester',
  HERMES_AGENT_EXECUTION_MODE: 'local_modules'
});

assert.equal(config.mode, 'local_modules');
assert.ok(String(config.hermesRoot).includes('hermes-agent'));

console.log('smoke tests passed');
