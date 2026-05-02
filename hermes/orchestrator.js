const { HERMES_ACTIONS } = require('./constants');
const { buildFinalRecord, buildTaskEnvelope, createId, normalizeHermesRecord, summarizeText } = require('./library');
const { findDuplicateCandidate, saveRecord } = require('./repository');
const { getHermesWriter } = require('./writers');
const { getFeishuBitableConfig } = require('./feishuBitable');
const { enrichHermesPayload } = require('./enrichment/remoteContent');
const { runAgentPipeline } = require('./agentPipeline');
const { detectIntakeIntent } = require('./intakeRouter');
const { executeWorkspaceDirective } = require('./workspaceManager');
const {
  createHermesRunTrace,
  finalizeHermesRunTrace,
  updateHermesRunTrace,
  updateRunTraceStage
} = require('./runTrace');
const { saveRunTrace } = require('./runTraceRepository');
const { ValidationError } = require('../middleware/errorHandler');

async function persistRunTrace(runTrace) {
  return saveRunTrace(runTrace);
}

function requiresExternalEvidence(taskEnvelope = {}) {
  return Array.isArray(taskEnvelope.links) && taskEnvelope.links.length > 0;
}

function assertEvidencePacket(taskEnvelope = {}) {
  const evidencePacket = taskEnvelope.evidencePacket || taskEnvelope.metadata?.evidencePacket || {};
  const usableLinkEvidence = Array.isArray(evidencePacket.linkEvidence)
    && evidencePacket.linkEvidence.some((item) => item.usable);
  const hasNarrativeEvidence = Boolean(evidencePacket.hasNarrativeEvidence);

  if (requiresExternalEvidence(taskEnvelope) && !usableLinkEvidence && !hasNarrativeEvidence) {
    throw new ValidationError('证据获取失败：未拿到可用正文，已停止分发给 3 个 worker，也不会写入来源库或飞书表。');
  }
}

async function persistAgentExecutionStages(runTrace, agentExecution = {}) {
  let nextRunTrace = runTrace;

  ['content', 'evaluation', 'action'].forEach((key) => {
    nextRunTrace = updateRunTraceStage(nextRunTrace, `agents.${key}`, {
      status: agentExecution.agentDetails?.[key]?.status || 'unknown',
      startedAt: agentExecution.agentDetails?.[key]?.startedAt || null,
      endedAt: agentExecution.agentDetails?.[key]?.endedAt || null,
      durationMs: agentExecution.agentDetails?.[key]?.durationMs ?? null,
      profile: agentExecution.agentDetails?.[key]?.profile || '',
      sessionId: agentExecution.agentDetails?.[key]?.sessionId || '',
      reason: agentExecution.agentDetails?.[key]?.reason || '',
      metadata: agentExecution.agentDetails?.[key]?.metadata || {}
    });
  });

  return persistRunTrace(nextRunTrace);
}

function resolveRequestedExecutionMode(options = {}, runtimeEnv = {}, intakeIntent = null) {
  if (intakeIntent?.kind === 'workspace_directive') {
    return 'workspace_directive';
  }

  return options.agentMode || runtimeEnv.HERMES_AGENT_EXECUTION_MODE || 'local_modules';
}

function resolveWriterType(options = {}, runtimeEnv = {}, intakeIntent = null) {
  if (options.writerType) {
    return options.writerType;
  }

  if (intakeIntent?.action === 'capture_source') {
    const bitableConfig = getFeishuBitableConfig({ env: runtimeEnv }, options.writerDeps || {});
    if (bitableConfig.enabled) {
      return 'bitable';
    }
  }

  return runtimeEnv.HERMES_WRITER_TYPE || 'local';
}

