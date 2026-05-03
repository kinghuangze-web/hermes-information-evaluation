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
const {
  FIELD_NAMES,
  findMissingFrontstageFields,
  mapRecordToBitableFields
} = require('../hermes/feishuBitable');

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

const sampleRecord = {
  id: 'hermes_record_smoke',
  taskId: 'hermes_task_smoke',
  title: 'Hermes Bitable frontstage field smoke test',
  summary: 'A public repo smoke test should protect user-facing Bitable fields.',
  topic: 'operations',
  coreConclusion: 'Bitable writes must include readable frontstage fields, not only audit fields.',
  worthDoing: true,
  recommendedAction: '????',
  nextStep: 'Keep the frontstage mapping covered by smoke tests.',
  sourcePlatform: 'x',
  sourceType: 'text',
  links: [],
  rawText: 'https://x.com/example/status/123 Hermes Bitable mapping test',
  scores: {
    interestFit: 8,
    actionability: 7,
    potentialReturn: 7,
    timeliness: 7,
    uniqueness: 6,
    overall: 8
  },
  reasons: ['Protects the GitHub deploy path'],
  metadata: {
    agentExecution: {
      mode: 'local_modules',
      agentDetails: {}
    }
  },
  createdAt: '2026-05-03T00:00:00.000Z'
};

const liveTableFields = [
  { field_name: FIELD_NAMES.MULTILINE_TEXT, type: 1 },
  { field_name: FIELD_NAMES.SOURCE_CHANNEL, type: 3, property: { options: [{ name: 'X' }, { name: 'X/Twitter' }] } },
  { field_name: FIELD_NAMES.PRIORITY, type: 3, property: { options: [{ name: 'P1-????' }, { name: 'P2-????' }, { name: 'P3-???' }] } },
  { field_name: FIELD_NAMES.PROCESSING_RESULT, type: 3, property: { options: [{ name: '????' }, { name: '???' }] } },
  { field_name: FIELD_NAMES.WORTH_DOING, type: 3, property: { options: [{ name: '?' }, { name: '?' }, { name: '?' }] } },
  { field_name: FIELD_NAMES.TOPIC, type: 1 },
  { field_name: FIELD_NAMES.ONE_LINE_CONCLUSION, type: 1 },
  { field_name: FIELD_NAMES.RECOMMENDED_ACTION, type: 1 },
  { field_name: FIELD_NAMES.NEXT_STEP, type: 1 },
  { field_name: FIELD_NAMES.REASON, type: 1 },
  { field_name: FIELD_NAMES.ORIGINAL_INPUT, type: 1 },
  { field_name: FIELD_NAMES.RECORD_ID, type: 1 },
  { field_name: FIELD_NAMES.TASK_ID, type: 1 }
];

const mappedBitableFields = mapRecordToBitableFields(sampleRecord, liveTableFields);
assert.equal(mappedBitableFields[FIELD_NAMES.MULTILINE_TEXT], sampleRecord.title);
assert.equal(mappedBitableFields[FIELD_NAMES.SOURCE_CHANNEL], 'X');
assert.equal(mappedBitableFields[FIELD_NAMES.PRIORITY], 'P1-????');
assert.equal(mappedBitableFields[FIELD_NAMES.PROCESSING_RESULT], '????');
assert.equal(mappedBitableFields[FIELD_NAMES.WORTH_DOING], '?');
assert.equal(mappedBitableFields[FIELD_NAMES.ONE_LINE_CONCLUSION], sampleRecord.coreConclusion);
assert.ok(mappedBitableFields[FIELD_NAMES.RECOMMENDED_ACTION].includes(sampleRecord.nextStep));
assert.equal(mappedBitableFields[FIELD_NAMES.NEXT_STEP], sampleRecord.nextStep);
assert.ok(mappedBitableFields[FIELD_NAMES.REASON].includes('Protects the GitHub deploy path'));
assert.equal(mappedBitableFields[FIELD_NAMES.ORIGINAL_INPUT], sampleRecord.rawText);
assert.deepEqual(findMissingFrontstageFields(mappedBitableFields, liveTableFields), []);

const brokenFields = [
  { field_name: FIELD_NAMES.PRIORITY, type: 3, property: { options: [{ name: 'unsupported-priority' }] } }
];
assert.deepEqual(
  findMissingFrontstageFields(mapRecordToBitableFields(sampleRecord, brokenFields), brokenFields),
  [FIELD_NAMES.PRIORITY]
);

console.log('smoke tests passed');
