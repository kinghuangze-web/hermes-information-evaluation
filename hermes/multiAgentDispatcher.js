const path = require('node:path');
const { spawn } = require('node:child_process');

const { HERMES_ACTIONS, HERMES_TOPICS } = require('./constants');
const {
  normalizeList,
  clampScore,
  averageScore,
  detectTopic,
  extractKeywords,
  summarizeText
} = require('./library');

function getHermesAgentExecutionConfig(env = process.env) {
  const configuredWslCommand = String(env.HERMES_AGENT_WSL_COMMAND || '').trim();
  const systemRoot = String(env.SystemRoot || process.env.SystemRoot || '').trim();
  const defaultHermesRoot = path.posix.join('/home', String(env.USER || 'user').trim() || 'user', 'hermes-agent');
  const defaultWslCommand = configuredWslCommand
    || (systemRoot ? path.join(systemRoot, 'System32', 'wsl.exe') : 'wsl.exe');
  const mode = String(env.HERMES_AGENT_EXECUTION_MODE || 'local_modules').trim() || 'local_modules';
  const fallbackSetting = env.HERMES_AGENT_FALLBACK_LOCAL;

  return {
    mode,
    fallbackToLocal: fallbackSetting === undefined || fallbackSetting === null || fallbackSetting === ''
      ? mode !== 'hermes_profiles'
      : fallbackSetting !== 'false',
    wslCommand: defaultWslCommand,
    wslDistro: String(env.HERMES_AGENT_WSL_DISTRO || 'Ubuntu-24.04').trim() || 'Ubuntu-24.04',
    hermesRoot: String(env.HERMES_AGENT_ROOT || defaultHermesRoot).trim() || defaultHermesRoot,
    profiles: {
      content: String(env.HERMES_CONTENT_PROFILE || 'hermes-content-worker').trim() || 'hermes-content-worker',
      evaluation: String(env.HERMES_EVALUATION_PROFILE || 'hermes-evaluation-worker').trim() || 'hermes-evaluation-worker',
      action: String(env.HERMES_ACTION_PROFILE || 'hermes-action-worker').trim() || 'hermes-action-worker'
    }
  };
}

function bashSingleQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function extractSessionId(output) {
  const match = String(output || '').match(/session_id:\s*([A-Za-z0-9_]+)/);
  return match ? match[1] : null;
}

function extractJsonFromHermesOutput(output) {
  const text = String(output || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start === -1) {
      if (char === '{') {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, index + 1);
        return JSON.parse(candidate);
      }
    }
  }

  throw new Error('No JSON object found in Hermes output');
}

function buildContentPrompt(taskEnvelope) {
  const evidencePacket = taskEnvelope.evidencePacket || taskEnvelope.metadata?.evidencePacket || null;
  return [
    'You are the content understanding worker.',
    'Return exactly one JSON object and nothing else.',
    'Do not use markdown fences.',
    'Required JSON shape:',
    '{"title":"","summary":"","keywords":[],"topic":"sales|marketing|product|ai|content|operations|other","coreConclusion":""}',
    'Rules:',
    '- summarize the input only',
    '- do not score value',
    '- do not recommend actions',
    `Input JSON: ${JSON.stringify({ taskEnvelope, evidencePacket })}`
  ].join('\n');
}

function buildEvaluationPrompt(taskEnvelope, contentResult) {
  const evidencePacket = taskEnvelope.evidencePacket || taskEnvelope.metadata?.evidencePacket || null;
  return [
    'You are the value evaluation worker.',
    'Return exactly one JSON object and nothing else.',
    'Do not use markdown fences.',
    'Required JSON shape:',
    '{"scores":{"interestFit":1,"actionability":1,"potentialReturn":1,"timeliness":1,"uniqueness":1,"overall":1},"worthDoing":false,"reasons":[]}',
    'Rules:',
    '- every score must be an integer from 1 to 10',
    '- overall should be the rounded average',
    '- reasons should be concise strings',
    `Input JSON: ${JSON.stringify({ taskEnvelope, evidencePacket, contentResult })}`
  ].join('\n');
}