function buildDirectiveAuditRecord(recordId, taskEnvelope, intakeIntent, directiveResult) {
  const now = new Date().toISOString();
  const summary = String(directiveResult.summary || '').trim() || '已完成工作区指令写入。';

  return normalizeHermesRecord({
    id: recordId,
    taskId: taskEnvelope.taskId,
    title: directiveResult.title || `工作区指令：${intakeIntent.action}`,
    summary,
    keywords: ['hermes', 'workspace', directiveResult.entityType || 'directive'],
    topic: 'operations',
    coreConclusion: summary,
    scores: {
      interestFit: 5,
      actionability: 5,
      potentialReturn: 5,
      timeliness: 5,
      uniqueness: 5,
      overall: 5
    },
    worthDoing: false,
    recommendedAction: HERMES_ACTIONS[4] || HERMES_ACTIONS[0],
    nextStep: '等待人工查看并决定后续处理。',
    executionWindow: 'this_week',
    reasons: [`workspace_directive:${intakeIntent.action}`],
    status: 'acted',
    sourcePlatform: taskEnvelope.sourcePlatform,
    sourceType: taskEnvelope.sourceType,
    rawText: taskEnvelope.rawText,
    links: taskEnvelope.links,
    images: taskEnvelope.images,
    attachments: taskEnvelope.attachments,
    dedupeKey: taskEnvelope.dedupeKey,
    dedupe: {
      isDuplicateCandidate: false,
      matchedRecordId: null
    },
    metadata: {
      ...(taskEnvelope.metadata || {}),
      intakeIntent,
      workspaceDirective: {
        action: intakeIntent.action,
        entityType: directiveResult.entityType,
        entityId: directiveResult.entityId,
        projectId: directiveResult.projectId || null,
        projectName: directiveResult.projectName || null
      },
      agentExecution: {
        mode: 'workspace_directive',
        fallbackUsed: false,
        profilesUsed: [],
        sessions: {},
        agentDetails: {}
      }
    },
    createdAt: now,
    updatedAt: now
  });
}

async function processWorkspaceDirectiveFlow({
  intakeIntent,
  taskEnvelope,
  runTrace
}) {
  const recordId = createId('hermes_record');
  const directiveResult = await executeWorkspaceDirective(intakeIntent, {
    hermesRunId: runTrace.runId,
    hermesRecordId: recordId
  });

  const stagedRecord = buildDirectiveAuditRecord(recordId, taskEnvelope, intakeIntent, directiveResult);
  const savedRecord = await saveRecord(stagedRecord);

  const workspaceActionMetadata = {
    action: directiveResult.action,
    entityType: directiveResult.entityType,
    entityId: directiveResult.entityId,
    projectId: directiveResult.projectId || null,
    projectName: directiveResult.projectName || null
  };

  runTrace = await persistRunTrace(updateHermesRunTrace(runTrace, {
    recordId: savedRecord.id,
    taskId: taskEnvelope.taskId,
    executionMode: 'workspace_directive',
    fallbackUsed: false,
    input: {
      rawText: taskEnvelope.rawText,
      links: taskEnvelope.links,
      images: taskEnvelope.images,
      attachments: taskEnvelope.attachments
    },
    result: {
      title: savedRecord.title,
      worthDoing: savedRecord.worthDoing,
      overallScore: savedRecord.scores?.overall ?? null,
      recommendedAction: savedRecord.recommendedAction,
      status: savedRecord.status,
      summary: savedRecord.summary
    },
    metadata: {
      workspaceAction: workspaceActionMetadata
    }
  }));

  ['content', 'evaluation', 'action'].forEach((key) => {
    runTrace = updateRunTraceStage(runTrace, `agents.${key}`, {
      status: 'unknown',
      reason: 'skipped_for_workspace_directive'
    });
  });

  runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.enrichment', {
    status: 'unknown',
    reason: 'skipped_for_workspace_directive'
  }));

  runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.writer.local', {
    status: 'success',
    metadata: {
      writerType: 'local',
      workspaceAction: workspaceActionMetadata
    }
  }));

  runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.writer.feishuBitable', {
    status: 'unknown',
    reason: 'not_applicable_for_workspace_directive'
  }));

  runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.reply.feishu', {
    status: 'unknown',
    reason: 'reply_not_requested'
  }));

  runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'agents.orchestrator', {
    status: 'success'
  }));
  runTrace = await persistRunTrace(finalizeHermesRunTrace(runTrace));

  return {
    taskEnvelope,
    record: savedRecord,
    bitableWrite: null,
    sourceWrite: null,
    feedback: directiveResult.feedback,
    runTrace,
    workspaceAction: directiveResult
  };
}

