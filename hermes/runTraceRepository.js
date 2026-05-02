const fileManager = require('../utils/fileManager');
const { NotFoundError } = require('../middleware/errorHandler');
const {
  hasAgentLoop,
  hasRealProfilesLoop,
  normalizeHermesRunTrace,
  updateHermesRunTrace
} = require('./runTrace');

function startedAtValue(run) {
  return new Date(run.startedAt || 0).getTime();
}

function sortRuns(runs = []) {
  return [...runs].sort((left, right) => startedAtValue(right) - startedAtValue(left));
}

async function readStore() {
  return fileManager.read('hermesRunTraces');
}

async function writeStore(data) {
  await fileManager.write('hermesRunTraces', data);
}

async function saveRunTrace(runTrace) {
  const data = await readStore();
  const normalizedRunTrace = normalizeHermesRunTrace(runTrace);
  data.runs = Array.isArray(data.runs) ? data.runs : [];
  const existingIndex = data.runs.findIndex((item) => item.runId === normalizedRunTrace.runId);

  if (existingIndex === -1) {
    data.runs.unshift(normalizedRunTrace);
  } else {
    data.runs[existingIndex] = normalizedRunTrace;
  }

  await writeStore(data);
  return normalizedRunTrace;
}

async function getRunTraceById(runId) {
  const data = await readStore();
  const run = (data.runs || []).find((item) => item.runId === runId);
  if (!run) {
    throw new NotFoundError('Hermes run trace 不存在');
  }
  return normalizeHermesRunTrace(run);
}

function runMatchesFilters(run, filters = {}) {
  if (filters.status && filters.status !== 'all' && run.result.status !== filters.status) {
    return false;
  }
  if (filters.platform && filters.platform !== 'all' && run.sourcePlatform !== filters.platform) {
    return false;
  }
  if (filters.executionMode && filters.executionMode !== 'all' && run.executionMode !== filters.executionMode) {
    return false;
  }
  if (filters.worthDoing && filters.worthDoing !== 'all') {
    const expected = filters.worthDoing === 'true';
    if (run.result.worthDoing !== expected) {
      return false;
    }
  }
  if (filters.failedNode && filters.failedNode !== 'all' && !run.failedNodes.includes(filters.failedNode)) {
    const requested = String(filters.failedNode || '').trim();
    const normalizedFailedNodes = run.failedNodes.map((item) => String(item || '').replace(/^pipeline\./, '').replace(/^agents\./, ''));
    if (!normalizedFailedNodes.includes(requested)) {
      return false;
    }
  }
  return true;
}

function mapRunListItem(run) {
  return {
    runId: run.runId,
    recordId: run.recordId,
    taskId: run.taskId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    sourcePlatform: run.sourcePlatform,
    sourceType: run.sourceType,
    executionMode: run.executionMode,
    requestedExecutionMode: run.requestedExecutionMode,
    fallbackUsed: run.fallbackUsed,
    fallbackReason: run.fallbackReason,
    hasAgentLoop: hasAgentLoop(run),
    hasRealProfilesLoop: hasRealProfilesLoop(run),
    failedNode: run.failedNode,
    failedNodes: run.failedNodes,
    title: run.result.title,
    worthDoing: run.result.worthDoing,
    overallScore: run.result.overallScore,
    recommendedAction: run.result.recommendedAction,
    status: run.result.status,
    agents: run.agents,
    pipeline: run.pipeline
  };
}

async function listRunTraces(filters = {}) {
  const data = await readStore();
  const limit = Math.max(1, Math.min(100, Number(filters.limit) || 20));
  const runs = sortRuns(data.runs || []).filter((run) => runMatchesFilters(run, filters));
  let startIndex = 0;

  if (filters.cursor) {
    const cursorIndex = runs.findIndex((run) => run.runId === filters.cursor);
    startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  }

  const page = runs.slice(startIndex, startIndex + limit);
  const nextCursor = runs[startIndex + limit]?.runId || null;

  return {
    runs: page.map((run) => mapRunListItem(run)),
    nextCursor
  };
}

function wasWithinLast24Hours(run) {
  const referenceTime = new Date(run.endedAt || run.startedAt || 0).getTime();
  return Date.now() - referenceTime <= 24 * 60 * 60 * 1000;
}

function nodeStatusFromLatestRun(latestRun, path) {
  return latestRun ? path.split('.').reduce((current, key) => current?.[key], latestRun)?.status || 'unknown' : 'unknown';
}