function buildActionPrompt(taskEnvelope, contentResult, evaluationResult, duplicateCandidate) {
  const evidencePacket = taskEnvelope.evidencePacket || taskEnvelope.metadata?.evidencePacket || null;
  return [
    'You are the action recommendation worker.',
    'Return exactly one JSON object and nothing else.',
    'Do not use markdown fences.',
    'Required JSON shape:',
    '{"recommendedAction":"follow_up_now|handle_this_week|topic_pool|observe|archive_only","nextStep":"","executionWindow":"","status":"","reasons":[]}',
    'Rules:',
    '- recommendedAction must be one of the allowed ASCII enum values',
    '- nextStep must be practical and short',
    '- reasons should be concise strings',
    `Input JSON: ${JSON.stringify({ taskEnvelope, evidencePacket, contentResult, evaluationResult, duplicateCandidate })}`
  ].join('\n');
}

function createHermesExecutionError(message, extra = {}) {
  const error = new Error(message);
  error.code = extra.code || 'HERMES_EXECUTION_ERROR';
  error.expose = extra.expose !== false;
  error.statusCode = extra.statusCode || 502;
  error.userMessage = extra.userMessage || message;
  Object.assign(error, extra);
  return error;
}

function summarizePrompt(prompt) {
  return summarizeText(prompt, 180);
}

function summarizeWorkerOutput(value) {
  try {
    return summarizeText(JSON.stringify(value), 220);
  } catch {
    return summarizeText(String(value || ''), 220);
  }
}

function createPendingAgentExecution(config) {
  return {
    mode: 'hermes_profiles',
    fallbackUsed: false,
    profilesUsed: [
      config.profiles.content,
      config.profiles.evaluation,
      config.profiles.action
    ],
    sessions: {
      content: '',
      evaluation: '',
      action: ''
    },
    agentDetails: {
      content: {
        status: 'unknown',
        profile: config.profiles.content,
        sessionId: '',
        metadata: {}
      },
      evaluation: {
        status: 'unknown',
        profile: config.profiles.evaluation,
        sessionId: '',
        metadata: {}
      },
      action: {
        status: 'unknown',
        profile: config.profiles.action,
        sessionId: '',
        metadata: {}
      }
    }
  };
}

function ensureWorkerResponse(agentKey, response, normalizedResult) {
  if (!response?.sessionId) {
    throw createHermesExecutionError(`${agentKey} worker did not return a sessionId`, {
      code: 'HERMES_AGENT_SESSION_MISSING',
      agentKey
    });
  }

  if (!normalizedResult || typeof normalizedResult !== 'object') {
    throw createHermesExecutionError(`${agentKey} worker did not return a valid JSON result`, {
      code: 'HERMES_AGENT_RESULT_MISSING',
      agentKey
    });
  }

  if (agentKey === 'content' && !String(normalizedResult.summary || normalizedResult.coreConclusion || normalizedResult.title || '').trim()) {
    throw createHermesExecutionError('content worker returned an empty content summary', {
      code: 'HERMES_AGENT_RESULT_EMPTY',
      agentKey
    });
  }

  if (agentKey === 'evaluation' && !Number.isFinite(Number(normalizedResult.scores?.overall))) {
    throw createHermesExecutionError('evaluation worker returned invalid scores', {
      code: 'HERMES_AGENT_RESULT_INVALID',
      agentKey
    });
  }

  if (agentKey === 'action' && !String(normalizedResult.recommendedAction || '').trim()) {
    throw createHermesExecutionError('action worker returned an empty recommendedAction', {
      code: 'HERMES_AGENT_RESULT_EMPTY',
      agentKey
    });
  }
}

function buildStageFailure(agentKey, profile, message, agentExecution, extra = {}) {
  return createHermesExecutionError(`Hermes ${agentKey} worker failed: ${message}`, {
    code: extra.code || 'HERMES_AGENT_STAGE_FAILED',
    agentKey,
    profile,
    agentExecution,
    statusCode: 502,
    userMessage: `Hermes 多 agent 执行失败：${agentKey} worker 未完成，已停止写入来源库和飞书表。原因：${message}`
  });
}

