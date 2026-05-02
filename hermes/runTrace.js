const { createId, normalizeList, normalizeMetadata } = require('./library');

const TRACE_STATUSES = ['unknown', 'running', 'success', 'failed'];
const TRACE_AGENT_KEYS = ['orchestrator', 'content', 'evaluation', 'action'];
const TRACE_NODE_ORDER = [
  'pipeline.ingress',
  'pipeline.enrichment',
  'agents.orchestrator',
  'agents.content',
  'agents.evaluation',
  'agents.action',
  'pipeline.writer.local',
  'pipeline.writer.feishuBitable',
  'pipeline.reply.feishu'
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeTraceStatus(status) {
  return TRACE_STATUSES.includes(status) ? status : 'unknown';
}

function toDurationMs(startedAt, endedAt, providedDurationMs) {
  if (Number.isFinite(Number(providedDurationMs))) {
    return Math.max(0, Math.round(Number(providedDurationMs)));
  }

  if (!startedAt || !endedAt) {
    return null;
  }

  const duration = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function normalizeTraceStage(stage = {}) {
  const startedAt = stage.startedAt || null;
  const endedAt = stage.endedAt || null;

  return {
    status: normalizeTraceStatus(stage.status),
    startedAt,
    endedAt,
    durationMs: toDurationMs(startedAt, endedAt, stage.durationMs),
    profile: String(stage.profile || '').trim(),
    sessionId: String(stage.sessionId || '').trim(),
    reason: String(stage.reason || '').trim(),
    metadata: normalizeMetadata(stage.metadata)
  };
}

function getByPath(target, path) {
  return String(path || '').split('.').reduce((current, key) => (current ? current[key] : undefined), target);
}

function setByPath(target, path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (keys.length === 0) {
    return target;
  }

  let current = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
  return target;
}

function getFailedNodePaths(runTrace = {}) {
  return TRACE_NODE_ORDER.filter((path) => getByPath(runTrace, path)?.status === 'failed');
}

function hasAgentLoop(runTrace = {}) {
  return TRACE_AGENT_KEYS.every((key) => runTrace.agents?.[key]?.status === 'success');
}

function hasRealProfilesLoop(runTrace = {}) {
  if (runTrace.executionMode !== 'hermes_profiles' || runTrace.fallbackUsed) {
    return false;
  }

  return ['content', 'evaluation', 'action'].every((key) => {
    const stage = runTrace.agents?.[key];
    return stage?.status === 'success' && (stage.profile || stage.sessionId);
  });
}

function normalizeRunResult(result = {}) {
  const overallScore = result.overallScore;
  return {
    title: String(result.title || '').trim(),
    worthDoing: Boolean(result.worthDoing),
    overallScore: Number.isFinite(Number(overallScore)) ? Number(overallScore) : null,
    recommendedAction: String(result.recommendedAction || '').trim(),
    status: String(result.status || '').trim(),
    summary: String(result.summary || '').trim()
  };
}

function normalizeHermesRunTrace(trace = {}) {
  const startedAt = trace.startedAt || nowIso();
  const endedAt = trace.endedAt || null;

  const normalized = {
    runId: String(trace.runId || createId('hermes_run')).trim(),
    recordId: trace.recordId || null,
    taskId: trace.taskId || null,
    startedAt,
    endedAt,
    durationMs: toDurationMs(startedAt, endedAt, trace.durationMs),
    sourcePlatform: String(trace.sourcePlatform || 'manual').trim() || 'manual',
    sourceType: String(trace.sourceType || 'text').trim() || 'text',
    requestedExecutionMode: String(trace.requestedExecutionMode || 'unknown').trim() || 'unknown',
    executionMode: String(trace.executionMode || 'unknown').trim() || 'unknown',
    fallbackUsed: Boolean(trace.fallbackUsed),
    fallbackReason: String(trace.fallbackReason || '').trim(),
    input: {
      rawText: String(trace.input?.rawText || '').trim(),
      links: normalizeList(trace.input?.links),
      images: normalizeList(trace.input?.images),
      attachments: normalizeList(trace.input?.attachments)
    },
    agents: {
      orchestrator: normalizeTraceStage(trace.agents?.orchestrator || { status: 'unknown' }),
      content: normalizeTraceStage(trace.agents?.content || { status: 'unknown' }),
      evaluation: normalizeTraceStage(trace.agents?.evaluation || { status: 'unknown' }),
      action: normalizeTraceStage(trace.agents?.action || { status: 'unknown' })
    },
    pipeline: {
      ingress: normalizeTraceStage(trace.pipeline?.ingress || { status: 'unknown' }),
      enrichment: normalizeTraceStage(trace.pipeline?.enrichment || { status: 'unknown' }),
      writer: {
        local: normalizeTraceStage(trace.pipeline?.writer?.local || { status: 'unknown' }),
        feishuBitable: normalizeTraceStage(trace.pipeline?.writer?.feishuBitable || { status: 'unknown' })
      },
      reply: {
        feishu: normalizeTraceStage(trace.pipeline?.reply?.feishu || { status: 'unknown' })
      }
    },
    result: normalizeRunResult(trace.result),
    metadata: normalizeMetadata(trace.metadata)
  };

  normalized.failedNodes = getFailedNodePaths(normalized);
  normalized.failedNode = normalized.failedNodes[0] || null;
  normalized.hasAgentLoop = hasAgentLoop(normalized);
  normalized.hasRealProfilesLoop = hasRealProfilesLoop(normalized);

  return normalized;
}

function normalizeHermesRunTraceStore(data = {}) {
  const runs = Array.isArray(data.runs) ? data.runs.map((run) => normalizeHermesRunTrace(run)) : [];

  return {
    version: data.version || '1.0.0',
    lastUpdated: data.lastUpdated || nowIso(),
    runs,
    metadata: {
      total: runs.length,
      byExecutionMode: runs.reduce((accumulator, run) => {
        accumulator[run.executionMode] = (accumulator[run.executionMode] || 0) + 1;
        return accumulator;
      }, {}),
      byStatus: runs.reduce((accumulator, run) => {
        const status = run.result.status || 'unknown';
        accumulator[status] = (accumulator[status] || 0) + 1;
        return accumulator;
      }, {}),
      byFailedNode: runs.reduce((accumulator, run) => {
        if (run.failedNode) {
          accumulator[run.failedNode] = (accumulator[run.failedNode] || 0) + 1;
        }
        return accumulator;
      }, {})
    }
  };
}

function createHermesRunTrace(input = {}) {
  const createdAt = nowIso();
  return normalizeHermesRunTrace({
    runId: createId('hermes_run'),
    startedAt: createdAt,
    sourcePlatform: input.sourcePlatform,
    sourceType: input.sourceType,
    requestedExecutionMode: input.requestedExecutionMode || 'unknown',
    input: {
      rawText: input.rawText,
      links: input.links,
      images: input.images,
      attachments: input.attachments
    },
    agents: {
      orchestrator: {
        status: 'running',
        startedAt: createdAt
      }
    },
    pipeline: {
      ingress: {
        status: 'success',
        startedAt: createdAt,
        endedAt: createdAt,
        metadata: {
          received: true
        }
      }
    }
  });
}

function updateRunTraceStage(runTrace, path, patch = {}) {
  const nextRunTrace = normalizeHermesRunTrace(runTrace);
  const currentStage = getByPath(nextRunTrace, path) || normalizeTraceStage();
  const mergedStage = {
    ...currentStage,
    ...patch,
    metadata: {
      ...(currentStage.metadata || {}),
      ...(normalizeMetadata(patch.metadata) || {})
    }
  };

  if (mergedStage.status === 'running' && !mergedStage.startedAt) {
    mergedStage.startedAt = nowIso();
  }

  if ((mergedStage.status === 'success' || mergedStage.status === 'failed' || mergedStage.status === 'unknown') && !mergedStage.endedAt) {
    mergedStage.endedAt = nowIso();
  }

  if ((mergedStage.status === 'success' || mergedStage.status === 'failed') && !mergedStage.startedAt) {
    mergedStage.startedAt = mergedStage.endedAt || nowIso();
  }

  setByPath(nextRunTrace, path, normalizeTraceStage(mergedStage));
  return normalizeHermesRunTrace(nextRunTrace);
}

function updateHermesRunTrace(runTrace, patch = {}) {
  return normalizeHermesRunTrace({
    ...runTrace,
    ...patch,
    input: {
      ...(runTrace.input || {}),
      ...(patch.input || {})
    },
    result: {
      ...(runTrace.result || {}),
      ...(patch.result || {})
    },
    metadata: {
      ...(runTrace.metadata || {}),
      ...(patch.metadata || {})
    }
  });
}

function finalizeHermesRunTrace(runTrace, patch = {}) {
  const endedAt = patch.endedAt || nowIso();
  return normalizeHermesRunTrace({
    ...runTrace,
    ...patch,
    endedAt,
    durationMs: toDurationMs(runTrace.startedAt, endedAt, patch.durationMs)
  });
}

module.exports = {
  TRACE_NODE_ORDER,
  createHermesRunTrace,
  getFailedNodePaths,
  hasAgentLoop,
  hasRealProfilesLoop,
  normalizeHermesRunTrace,
  normalizeHermesRunTraceStore,
  updateRunTraceStage,
  updateHermesRunTrace,
  finalizeHermesRunTrace
};