async function buildMonitorOverview() {
  const data = await readStore();
  const runs = sortRuns(data.runs || []);
  const latestRun = runs[0] || null;
  const latestPipelineRun = runs.find((run) => run.executionMode !== 'workspace_directive') || latestRun;
  const recentRuns = runs.slice(0, 8);
  const recent24h = runs.filter((run) => wasWithinLast24Hours(run));
  const agentEligibleRuns = runs.filter((run) => run.executionMode !== 'workspace_directive');
  const latestSuccessRun = runs.find((run) => !run.failedNode) || null;
  const latestFailureRun = runs.find((run) => Boolean(run.failedNode)) || null;
  const runsWithAgentLoop = agentEligibleRuns.filter((run) => hasAgentLoop(run));
  const realProfilesRuns = agentEligibleRuns.filter((run) => hasRealProfilesLoop(run));
  const fallbackRuns24h = recent24h.filter((run) => run.fallbackUsed);
  const bitableFailures24h = recent24h.filter((run) => run.pipeline.writer.feishuBitable.status === 'failed');

  const failedNodeCounts = runs.reduce((accumulator, run) => {
    if (run.failedNode) {
      accumulator[run.failedNode] = (accumulator[run.failedNode] || 0) + 1;
    }
    return accumulator;
  }, {});

  const topFailedNodes = Object.entries(failedNodeCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([node, count]) => ({ node, count }));

  return {
    summary: {
      totalRuns: runs.length,
      latestExecutionMode: latestRun?.executionMode || 'unknown',
      fourStageClosureRate: agentEligibleRuns.length > 0 ? Math.round((runsWithAgentLoop.length / agentEligibleRuns.length) * 100) : 0,
      hermesProfilesExecutionShare: agentEligibleRuns.length > 0 ? Math.round((realProfilesRuns.length / agentEligibleRuns.length) * 100) : 0,
      fallbackCount24h: fallbackRuns24h.length,
      bitableWriteFailures24h: bitableFailures24h.length,
      latestSuccessAt: latestSuccessRun?.endedAt || latestSuccessRun?.startedAt || null,
      latestFailureAt: latestFailureRun?.endedAt || latestFailureRun?.startedAt || null,
      lastFailedNode: latestFailureRun?.failedNode || null
    },
    chainStatus: {
      ingress: nodeStatusFromLatestRun(latestPipelineRun, 'pipeline.ingress'),
      enrichment: nodeStatusFromLatestRun(latestPipelineRun, 'pipeline.enrichment'),
      orchestrator: nodeStatusFromLatestRun(latestPipelineRun, 'agents.orchestrator'),
      content: nodeStatusFromLatestRun(latestPipelineRun, 'agents.content'),
      evaluation: nodeStatusFromLatestRun(latestPipelineRun, 'agents.evaluation'),
      action: nodeStatusFromLatestRun(latestPipelineRun, 'agents.action'),
      writerLocal: nodeStatusFromLatestRun(latestPipelineRun, 'pipeline.writer.local'),
      writerFeishuBitable: nodeStatusFromLatestRun(latestPipelineRun, 'pipeline.writer.feishuBitable'),
      replyFeishu: nodeStatusFromLatestRun(latestPipelineRun, 'pipeline.reply.feishu')
    },
    recentRuns: recentRuns.map((run) => mapRunListItem(run)),
    issues: {
      topFailedNodes,
      recentFallbacks: fallbackRuns24h.slice(0, 5).map((run) => mapRunListItem(run)),
      recentBitableFailures: bitableFailures24h.slice(0, 5).map((run) => mapRunListItem(run))
    }
  };
}

async function patchRunTrace(runId, patch = {}) {
  const current = await getRunTraceById(runId);
  const mergedPatch = {
    ...patch,
    agents: {
      ...(current.agents || {}),
      ...(patch.agents || {})
    },
    pipeline: {
      ...(current.pipeline || {}),
      ...(patch.pipeline || {}),
      writer: {
        ...(current.pipeline?.writer || {}),
        ...(patch.pipeline?.writer || {})
      },
      reply: {
        ...(current.pipeline?.reply || {}),
        ...(patch.pipeline?.reply || {})
      }
    }
  };

  const next = updateHermesRunTrace(current, mergedPatch);
  return saveRunTrace(next);
}

module.exports = {
  buildMonitorOverview,
  getRunTraceById,
  listRunTraces,
  patchRunTrace,
  saveRunTrace
};