function normalizeContentResult(value, taskEnvelope) {
  const payload = value && typeof value === 'object' ? value : {};
  const summary = String(payload.summary || '').trim();
  const title = String(payload.title || '').trim() || String(taskEnvelope.rawText || '').trim().slice(0, 24) || '待处理信息';
  const keywords = normalizeList(payload.keywords);
  const topic = HERMES_TOPICS.includes(payload.topic) ? payload.topic : detectTopic(`${taskEnvelope.rawText} ${summary}`, keywords);
  const coreConclusion = String(payload.coreConclusion || '').trim()
    || `${title} 的重点围绕 ${keywords.slice(0, 3).join('、') || '核心内容'}。`;

  return {
    title,
    summary: summary || String(taskEnvelope.rawText || '').trim(),
    keywords: keywords.length > 0 ? keywords : extractKeywords(`${title} ${summary}`),
    topic,
    coreConclusion
  };
}

function normalizeEvaluationResult(value) {
  const payload = value && typeof value === 'object' ? value : {};
  const scores = {
    interestFit: clampScore(payload.scores?.interestFit || payload.interestFit || 1),
    actionability: clampScore(payload.scores?.actionability || payload.actionability || 1),
    potentialReturn: clampScore(payload.scores?.potentialReturn || payload.potentialReturn || 1),
    timeliness: clampScore(payload.scores?.timeliness || payload.timeliness || 1),
    uniqueness: clampScore(payload.scores?.uniqueness || payload.uniqueness || 1)
  };

  return {
    scores: {
      ...scores,
      overall: clampScore(payload.scores?.overall || payload.overall || averageScore(Object.values(scores)))
    },
    worthDoing: Boolean(payload.worthDoing),
    reasons: normalizeList(payload.reasons)
  };
}

function normalizeActionResult(value) {
  const payload = value && typeof value === 'object' ? value : {};
  const actionMap = {
    follow_up_now: '立即跟进',
    handle_this_week: '本周处理',
    topic_pool: '进入选题池',
    observe: '继续观察',
    archive_only: '仅归档'
  };
  const recommendedAction = actionMap[payload.recommendedAction] || payload.recommendedAction;
  return {
    recommendedAction: HERMES_ACTIONS.includes(recommendedAction) ? recommendedAction : '仅归档',
    nextStep: String(payload.nextStep || '').trim() || '先归档沉淀，后续按主题回看是否值得再次激活。',
    executionWindow: String(payload.executionWindow || 'archive').trim() || 'archive',
    status: String(payload.status || 'archived').trim() || 'archived',
    reasons: normalizeList(payload.reasons)
  };
}

