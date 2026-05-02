const fileManager = require('../../utils/fileManager');
const { detectPlatform, mergeSourceEntries, normalizeSourceEntry } = require('../../utils/sourceLibrary');
const { createId } = require('../library');

const SUPPORTED_SOURCE_PLATFORMS = new Set([
  'wechat',
  'douyin',
  'bilibili',
  'chat',
  'other',
  'x',
  'xiaohongshu'
]);

function isSourceLibraryEnabled(env = process.env) {
  return String(env.HERMES_SOURCE_LIBRARY_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function pickSourcePlatform(record = {}) {
  const firstLink = Array.isArray(record.links) ? String(record.links[0] || '').trim() : '';
  const detectedFromLink = detectPlatform(firstLink);
  if (detectedFromLink && detectedFromLink !== 'chat') {
    return detectedFromLink;
  }

  const sourcePlatform = String(record.sourcePlatform || '').trim().toLowerCase();
  if (SUPPORTED_SOURCE_PLATFORMS.has(sourcePlatform)) {
    return sourcePlatform;
  }

  return firstLink ? 'other' : 'chat';
}

function buildWorkerSessions(record = {}) {
  return Object.entries(record.metadata?.agentExecution?.agentDetails || {})
    .filter(([, detail]) => Boolean(detail?.sessionId))
    .map(([key, detail]) => `${key}:${detail.sessionId}${detail.profile ? ` (${detail.profile})` : ''}`)
    .join(' | ');
}

function buildSourceNotes(record = {}) {
  const workerAudits = record.metadata?.workerAudits || {};
  const lines = [
    record.coreConclusion ? `coreConclusion: ${record.coreConclusion}` : '',
    Number.isFinite(Number(record.scores?.overall)) ? `overall: ${Number(record.scores.overall)}/10` : '',
    typeof record.worthDoing === 'boolean' ? `worthDoing: ${record.worthDoing}` : '',
    record.recommendedAction ? `recommendedAction: ${record.recommendedAction}` : '',
    record.nextStep ? `nextStep: ${record.nextStep}` : '',
    workerAudits.content?.summary ? `content: ${workerAudits.content.summary}` : '',
    workerAudits.evaluation?.summary ? `evaluation: ${workerAudits.evaluation.summary}` : '',
    workerAudits.action?.summary ? `action: ${workerAudits.action.summary}` : '',
    record.id ? `hermesRecordId: ${record.id}` : '',
    record.taskId ? `hermesTaskId: ${record.taskId}` : ''
  ];

  return lines.filter(Boolean).join('\n');
}

function buildSourceCandidate(record = {}, context = {}) {
  const firstLink = Array.isArray(record.links) ? String(record.links[0] || '').trim() : '';
  const workerAudits = record.metadata?.workerAudits || {};

  return normalizeSourceEntry({
    id: createId('src'),
    platform: pickSourcePlatform(record),
    url: firstLink || null,
    title: record.title || '',
    intro: record.summary || '',
    notes: buildSourceNotes(record),
    status: 'OK',
    source: 'hermes',
    projectId: null,
    hermesRecordId: record.id,
    hermesTaskId: record.taskId,
    hermesRunId: context.runId || null,
    hermesRecommendedAction: record.recommendedAction || '',
    hermesWorthDoing: typeof record.worthDoing === 'boolean' ? record.worthDoing : null,
    hermesOverallScore: record.scores?.overall ?? null,
    hermesExecutionMode: record.metadata?.agentExecution?.mode || null,
    hermesRealProfilesExecution: typeof record.metadata?.isRealProfilesExecution === 'boolean'
      ? record.metadata.isRealProfilesExecution
      : null,
    hermesWorkerSessions: buildWorkerSessions(record) || null,
    hermesContentSummary: workerAudits.content?.summary || null,
    hermesEvaluationSummary: workerAudits.evaluation?.summary || null,
    hermesActionSummary: workerAudits.action?.summary || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

async function writeRecordToSourceLibrary(record, context = {}, deps = {}) {
  const env = context.env || process.env;
  if (!isSourceLibraryEnabled(env)) {
    return {
      status: 'disabled',
      reason: 'source_library_disabled'
    };
  }

  const candidate = buildSourceCandidate(record, context);
  const data = await fileManager.read('sources');
  data.items = Array.isArray(data.items) ? data.items : [];

  const existingIndex = data.items.findIndex((item) => item.dedupeKey === candidate.dedupeKey);
  if (existingIndex >= 0) {
    const mergedItem = mergeSourceEntries(data.items[existingIndex], [candidate]);
    data.items[existingIndex] = mergedItem;
    await fileManager.write('sources', data);
    return {
      status: 'updated',
      sourceId: mergedItem.id,
      dedupeKey: mergedItem.dedupeKey,
      platform: mergedItem.platform
    };
  }

  data.items.unshift(candidate);
  await fileManager.write('sources', data);
  return {
    status: 'created',
    sourceId: candidate.id,
    dedupeKey: candidate.dedupeKey,
    platform: candidate.platform
  };
}

module.exports = {
  buildSourceCandidate,
  isSourceLibraryEnabled,
  writeRecordToSourceLibrary
};
