const path = require('path');
const { spawn } = require('node:child_process');

const DEFAULT_PROXY_PORT = 3456;
const DEFAULT_PROXY_STARTUP_TIMEOUT_MS = 45000;
const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_RECOVERY_TIMEOUT_MS = 120000;
const DEFAULT_RECOVERY_COOLDOWN_MS = 15000;

let recoveryPromise = null;
let lastRecoveryAt = 0;

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parseInteger(value, defaultValue) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function getChromeSessionConfig(env = process.env) {
  const port = parseInteger(env.HERMES_CHROME_PROXY_PORT, DEFAULT_PROXY_PORT);
  const url = String(env.HERMES_CHROME_PROXY_URL || `http://127.0.0.1:${port}`).trim();
  const explicitEnable = env.HERMES_CHROME_SESSION_ENABLED;

  return {
    enabled: parseBoolean(explicitEnable, Boolean(env.HERMES_CHROME_PROXY_URL)),
    url,
    port,
    autoStart: parseBoolean(env.HERMES_CHROME_PROXY_AUTOSTART, true),
    autoRecover: parseBoolean(env.HERMES_CHROME_SESSION_AUTORECOVER, true),
    recoverCommand: String(env.HERMES_CHROME_SESSION_RECOVER_COMMAND || '').trim(),
    recoverTimeoutMs: parseInteger(env.HERMES_CHROME_SESSION_RECOVER_TIMEOUT_MS, DEFAULT_RECOVERY_TIMEOUT_MS),
    recoverCooldownMs: parseInteger(env.HERMES_CHROME_SESSION_RECOVER_COOLDOWN_MS, DEFAULT_RECOVERY_COOLDOWN_MS),
    requestTimeoutMs: parseInteger(env.HERMES_CHROME_PROXY_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
    startupTimeoutMs: parseInteger(env.HERMES_CHROME_PROXY_STARTUP_TIMEOUT_MS, DEFAULT_PROXY_STARTUP_TIMEOUT_MS)
  };
}

function isChromeSessionEnabled(config = getChromeSessionConfig()) {
  return Boolean(config && config.enabled && config.url);
}

async function requestJson(url, options = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = deps.createAbortController ? deps.createAbortController() : new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`Chrome session proxy request failed with status ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function isProxyHealthy(config, deps = {}) {
  try {
    const health = await requestJson(`${config.url}/health`, { timeoutMs: 3000 }, deps);
    return Boolean(health?.connected);
  } catch {
    return false;
  }
}

function spawnChromeSessionProxy(config, deps = {}) {
  const spawnImpl = deps.spawnImpl || spawn;
  const nodeExecutable = deps.nodeExecutable || process.execPath;
  const scriptPath = deps.scriptPath || path.join(__dirname, '..', '..', 'scripts', 'chrome-session-proxy.js');
  const child = spawnImpl(nodeExecutable, [scriptPath], {
    cwd: deps.cwd || path.join(__dirname, '..', '..'),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      HERMES_CHROME_PROXY_PORT: String(config.port)
    }
  });

  if (typeof child.unref === 'function') {
    child.unref();
  }

  return child;
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {
      }
      reject(new Error(`Chrome session recovery command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once('exit', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Chrome session recovery command exited with code ${code}`));
    });
  });
}

async function runChromeSessionRecovery(config, deps = {}) {
  if (!config.autoRecover || !config.recoverCommand) {
    return false;
  }

  if (recoveryPromise) {
    await recoveryPromise;
    return true;
  }

  const now = Date.now();
  if (now - lastRecoveryAt < config.recoverCooldownMs) {
    return false;
  }

  const spawnImpl = deps.recoverSpawnImpl || deps.spawnImpl || spawn;
  const child = spawnImpl(config.recoverCommand, {
    cwd: deps.cwd || path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      HERMES_CHROME_PROXY_PORT: String(config.port)
    },
    shell: true,
    stdio: 'ignore'
  });

  lastRecoveryAt = now;
  recoveryPromise = waitForChildExit(child, config.recoverTimeoutMs);

  try {
    await recoveryPromise;
    return true;
  } finally {
    recoveryPromise = null;
  }
}

async function recoverChromeSession(config = getChromeSessionConfig(), deps = {}) {
  if (!isChromeSessionEnabled(config)) {
    throw new Error('Chrome session proxy is not enabled');
  }

  if (!config.autoRecover || !config.recoverCommand) {
    return false;
  }

  await runChromeSessionRecovery(config, deps);
  const recoveredUrl = await waitForHealthyProxy(config, deps, config.startupTimeoutMs);
  if (!recoveredUrl) {
    throw new Error(`Chrome session proxy did not recover within ${config.startupTimeoutMs}ms`);
  }

  return true;
}

async function waitForHealthyProxy(config, deps = {}, timeoutMs = config.startupTimeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isProxyHealthy(config, deps)) {
      return config.url;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  return '';
}

async function ensureChromeSessionProxy(config = getChromeSessionConfig(), deps = {}) {
  if (!isChromeSessionEnabled(config)) {
    throw new Error('Chrome session proxy is not enabled');
  }

  if (await isProxyHealthy(config, deps)) {
    return config.url;
  }

  if (config.autoRecover && config.recoverCommand) {
    const recovered = await recoverChromeSession(config, deps);
    const recoveredUrl = recovered ? config.url : '';
    if (recoveredUrl) {
      return recoveredUrl;
    }
  }

  if (!config.autoStart) {
    throw new Error(`Chrome session proxy is not reachable at ${config.url}`);
  }

  spawnChromeSessionProxy(config, deps);
  const startedUrl = await waitForHealthyProxy(config, deps, config.startupTimeoutMs);
  if (startedUrl) {
    return startedUrl;
  }

  if (config.autoRecover && config.recoverCommand) {
    const recovered = await recoverChromeSession(config, deps);
    const recoveredUrl = recovered ? config.url : '';
    if (recoveredUrl) {
      return recoveredUrl;
    }
  }

  throw new Error(`Chrome session proxy did not become ready within ${config.startupTimeoutMs}ms`);
}

async function extractWithChromeSession(url, options = {}, deps = {}) {
  const config = options.config || getChromeSessionConfig();
  await ensureChromeSessionProxy(config, deps);

  const requestOptions = {
    method: 'POST',
    body: JSON.stringify({
      url,
      waitMs: options.waitMs || 1500,
      closeAfterExtract: options.closeAfterExtract !== false
    }),
    timeoutMs: config.requestTimeoutMs
  };

  try {
    return await requestJson(`${config.url}/extract`, requestOptions, deps);
  } catch (error) {
    if (!config.autoRecover || !config.recoverCommand || options.__retriedAfterRecovery) {
      throw error;
    }

    await recoverChromeSession(config, deps);
    await ensureChromeSessionProxy(config, deps);
    return extractWithChromeSession(url, {
      ...options,
      config,
      __retriedAfterRecovery: true
    }, deps);
  }
}

async function listChromeTargets(options = {}, deps = {}) {
  const config = options.config || getChromeSessionConfig();
  await ensureChromeSessionProxy(config, deps);
  return requestJson(`${config.url}/targets`, { timeoutMs: config.requestTimeoutMs }, deps);
}

async function openChromeTab(url, options = {}, deps = {}) {
  const config = options.config || getChromeSessionConfig();
  await ensureChromeSessionProxy(config, deps);
  return requestJson(`${config.url}/new`, {
    method: 'POST',
    body: JSON.stringify({ url: String(url || '').trim(), bringToFront: options.bringToFront !== false }),
    timeoutMs: config.requestTimeoutMs
  }, deps);
}

async function navigateChromeTab(targetId, url, options = {}, deps = {}) {
  const config = options.config || getChromeSessionConfig();
  await ensureChromeSessionProxy(config, deps);
  return requestJson(`${config.url}/navigate`, {
    method: 'POST',
    body: JSON.stringify({
      targetId,
      url: String(url || '').trim(),
      bringToFront: options.bringToFront !== false
    }),
    timeoutMs: config.requestTimeoutMs
  }, deps);
}

async function activateChromeTab(targetId, options = {}, deps = {}) {
  const config = options.config || getChromeSessionConfig();
  await ensureChromeSessionProxy(config, deps);
  return requestJson(`${config.url}/activate`, {
    method: 'POST',
    body: JSON.stringify({ targetId }),
    timeoutMs: config.requestTimeoutMs
  }, deps);
}

async function closeChromeTab(targetId, options = {}, deps = {}) {
  const config = options.config || getChromeSessionConfig();
  await ensureChromeSessionProxy(config, deps);
  return requestJson(`${config.url}/close`, {
    method: 'POST',
    body: JSON.stringify({ targetId }),
    timeoutMs: config.requestTimeoutMs
  }, deps);
}

async function evaluateChromeTab(targetId, expression, options = {}, deps = {}) {
  const config = options.config || getChromeSessionConfig();
  await ensureChromeSessionProxy(config, deps);
  return requestJson(`${config.url}/evaluate`, {
    method: 'POST',
    body: JSON.stringify({ targetId, expression }),
    timeoutMs: config.requestTimeoutMs
  }, deps);
}

async function clickChromeTab(targetId, selector, options = {}, deps = {}) {
  const config = options.config || getChromeSessionConfig();
  await ensureChromeSessionProxy(config, deps);
  return requestJson(`${config.url}/click`, {
    method: 'POST',
    body: JSON.stringify({ targetId, selector }),
    timeoutMs: config.requestTimeoutMs
  }, deps);
}

async function typeChromeTab(targetId, selector, text, options = {}, deps = {}) {
  const config = options.config || getChromeSessionConfig();
  await ensureChromeSessionProxy(config, deps);
  return requestJson(`${config.url}/type`, {
    method: 'POST',
    body: JSON.stringify({ targetId, selector, text, submit: options.submit === true }),
    timeoutMs: config.requestTimeoutMs
  }, deps);
}

module.exports = {
  DEFAULT_PROXY_PORT,
  getChromeSessionConfig,
  isChromeSessionEnabled,
  ensureChromeSessionProxy,
  recoverChromeSession,
  extractWithChromeSession,
  listChromeTargets,
  openChromeTab,
  navigateChromeTab,
  activateChromeTab,
  closeChromeTab,
  evaluateChromeTab,
  clickChromeTab,
  typeChromeTab,
  spawnChromeSessionProxy
};