async function runWslHermesQuery(profile, prompt, config, deps = {}) {
  if (deps.runQuery) {
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const result = await deps.runQuery(profile, prompt, config);

    return {
      ...result,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs
    };
  }

  const spawnImpl = deps.spawnImpl || spawn;
  const script = [
    'set -e',
    `cd ${bashSingleQuote(config.hermesRoot)}`,
    'source ./venv/bin/activate',
    `hermes -p ${bashSingleQuote(profile)} chat -Q --source tool -q ${bashSingleQuote(prompt)}`
  ].join('\n');

  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const isWindowsHost = process.platform === 'win32';
    const child = isWindowsHost
      ? spawnImpl(config.wslCommand || 'wsl.exe', ['-d', config.wslDistro, '--', 'bash'], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
      : spawnImpl('bash', ['-lc', script], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Hermes profile ${profile} failed with code ${code}: ${stderr || stdout}`));
        return;
      }

      const combinedOutput = `${stdout}\n${stderr}`;

      resolve({
        stdout,
        stderr,
        sessionId: extractSessionId(combinedOutput),
        json: extractJsonFromHermesOutput(stdout),
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs
      });
    });

    if (isWindowsHost) {
      child.stdin.write(`${script}\n`);
      child.stdin.end();
    }
  });
}

async function runHermesProfilePipeline(taskEnvelope, options = {}) {
  const config = options.config || getHermesAgentExecutionConfig();
  const duplicateCandidate = options.duplicateCandidate || null;
  const deps = options.deps || {};
  const agentExecution = createPendingAgentExecution(config);

  let contentResult;
  let evaluationResult;
  let actionResult;

  const contentPrompt = buildContentPrompt(taskEnvelope);
  try {
    const contentResponse = await runWslHermesQuery(config.profiles.content, contentPrompt, config, deps);
    contentResult = normalizeContentResult(contentResponse.json, taskEnvelope);
    ensureWorkerResponse('content', contentResponse, contentResult);
    agentExecution.sessions.content = contentResponse.sessionId || '';
    agentExecution.agentDetails.content = {
      status: 'success',
      startedAt: contentResponse.startedAt || null,
      endedAt: contentResponse.endedAt || null,
      durationMs: contentResponse.durationMs ?? null,
      profile: config.profiles.content,
      sessionId: contentResponse.sessionId || '',
      metadata: {
        inputSummary: summarizePrompt(contentPrompt),
        outputSummary: summarizeWorkerOutput(contentResult)
      }
    };
  } catch (error) {
    agentExecution.agentDetails.content = {
      ...(agentExecution.agentDetails.content || {}),
      status: 'failed',
      reason: error.message,
      metadata: {
        ...(agentExecution.agentDetails.content?.metadata || {}),
        inputSummary: summarizePrompt(contentPrompt)
      }
    };
    throw buildStageFailure('content', config.profiles.content, error.message, agentExecution, { code: error.code });
  }

  const evaluationPrompt = buildEvaluationPrompt(taskEnvelope, contentResult);
  try {
    const evaluationResponse = await runWslHermesQuery(
      config.profiles.evaluation,
      evaluationPrompt,
      config,
      deps
    );
    evaluationResult = normalizeEvaluationResult(evaluationResponse.json);
    ensureWorkerResponse('evaluation', evaluationResponse, evaluationResult);
    agentExecution.sessions.evaluation = evaluationResponse.sessionId || '';
    agentExecution.agentDetails.evaluation = {
      status: 'success',
      startedAt: evaluationResponse.startedAt || null,
      endedAt: evaluationResponse.endedAt || null,
      durationMs: evaluationResponse.durationMs ?? null,
      profile: config.profiles.evaluation,
      sessionId: evaluationResponse.sessionId || '',
      metadata: {
        inputSummary: summarizePrompt(evaluationPrompt),
        outputSummary: summarizeWorkerOutput(evaluationResult)
      }
    };
  } catch (error) {
    agentExecution.agentDetails.evaluation = {
      ...(agentExecution.agentDetails.evaluation || {}),
      status: 'failed',
      reason: error.message,
      metadata: {
        ...(agentExecution.agentDetails.evaluation?.metadata || {}),
        inputSummary: summarizePrompt(evaluationPrompt)
      }
    };
    throw buildStageFailure('evaluation', config.profiles.evaluation, error.message, agentExecution, { code: error.code });
  }

  const actionPrompt = buildActionPrompt(
    taskEnvelope,
    contentResult,
    evaluationResult,
    duplicateCandidate ? { id: duplicateCandidate.id } : null
  );
  try {
    const actionResponse = await runWslHermesQuery(
      config.profiles.action,
      actionPrompt,
      config,
      deps
    );
    actionResult = normalizeActionResult(actionResponse.json);
    ensureWorkerResponse('action', actionResponse, actionResult);
    agentExecution.sessions.action = actionResponse.sessionId || '';
    agentExecution.agentDetails.action = {
      status: 'success',
      startedAt: actionResponse.startedAt || null,
      endedAt: actionResponse.endedAt || null,
      durationMs: actionResponse.durationMs ?? null,
      profile: config.profiles.action,
      sessionId: actionResponse.sessionId || '',
      metadata: {
        inputSummary: summarizePrompt(actionPrompt),
        outputSummary: summarizeWorkerOutput(actionResult)
      }
    };
  } catch (error) {
    agentExecution.agentDetails.action = {
      ...(agentExecution.agentDetails.action || {}),
      status: 'failed',
      reason: error.message,
      metadata: {
        ...(agentExecution.agentDetails.action?.metadata || {}),
        inputSummary: summarizePrompt(actionPrompt)
      }
    };
    throw buildStageFailure('action', config.profiles.action, error.message, agentExecution, { code: error.code });
  }

  return {
    contentResult,
    evaluationResult,
    actionResult,
    agentExecution
  };
}

module.exports = {
  getHermesAgentExecutionConfig,
  extractJsonFromHermesOutput,
  extractSessionId,
  normalizeContentResult,
  normalizeEvaluationResult,
  normalizeActionResult,
  runWslHermesQuery,
  runHermesProfilePipeline
};
