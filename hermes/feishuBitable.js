const { execFileSync } = require('node:child_process');

const { getTenantAccessToken, getFeishuOpenBaseUrl } = require('./feishuClient');

const DEFAULT_FEISHU_BITABLE_WSL_PATH = '';

const FIELD_NAMES = {
  PRIMARY_TEXT: '\u6587\u672c',
  TIME: '\u65f6\u95f4',
  SOURCE_CHANNEL: '\u6765\u6e90\u6e20\u9053',
  PRIORITY: '\u7efc\u5408\u4f18\u5148\u7ea7',
  POTENTIAL_VALUE: '\u6f5c\u5728\u4ef7\u503c',
  PROCESSING_RESULT: '\u5904\u7406\u7ed3\u679c',
  SHORT_DESCRIPTION: '\u7b80\u8981\u63cf\u8ff0',
  LINK: '\u94fe\u63a5',
  TITLE: '\u6807\u9898',
  RECORD_ID: '\u8bb0\u5f55ID',
  TASK_ID: '\u4efb\u52a1ID',
  OVERALL_SCORE: '\u7efc\u5408\u5206',
  WORTH_DOING: '\u503c\u5f97\u505a',
  CONTENT_SUMMARY: '\u5185\u5bb9\u7406\u89e3',
  EVALUATION_SUMMARY: '\u4ef7\u503c\u8bc4\u4f30',
  ACTION_SUMMARY: '\u884c\u52a8\u5efa\u8bae',
  AGENT_MODE: 'Agent\u6267\u884c\u6a21\u5f0f',
  WORKER_SESSIONS: 'Worker\u4f1a\u8bdd',
  REAL_PROFILES_EXECUTION: '\u771f\u5b9eProfiles\u6267\u884c'
};

const REQUIRED_FIELD_DEFS = [
  { field_name: FIELD_NAMES.RECORD_ID, type: 1 },
  { field_name: FIELD_NAMES.TASK_ID, type: 1 },
  { field_name: FIELD_NAMES.OVERALL_SCORE, type: 2 },
  { field_name: FIELD_NAMES.WORTH_DOING, type: 7 },
  { field_name: FIELD_NAMES.CONTENT_SUMMARY, type: 1 },
  { field_name: FIELD_NAMES.EVALUATION_SUMMARY, type: 1 },
  { field_name: FIELD_NAMES.ACTION_SUMMARY, type: 1 },
  { field_name: FIELD_NAMES.AGENT_MODE, type: 1 },
  { field_name: FIELD_NAMES.WORKER_SESSIONS, type: 1 },
  { field_name: FIELD_NAMES.REAL_PROFILES_EXECUTION, type: 7 }
];

function readJsonResponse(response) {
  return response.json ? response.json() : Promise.resolve({});
}