async function processHermesInput(payload, options = {}) {
  const runtimeEnv = options.env || process.env;
  const allowRemoteFetch = options.allowRemoteFetch ?? process.env.HERMES_ALLOW_REMOTE_FETCH !== 'false';
  const intakeEnvelope = buildTaskEnvelope(payload);
  const intakeIntent = detectIntakeIntent(intakeEnvelope);

  let runTrace = await persistRunTrace(createHermesRunTrace({
    rawText: payload.rawText,
    links: payload.links,
    images: payload.images,
    attachments: payload.attachments,
    sourcePlatform: payload.sourcePlatform,
    sourceType: payload.sourceType,
    requestedExecutionMode: resolveRequestedExecutionMode(options, runtimeEnv, intakeIntent)
  }));

  runTrace = await persistRunTrace(updateHermesRunTrace(runTrace, {
    metadata: {
      intakeIntent
    }
  }));

  try {
    if (intakeIntent.kind === 'workspace_directive') {
      intakeEnvelope.metadata = {
        ...(intakeEnvelope.metadata || {}),
        intakeIntent
      };

      return processWorkspaceDirectiveFlow({
        intakeIntent,
        taskEnvelope: intakeEnvelope,
        runTrace
      });
    }

    let nextPayload = payload;

    if (allowRemoteFetch) {
      runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.enrichment', {
        status: 'running'
      }));

      try {
        nextPayload = await enrichHermesPayload(payload, options.enrichmentDeps);
        const failedLinkExpansion = (nextPayload.metadata?.linkExpansions || []).find((item) => item.status === 'failed');
        const failedImageExpansion = (nextPayload.metadata?.imageExpansions || []).find((item) => item.status === 'failed');
        const enrichmentError = failedLinkExpansion?.error || failedImageExpansion?.error || '';

        runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.enrichment', {
          status: enrichmentError ? 'failed' : 'success',
          reason: enrichmentError,
          metadata: {
            linkCount: nextPayload.links?.length || 0,
            resolvedLinkCount: (nextPayload.metadata?.linkExpansions || []).filter((item) => item.status === 'resolved').length,
            failedLinkCount: (nextPayload.metadata?.linkExpansions || []).filter((item) => item.status === 'failed').length,
            resolvedImageCount: (nextPayload.metadata?.imageExpansions || []).filter((item) => item.status === 'resolved').length,
            failedImageCount: (nextPayload.metadata?.imageExpansions || []).filter((item) => item.status === 'failed').length
          }
        }));
      } catch (error) {
        runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.enrichment', {
          status: 'failed',
          reason: error.message
        }));
        nextPayload = payload;
      }
    }

    const taskEnvelope = buildTaskEnvelope(nextPayload);
    taskEnvelope.metadata = {
      ...(taskEnvelope.metadata || {}),
      intakeIntent,
      evidencePacket: taskEnvelope.evidencePacket
    };

    assertEvidencePacket(taskEnvelope);

    const duplicateCandidate = await findDuplicateCandidate(taskEnvelope.dedupeKey);
    const writerType = resolveWriterType(options, runtimeEnv, intakeIntent);
    const writer = getHermesWriter(writerType, {
      env: runtimeEnv,
      deps: options.writerDeps
    });

    runTrace = await persistRunTrace(updateHermesRunTrace(runTrace, {
      taskId: taskEnvelope.taskId,
      sourcePlatform: taskEnvelope.sourcePlatform,
      sourceType: taskEnvelope.sourceType,
      input: {
        rawText: taskEnvelope.rawText,
        links: taskEnvelope.links,
        images: taskEnvelope.images,
        attachments: taskEnvelope.attachments
      }
    }));

    let contentResult;
    let evaluationResult;
    let actionResult;
    let agentExecution;

    try {
      ({
        contentResult,
        evaluationResult,
        actionResult,
        agentExecution
      } = await runAgentPipeline(taskEnvelope, {
        duplicateCandidate,
        mode: options.agentMode,
        deps: options.agentDeps,
        env: options.env
      }));
    } catch (error) {
      agentExecution = error.agentExecution || null;
      if (agentExecution) {
        runTrace = await persistRunTrace(updateHermesRunTrace(runTrace, {
          executionMode: agentExecution.mode || 'hermes_profiles',
          fallbackUsed: Boolean(agentExecution.fallbackUsed),
          fallbackReason: error.message
        }));
        runTrace = await persistAgentExecutionStages(runTrace, agentExecution);
      }
      throw error;
    }

    if (!agentExecution || !agentExecution.mode) {
      throw new Error('Hermes agentExecution missing from pipeline result');
    }

    taskEnvelope.metadata = {
      ...taskEnvelope.metadata,
      agentExecution,
      isRealProfilesExecution: agentExecution.mode === 'hermes_profiles' && !agentExecution.fallbackUsed
    };

    runTrace = await persistRunTrace(updateHermesRunTrace(runTrace, {
      executionMode: agentExecution.mode,
      fallbackUsed: Boolean(agentExecution.fallbackUsed),
      fallbackReason: agentExecution.fallbackReason || '',
      metadata: {
        evidencePacket: {
          hasUsableEvidence: Boolean(taskEnvelope.evidencePacket?.hasUsableEvidence),
          hasUsableLinkEvidence: Boolean(taskEnvelope.evidencePacket?.hasUsableLinkEvidence),
          linkCount: taskEnvelope.evidencePacket?.links?.length || 0
        }
      }
    }));
    runTrace = await persistAgentExecutionStages(runTrace, agentExecution);

    const record = buildFinalRecord({
      taskEnvelope,
      contentResult,
      evaluationResult,
      actionResult,
      duplicateCandidate
    });

    const savedRecord = await writer.write(record, {
      runId: runTrace.runId
    });
    const feishuBitableResult = savedRecord.metadata?.feishuBitable || null;
    const sourceSyncResult = savedRecord.metadata?.sourceSync || null;

    runTrace = await persistRunTrace(updateHermesRunTrace(runTrace, {
      recordId: savedRecord.id,
      result: {
        title: savedRecord.title,
        worthDoing: savedRecord.worthDoing,
        overallScore: savedRecord.scores?.overall ?? null,
        recommendedAction: savedRecord.recommendedAction,
        status: savedRecord.status,
        summary: savedRecord.summary
      },
      metadata: {
        dedupeMatchedRecordId: savedRecord.dedupe?.matchedRecordId || null
      }
    }));

    runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.writer.local', {
      status: 'success',
      metadata: {
        writerType,
        sourceSync: sourceSyncResult || {}
      }
    }));

    runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.writer.feishuBitable', {
      status: feishuBitableResult?.status === 'created' ? 'success' : (writerType === 'bitable' ? 'failed' : 'unknown'),
      reason: feishuBitableResult?.reason || '',
      metadata: feishuBitableResult || {}
    }));

    runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'pipeline.reply.feishu', {
      status: 'unknown',
      reason: 'reply_not_requested'
    }));

    runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'agents.orchestrator', {
      status: 'success'
    }));
    runTrace = await persistRunTrace(finalizeHermesRunTrace(runTrace));

    const feedback = `建议：${savedRecord.recommendedAction}；下一步：${savedRecord.nextStep}`;

    return {
      taskEnvelope,
      record: savedRecord,
      bitableWrite: feishuBitableResult,
      sourceWrite: sourceSyncResult,
      feedback,
      runTrace
    };
  } catch (error) {
    if (runTrace?.runId) {
      error.runTrace = runTrace;
    }
    runTrace = await persistRunTrace(updateRunTraceStage(runTrace, 'agents.orchestrator', {
      status: 'failed',
      reason: error.message
    }));
    runTrace = await persistRunTrace(finalizeHermesRunTrace(runTrace, {
      metadata: {
        ...(runTrace.metadata || {}),
        terminalError: error.message,
        terminalErrorCode: error.code || '',
        terminalUserMessage: error.userMessage || summarizeText(error.message, 400)
      }
    }));
    if (runTrace?.runId) {
      error.runTrace = runTrace;
    }
    throw error;
  }
}

module.exports = { processHermesInput };
