const { analyzeContent } = require('./agents/contentAgent');
const { evaluateValue } = require('./agents/evaluationAgent');
const { recommendAction } = require('./agents/actionAgent');
const { runHermesProfilePipeline, getHermesAgentExecutionConfig } = require('./multiAgentDispatcher');

function timedLocalAgentRun(label, action) {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const result = action();
  const endedAt = new Date().toISOString();

  return {
    result,
    detail: {
      status: 'success',
      startedAt,
      endedAt,
      durationMs: Date.now() - startedAtMs,
      profile: '',
      sessionId: '',
      metadata: {
        label
      }
    }
  };
}

function runLocalAgentPipeline(taskEnvelope, duplicateCandidate) {
  const contentRun = timedLocalAgentRun('content', () => analyzeContent(taskEnvelope));
  const evaluationRun = timedLocalAgentRun('evaluation', () => evaluateValue(taskEnvelope, contentRun.result));
  const actionRun = timedLocalAgentRun('action', () => recommendAction({
    taskEnvelope,
    contentResult: contentRun.result,
    evaluationResult: evaluationRun.result,
    duplicateCandidate
  }));

  return {
    contentResult: contentRun.result,
    evaluationResult: evaluationRun.result,
    actionResult: actionRun.result,
    agentExecution: {
      mode: 'local_modules',
      profilesUsed: [],
      fallbackUsed: false,
      agentDetails: {
        content: contentRun.detail,
        evaluation: evaluationRun.detail,
        action: actionRun.detail
      }
    }
  };
}

function resolveFallbackToLocal(config, mode) {
  if (typeof config.fallbackToLocal === 'boolean') {
    return config.fallbackToLocal;
  }

  return mode === 'hermes_profiles' ? false : true;
}

async function runAgentPipeline(taskEnvelope, options = {}) {
  const duplicateCandidate = options.duplicateCandidate || null;
  const config = getHermesAgentExecutionConfig(options.env || process.env);
  const mode = options.mode || config.mode;
  const fallbackToLocal = resolveFallbackToLocal(config, mode);

  if (mode === 'hermes_profiles') {
    try {
      return await runHermesProfilePipeline(taskEnvelope, {
        duplicateCandidate,
        config,
        deps: options.deps
      });
    } catch (error) {
      if (!fallbackToLocal) {
        throw error;
      }

      const localFallback = runLocalAgentPipeline(taskEnvelope, duplicateCandidate);
      return {
        ...localFallback,
        agentExecution: {
          ...localFallback.agentExecution,
          requestedMode: 'hermes_profiles',
          fallbackReason: error.message,
          fallbackUsed: true
        }
      };
    }
  }

  return runLocalAgentPipeline(taskEnvelope, duplicateCandidate);
}

module.exports = {
  runLocalAgentPipeline,
  runAgentPipeline
};