function assertFeishuSuccess(data, action) {
  const code = Number(data?.code ?? 0);
  if (code !== 0) {
    throw new Error(`${action} failed with code ${code}: ${data?.msg || 'unknown error'}`);
  }
  return data;
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function loadLocalConfig(configPath, deps = {}) {
  if (!configPath) {
    return null;
  }

  if (deps.readConfigFile) {
    return deps.readConfigFile(configPath);
  }

  return null;
}

function loadWslConfig(configPath, deps = {}) {
  if (!configPath) {
    return null;
  }

  if (deps.readWslConfig) {
    return deps.readWslConfig(configPath);
  }

  try {
    const raw = execFileSync('wsl.exe', ['-d', 'Ubuntu-24.04', '--', 'cat', configPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return parseJsonSafe(raw);
  } catch {
    return null;
  }
}

function getFeishuBitableConfig(input = {}, deps = {}) {
  const env = input.env || process.env;
  const baseUrl = input.baseUrl || env.FEISHU_OPEN_BASE_URL || getFeishuOpenBaseUrl({ env });
  const localConfigPath = input.configPath || env.FEISHU_BITABLE_CONFIG_PATH || '';
  const wslConfigPath = input.wslConfigPath || env.FEISHU_BITABLE_CONFIG_WSL_PATH || DEFAULT_FEISHU_BITABLE_WSL_PATH;

  let configSource = 'env';
  let loadedConfig = null;

  if ((!env.FEISHU_BITABLE_APP_TOKEN || !env.FEISHU_BITABLE_TABLE_ID) && localConfigPath) {
    loadedConfig = loadLocalConfig(localConfigPath, deps);
    if (loadedConfig) {
      configSource = 'file';
    }
  }

  if (!loadedConfig && (!env.FEISHU_BITABLE_APP_TOKEN || !env.FEISHU_BITABLE_TABLE_ID) && wslConfigPath) {
    loadedConfig = loadWslConfig(wslConfigPath, deps);
    if (loadedConfig) {
      configSource = 'wsl';
    }
  }

  const appId = input.appId || env.FEISHU_APP_ID || loadedConfig?.app_id || loadedConfig?.appId || '';
  const appSecret = input.appSecret || env.FEISHU_APP_SECRET || loadedConfig?.app_secret || loadedConfig?.appSecret || '';
  const appToken = input.appToken || env.FEISHU_BITABLE_APP_TOKEN || loadedConfig?.app_token || loadedConfig?.appToken || '';
  const tableId = input.tableId || env.FEISHU_BITABLE_TABLE_ID || loadedConfig?.table_id || loadedConfig?.tableId || '';
  const enabled = input.enabled
    ?? (env.FEISHU_BITABLE_ENABLED === 'true'
      || env.HERMES_WRITER_TYPE === 'bitable'
      || Boolean(appId && appSecret && appToken && tableId));

  return {
    enabled,
    appId,
    appSecret,
    appToken,
    tableId,
    baseUrl,
    configSource,
    wslConfigPath
  };
}

function toTimestamp(value) {
  const date = value ? new Date(value) : null;
  const timestamp = date && !Number.isNaN(date.getTime()) ? date.getTime() : Date.now();
  return timestamp;
}

function detectSourceChannel(record = {}) {
  const sourcePlatform = String(record.sourcePlatform || '').trim().toLowerCase();
  const firstLink = Array.isArray(record.links) && record.links.length > 0 ? String(record.links[0] || '').trim() : '';

  if (sourcePlatform === 'wechat') {
    return '\u5fae\u4fe1\u516c\u4f17\u53f7';
  }

  if (sourcePlatform === 'xiaohongshu') {
    return '\u5c0f\u7ea2\u4e66';
  }

  if (sourcePlatform === 'x') {
    return 'X/Twitter';
  }

  if (sourcePlatform === 'audit') {
    return '\u5ba1\u8ba1';
  }

  if (!firstLink) {
    return undefined;
  }

  try {
    const hostname = new URL(firstLink).hostname.replace(/^www\./, '').toLowerCase();
    if (hostname === 'mp.weixin.qq.com') {
      return '\u5fae\u4fe1\u516c\u4f17\u53f7';
    }
    if (hostname === 'x.com' || hostname === 'twitter.com') {
      return 'X/Twitter';
    }
    if (hostname.endsWith('xiaohongshu.com')) {
      return '\u5c0f\u7ea2\u4e66';
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function mapPriorityLabel(overallScore) {
  if (Number(overallScore || 0) >= 8) {
    return '\u9ad8';
  }
  if (Number(overallScore || 0) >= 6) {
    return '\u4e2d';
  }
  return '\u4f4e';
}

function mapPotentialValueLabel(potentialReturnScore) {
  if (Number(potentialReturnScore || 0) >= 8) {
    return '\u2b50\u2b50\u2b50 \u9ad8';
  }
  if (Number(potentialReturnScore || 0) >= 6) {
    return '\u2b50\u2b50 \u4e2d';
  }
  return '\u4f4e';
}

function mapProcessingResult(record = {}) {
  return String(record.recommendedAction || '').trim() === '\u4ec5\u5f52\u6863'
    ? '\u4ec5\u5f52\u6863'
    : '\u5f85\u5904\u7406';
}

function formatWorkerSessions(agentExecution = {}) {
  const details = agentExecution.agentDetails || {};
  const pairs = Object.entries(details)
    .filter(([, value]) => Boolean(value?.sessionId))
    .map(([key, value]) => `${key}:${value.sessionId}${value.profile ? ` (${value.profile})` : ''}`);

  return pairs.join(' | ');
}

function joinNonEmptyLines(items) {
  return items
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
}

function buildCompactSummary(record = {}) {
  const overall = Number(record.scores?.overall || 0);
  const summary = String(record.summary || '').trim();
  const evaluation = `\u7efc\u5408\u5206 ${overall}/10\uff0c${record.worthDoing ? '\u503c\u5f97\u505a' : '\u6682\u4e0d\u6295\u5165'}`;
  const action = `${String(record.recommendedAction || '').trim()} ${String(record.nextStep || '').trim()}`.trim();

  return joinNonEmptyLines([summary, evaluation, action]);
}

function buildContentSummary(record = {}) {
  const workerSummary = String(record.metadata?.workerAudits?.content?.summary || '').trim();
  const keywords = Array.isArray(record.keywords) && record.keywords.length > 0
    ? `\u5173\u952e\u8bcd\uff1a${record.keywords.join('\u3001')}`
    : '';

  return joinNonEmptyLines([
    workerSummary,
    record.summary,
    record.coreConclusion ? `\u6838\u5fc3\u7ed3\u8bba\uff1a${record.coreConclusion}` : '',
    keywords
  ]);
}

function buildEvaluationSummary(record = {}) {
  const workerSummary = String(record.metadata?.workerAudits?.evaluation?.summary || '').trim();
  const scores = record.scores || {};
  const scoreLine = [
    `\u7efc\u5408\u5206:${Number(scores.overall || 0)}/10`,
    `\u503c\u5f97\u505a:${record.worthDoing ? '\u662f' : '\u5426'}`,
    `\u6f5c\u5728\u56de\u62a5:${Number(scores.potentialReturn || 0)}/10`
  ].join(' | ');
  const reasons = Array.isArray(record.reasons) && record.reasons.length > 0
    ? `\u7406\u7531\uff1a${record.reasons.join('\uff1b')}`
    : '';

  return joinNonEmptyLines([workerSummary, scoreLine, reasons]);
}

function buildActionSummary(record = {}) {
  const workerSummary = String(record.metadata?.workerAudits?.action?.summary || '').trim();
  return joinNonEmptyLines([
    workerSummary,
    record.recommendedAction ? `\u63a8\u8350\u52a8\u4f5c\uff1a${record.recommendedAction}` : '',
    record.nextStep ? `\u4e0b\u4e00\u6b65\uff1a${record.nextStep}` : '',
    record.executionWindow ? `\u6267\u884c\u65f6\u95f4\u7a97\uff1a${record.executionWindow}` : ''
  ]);
}

function buildCandidateValues(record = {}) {
  const agentExecution = record.metadata?.agentExecution || {};
  const firstLink = Array.isArray(record.links) && record.links.length > 0 ? String(record.links[0] || '').trim() : '';

  return {
    [FIELD_NAMES.PRIMARY_TEXT]: record.title || buildCompactSummary(record),
    [FIELD_NAMES.TIME]: toTimestamp(record.createdAt),
    [FIELD_NAMES.SOURCE_CHANNEL]: detectSourceChannel(record),
    [FIELD_NAMES.PRIORITY]: mapPriorityLabel(record.scores?.overall),
    [FIELD_NAMES.POTENTIAL_VALUE]: mapPotentialValueLabel(record.scores?.potentialReturn),
    [FIELD_NAMES.PROCESSING_RESULT]: mapProcessingResult(record),
    [FIELD_NAMES.SHORT_DESCRIPTION]: buildCompactSummary(record),
    [FIELD_NAMES.LINK]: firstLink,
    [FIELD_NAMES.TITLE]: record.title,
    [FIELD_NAMES.RECORD_ID]: record.id,
    [FIELD_NAMES.TASK_ID]: record.taskId,
    [FIELD_NAMES.OVERALL_SCORE]: Number(record.scores?.overall || 0),
    [FIELD_NAMES.WORTH_DOING]: Boolean(record.worthDoing),
    [FIELD_NAMES.CONTENT_SUMMARY]: buildContentSummary(record),
    [FIELD_NAMES.EVALUATION_SUMMARY]: buildEvaluationSummary(record),
    [FIELD_NAMES.ACTION_SUMMARY]: buildActionSummary(record),
    [FIELD_NAMES.AGENT_MODE]: agentExecution.mode || '',
    [FIELD_NAMES.WORKER_SESSIONS]: formatWorkerSessions(agentExecution),
    [FIELD_NAMES.REAL_PROFILES_EXECUTION]: Boolean(record.metadata?.isRealProfilesExecution)
  };
}

function normalizeSelectValue(field = {}, value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const options = Array.isArray(field.property?.options) ? field.property.options : [];
  if (options.length === 0) {
    return String(value).trim() || undefined;
  }

  const normalized = String(value).trim();
  return options.some((option) => option.name === normalized) ? normalized : undefined;
}

function normalizeFieldValue(field = {}, value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (field.type) {
    case 1:
    case 11:
      return String(value).trim() || undefined;
    case 2: {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : undefined;
    }
    case 3:
      return normalizeSelectValue(field, value);
    case 4:
      return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : undefined;
    case 5:
      return Number.isFinite(Number(value)) ? Number(value) : toTimestamp(value);
    case 7:
      return Boolean(value);
    default:
      return undefined;
  }
}

function mapRecordToBitableFields(record = {}, fields = []) {
  const candidates = buildCandidateValues(record);
  const mapped = {};

  for (const field of fields) {
    const value = candidates[field.field_name];
    const normalized = normalizeFieldValue(field, value);
    if (normalized === undefined || normalized === '') {
      continue;
    }
    mapped[field.field_name] = normalized;
  }

  return mapped;
}

async function listBitableFields(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const response = await fetchImpl(`${config.baseUrl}/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/fields?page_size=500`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.tenantAccessToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });

  if (!response.ok) {
    throw new Error(`Feishu Bitable fields request failed with status ${response.status}`);
  }

  const data = assertFeishuSuccess(await readJsonResponse(response), 'Feishu Bitable fields request');
  return Array.isArray(data.data?.items) ? data.data.items : [];
}

async function createBitableField(config, fieldDef, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const response = await fetchImpl(`${config.baseUrl}/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/fields`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.tenantAccessToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(fieldDef.property
      ? { field_name: fieldDef.field_name, type: fieldDef.type, property: fieldDef.property }
      : { field_name: fieldDef.field_name, type: fieldDef.type })
  });

  if (!response.ok) {
    throw new Error(`Feishu Bitable field create failed with status ${response.status} for ${fieldDef.field_name}`);
  }

  const data = assertFeishuSuccess(await readJsonResponse(response), `Feishu Bitable field create for ${fieldDef.field_name}`);
  return data.data?.field || {
    field_name: fieldDef.field_name,
    type: fieldDef.type,
    property: fieldDef.property || null
  };
}

async function ensureBitableFields(config, deps = {}) {
  const existingFields = await listBitableFields(config, deps);
  const knownNames = new Set(existingFields.map((field) => field.field_name));
  const createdFields = [];

  for (const fieldDef of REQUIRED_FIELD_DEFS) {
    if (knownNames.has(fieldDef.field_name)) {
      continue;
    }

    const createdField = await createBitableField(config, fieldDef, deps);
    createdFields.push(createdField);
    knownNames.add(fieldDef.field_name);
  }

  return {
    fields: [...existingFields, ...createdFields],
    createdFields: createdFields.map((field) => field.field_name)
  };
}

async function listBitableRecords(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const response = await fetchImpl(`${config.baseUrl}/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records?page_size=500`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.tenantAccessToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });

  if (!response.ok) {
    throw new Error(`Feishu Bitable records request failed with status ${response.status}`);
  }

  const data = assertFeishuSuccess(await readJsonResponse(response), 'Feishu Bitable records request');
  return Array.isArray(data.data?.items) ? data.data.items : [];
}

async function findExistingRecord(record, config, fields, deps = {}) {
  const hasRecordIdField = fields.some((field) => field.field_name === FIELD_NAMES.RECORD_ID);
  const hasTaskIdField = fields.some((field) => field.field_name === FIELD_NAMES.TASK_ID);

  if (!hasRecordIdField && !hasTaskIdField) {
    return null;
  }

  const items = await listBitableRecords(config, deps);
  return items.find((item) => {
    const currentFields = item.fields || {};
    return currentFields[FIELD_NAMES.RECORD_ID] === record.id || currentFields[FIELD_NAMES.TASK_ID] === record.taskId;
  }) || null;
}

async function writeRecordToFeishuBitable(record, options = {}, deps = {}) {
  const config = getFeishuBitableConfig(options, deps);
  if (!config.enabled) {
    return {
      status: 'skipped',
      reason: 'disabled'
    };
  }

  if (!config.appId || !config.appSecret || !config.appToken || !config.tableId) {
    return {
      status: 'skipped',
      reason: 'missing_config',
      configSource: config.configSource
    };
  }

  const tenantAccessToken = await getTenantAccessToken({
    appId: config.appId,
    appSecret: config.appSecret
  }, {
    ...deps,
    env: options.env,
    baseUrl: config.baseUrl
  });

  const runtimeConfig = {
    ...config,
    tenantAccessToken
  };

  const { fields, createdFields } = await ensureBitableFields(runtimeConfig, deps);
  const mappedFields = mapRecordToBitableFields(record, fields);
  const fieldsWritten = Object.keys(mappedFields);

  if (fieldsWritten.length === 0) {
    return {
      status: 'skipped',
      reason: 'no_supported_fields',
      configSource: config.configSource,
      createdFields,
      fieldsWritten
    };
  }

  const existingRecord = await findExistingRecord(record, runtimeConfig, fields, deps);
  const fetchImpl = deps.fetchImpl || fetch;
  const writeUrl = existingRecord
    ? `${config.baseUrl}/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records/${existingRecord.record_id || existingRecord.recordId}`
    : `${config.baseUrl}/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`;
  const response = await fetchImpl(writeUrl, {
    method: existingRecord ? 'PUT' : 'POST',
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      fields: mappedFields
    })
  });

  if (!response.ok) {
    throw new Error(`Feishu Bitable write failed with status ${response.status}`);
  }

  const data = assertFeishuSuccess(await readJsonResponse(response), 'Feishu Bitable write');
  return {
    status: existingRecord ? 'updated' : 'created',
    recordId: data.data?.record?.record_id || data.data?.record?.id || existingRecord?.record_id || null,
    configSource: config.configSource,
    appToken: config.appToken,
    tableId: config.tableId,
    createdFields,
    fieldsWritten
  };
}

module.exports = {
  DEFAULT_FEISHU_BITABLE_WSL_PATH,
  FIELD_NAMES,
  REQUIRED_FIELD_DEFS,
  getFeishuBitableConfig,
  mapRecordToBitableFields,
  writeRecordToFeishuBitable
};
