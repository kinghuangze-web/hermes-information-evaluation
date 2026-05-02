const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { URL } = require('url');

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function trimTrailingSlash(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getCamofoxConfig(env = process.env) {
  return {
    enabled: parseBoolean(env.COMFOX || env.CAMOFOX_ENABLED),
    url: trimTrailingSlash(env.CAMOFOX_URL || env.COMFOX_URL),
    apiKey: String(env.CAMOFOX_API_KEY || '').trim(),
    userId: String(env.CAMOFOX_USER_ID || env.CAMOFOX_USER || 'hermes-agent').trim() || 'hermes-agent',
    wslDistro: String(env.CAMOFOX_WSL_DISTRO || env.WSL_DISTRO_NAME || 'Ubuntu-24.04').trim() || 'Ubuntu-24.04',
    wslHost: String(env.CAMOFOX_WSL_HOST || '').trim()
  };
}

function isCamofoxEnabled(config = getCamofoxConfig()) {
  return Boolean(config.enabled && config.url);
}

function buildHeaders(config = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  return headers;
}

function parseUrl(value = '') {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackUrl(value = '') {
  const parsed = parseUrl(value);
  if (!parsed) {
    return false;
  }

  return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
}

function normalizeWslHost(value = '') {
  return String(value || '').trim().split(/\s+/)[0] || '';
}

function discoverWslHost(config = {}, deps = {}) {
  const configuredHost = normalizeWslHost(config.wslHost);
  if (configuredHost) {
    return configuredHost;
  }

  if (process.platform !== 'win32') {
    return '';
  }

  const runner = deps.execFileSync || execFileSync;
  const output = runner('wsl', [
    '-d',
    config.wslDistro || 'Ubuntu-24.04',
    'bash',
    '-lc',
    "hostname -I | awk '{print $1}'"
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return normalizeWslHost(output);
}

function buildWslFallbackUrl(config = {}, deps = {}) {
  if (!isLoopbackUrl(config.url)) {
    return '';
  }

  const parsed = parseUrl(config.url);
  if (!parsed) {
    return '';
  }

  const wslHost = discoverWslHost(config, deps);
  if (!wslHost) {
    return '';
  }

  parsed.hostname = wslHost;
  return trimTrailingSlash(parsed.toString());
}

async function readJson(response) {
  if (!response.json) {
    return {};
  }

  return response.json();
}

function buildSessionKey(url = '') {
  return `hermes_${crypto.createHash('sha1').update(String(url || '')).digest('hex').slice(0, 12)}`;
}

async function requestCamofox(config, path, options = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const requestUrls = [trimTrailingSlash(config.url)];
  const fallbackUrl = buildWslFallbackUrl(config, deps);

  if (fallbackUrl && !requestUrls.includes(fallbackUrl)) {
    requestUrls.push(fallbackUrl);
  }

  let lastError = null;

  for (const baseUrl of requestUrls) {
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...options,
        headers: {
          ...(options.headers || {}),
          ...buildHeaders(config)
        }
      });

      if (!response.ok) {
        const data = await readJson(response).catch(() => ({}));
        throw new Error(data.error || `Camofox request failed with status ${response.status}`);
      }

      return readJson(response);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Camofox request failed');
}

async function extractWithCamofox(url, options = {}, deps = {}) {
  const config = options.config || getCamofoxConfig(options.env);
  if (!isCamofoxEnabled(config)) {
    throw new Error('Camofox is not enabled');
  }

  const userId = options.userId || config.userId;
  const sessionKey = options.sessionKey || buildSessionKey(url);
  const waitTimeout = options.waitTimeout || 15000;
  let tabId = null;

  await requestCamofox(config, '/health', { method: 'GET', headers: {} }, deps);

  try {
    const tab = await requestCamofox(config, '/tabs', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        sessionKey,
        url
      })
    }, deps);
    tabId = tab.tabId;

    if (!tabId) {
      throw new Error('Camofox did not return a tabId');
    }

    await requestCamofox(config, `/tabs/${tabId}/wait`, {
      method: 'POST',
      body: JSON.stringify({
        userId,
        timeout: waitTimeout,
        waitForNetwork: false
      })
    }, deps);

    const extraction = await requestCamofox(config, `/tabs/${tabId}/evaluate`, {
      method: 'POST',
      body: JSON.stringify({
        userId,
        expression: `(async () => {
          const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
          const metaDescription = document.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute('content') || '';
          const title = document.title || document.querySelector('h1')?.textContent || '';
          return {
            title: String(title || '').trim(),
            text: String(bodyText || '').slice(0, 4000),
            excerpt: String(metaDescription || bodyText || '').slice(0, 280)
          };
        })()`
      })
    }, deps);

    return {
      title: extraction.result?.title || '',
      text: extraction.result?.text || '',
      excerpt: extraction.result?.excerpt || ''
    };
  } finally {
    if (tabId) {
      try {
        await requestCamofox(config, `/tabs/${tabId}`, {
          method: 'DELETE',
          body: JSON.stringify({ userId })
        }, deps);
      } catch {
      }
    }
  }
}

module.exports = {
  getCamofoxConfig,
  isCamofoxEnabled,
  extractWithCamofox,
  discoverWslHost,
  buildWslFallbackUrl
};
