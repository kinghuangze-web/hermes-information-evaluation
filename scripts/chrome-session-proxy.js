const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const playwright = require('playwright');

const PORT = Number.parseInt(process.env.HERMES_CHROME_PROXY_PORT || '3456', 10);
const BIND_HOST = String(process.env.HERMES_CHROME_PROXY_BIND_HOST || '127.0.0.1').trim() || '127.0.0.1';
const DEBUG_PORT = Number.parseInt(process.env.HERMES_CHROME_DEBUG_PORT || '0', 10);
const DEBUG_WS_PATH = String(process.env.HERMES_CHROME_DEBUG_WS_PATH || '').trim();
const DEBUG_ENDPOINT = String(process.env.HERMES_CHROME_DEBUG_ENDPOINT || '').trim();

let browserPromise = null;
let browserInstance = null;
const pageIds = new WeakMap();
const knownPages = new Map();

function readDevToolsActivePortFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  const [portLine, wsPathLine] = content.split(/\r?\n/);
  const port = Number.parseInt(String(portLine || '').trim(), 10);

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid DevToolsActivePort file: ${filePath}`);
  }

  return {
    port,
    wsPath: String(wsPathLine || '').trim()
  };
}

function getDevToolsActivePortPaths() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  const windowsMountedPaths = [];

  if (process.platform === 'linux' && fs.existsSync('/mnt/c/Users')) {
    try {
      for (const entry of fs.readdirSync('/mnt/c/Users', { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        windowsMountedPaths.push(
          path.join('/mnt/c/Users', entry.name, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'DevToolsActivePort'),
          path.join('/mnt/c/Users', entry.name, 'AppData', 'Local', 'Google', 'Chrome Beta', 'User Data', 'DevToolsActivePort'),
          path.join('/mnt/c/Users', entry.name, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'DevToolsActivePort'),
          path.join('/mnt/c/Users', entry.name, 'AppData', 'Local', 'Chromium', 'User Data', 'DevToolsActivePort')
        );
      }
    } catch {
    }
  }

  return [
    process.env.HERMES_CHROME_DEVTOOLS_FILE,
    localAppData ? path.join(localAppData, 'Google', 'Chrome', 'User Data', 'DevToolsActivePort') : '',
    localAppData ? path.join(localAppData, 'Google', 'Chrome Beta', 'User Data', 'DevToolsActivePort') : '',
    localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'DevToolsActivePort') : '',
    localAppData ? path.join(localAppData, 'Chromium', 'User Data', 'DevToolsActivePort') : '',
    ...windowsMountedPaths,
    path.join(home, '.config', 'google-chrome', 'DevToolsActivePort'),
    path.join(home, '.config', 'chromium', 'DevToolsActivePort'),
    path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'DevToolsActivePort')
  ].filter(Boolean);
}

async function resolveWebSocketDebuggerUrl(port, fallbackWsPath = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });

    if (response.ok) {
      const payload = await response.json();
      const browserWsUrl = String(payload?.webSocketDebuggerUrl || '').trim();
      if (browserWsUrl) {
        return browserWsUrl.replace(/^ws:\/\/localhost\//i, `ws://127.0.0.1:${port}/`);
      }
    }
  } catch {
  } finally {
    clearTimeout(timer);
  }

  const wsPath = fallbackWsPath || '/devtools/browser';
  return `ws://127.0.0.1:${port}${wsPath}`;
}

async function discoverChromeEndpoint() {
  if (DEBUG_ENDPOINT) {
    return DEBUG_ENDPOINT;
  }

  if (DEBUG_PORT > 0) {
    return resolveWebSocketDebuggerUrl(DEBUG_PORT, DEBUG_WS_PATH);
  }

  for (const candidate of getDevToolsActivePortPaths()) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const { port, wsPath } = readDevToolsActivePortFile(candidate);
      return await resolveWebSocketDebuggerUrl(port, wsPath);
    } catch {
    }
  }

  throw new Error('Cannot locate Chrome DevToolsActivePort. Open chrome://inspect/#remote-debugging, allow this browser instance to be debugged, then restart Chrome.');
}

function registerBrowserLifecycle(browser) {
  if (!browser || browser.__hermesLifecycleBound) {
    return browser;
  }

  browser.__hermesLifecycleBound = true;
  browser.on('disconnected', () => {
    browserInstance = null;
    browserPromise = null;
    knownPages.clear();
  });
  return browser;
}

async function ensureBrowser() {
  if (browserInstance) {
    return browserInstance;
  }

  if (!browserPromise) {
    browserPromise = discoverChromeEndpoint()
      .then((endpoint) => playwright.chromium.connectOverCDP(endpoint))
      .then((browser) => {
        browserInstance = registerBrowserLifecycle(browser);
        return browserInstance;
      })
      .catch((error) => {
        browserPromise = null;
        browserInstance = null;
        throw error;
      });
  }

  return browserPromise;
}

function getDefaultContext(browser) {
  const contexts = browser.contexts();
  if (contexts.length > 0) {
    return contexts[0];
  }
  throw new Error('Connected Chrome did not expose any browser context');
}

function ensurePageId(page) {
  if (!pageIds.has(page)) {
    pageIds.set(page, `tab_${crypto.randomUUID().slice(0, 8)}`);
  }

  const targetId = pageIds.get(page);
  knownPages.set(targetId, page);
  return targetId;
}

async function syncTargets() {
  const browser = await ensureBrowser();
  const pages = browser.contexts().flatMap((context) => context.pages());
  const aliveTargetIds = new Set();
  const targets = [];

  for (const page of pages) {
    if (page.isClosed()) {
      continue;
    }

    const targetId = ensurePageId(page);
    aliveTargetIds.add(targetId);
    let title = '';
    try {
      title = await page.title();
    } catch {
    }

    targets.push({
      targetId,
      url: page.url(),
      title
    });
  }

  for (const [targetId, page] of knownPages.entries()) {
    if (page.isClosed() || !aliveTargetIds.has(targetId)) {
      knownPages.delete(targetId);
    }
  }

  return targets;
}

async function getPageByTargetId(targetId) {
  await syncTargets();
  const page = knownPages.get(String(targetId || '').trim());
  if (!page || page.isClosed()) {
    throw new Error(`Unknown Chrome tab: ${targetId}`);
  }
  return page;
}

async function findPageByUrl(url) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    return null;
  }

  const targets = await syncTargets();
  const match = targets.find((target) => target.url === normalizedUrl)
    || targets.find((target) => target.url.startsWith(normalizedUrl));

  if (!match) {
    return null;
  }

  return getPageByTargetId(match.targetId);
}

async function createPage(url = '', options = {}) {
  const browser = await ensureBrowser();
  const context = getDefaultContext(browser);
  const page = await context.newPage();
  const targetId = ensurePageId(page);

  if (String(url || '').trim()) {
    await page.goto(String(url).trim(), {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs || 60000
    });
  }

  if (options.bringToFront !== false) {
    await page.bringToFront();
  }

  return { page, targetId };
}

function isXArticleUrl(url = '') {
  return /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/article\/|[^/]+\/article\/)\d+/i.test(String(url || '').trim());
}

async function waitForSettled(page, waitMs = 1500) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
  } catch {
  }

  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
  }

  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }

  if (isXArticleUrl(page.url())) {
    try {
      await page.waitForFunction(() => {
        const main = document.querySelector('main');
        return Boolean(main && String(main.innerText || '').trim().length >= 200);
      }, { timeout: 10000 });
    } catch {
    }
  }
}

async function extractPageContent(page, waitMs = 1500) {
  await waitForSettled(page, waitMs);

  return page.evaluate(() => {
    function normalizeText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeMultilineText(value) {
      return String(value || '')
        .replace(/\u00a0/g, ' ')
        .split(/\r?\n/)
        .map((line) => normalizeText(line))
        .filter(Boolean)
        .join('\n')
        .trim();
    }

    function isXArticlePage(url) {
      return /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/article\/|[^/]+\/article\/)\d+/i.test(String(url || '').trim());
    }

    function isUiNoiseLine(line) {
      const value = normalizeText(line);
      if (!value) {
        return true;
      }

      const patterns = [
        /^要查看键盘快捷键$/,
        /^查看键盘快捷键$/,
        /^主页$/,
        /^探索$/,
        /^通知$/,
        /^关注$/,
        /^聊天$/,
        /^grok$/i,
        /^书签$/,
        /^premium(?:\s+\d+%.*)?$/i,
        /^个人资料$/,
        /^更多$/,
        /^发帖$/,
        /^文章$/,
        /^查看新帖子$/,
        /^对话$/,
        /^引用$/,
        /^相关$/,
        /^查看引用$/,
        /^发布你的回复$/,
        /^回复$/,
        /^相关用户$/,
        /^当前趋势$/,
        /^显示更多$/,
        /^服务条款\b/i,
        /^隐私政策\b/i,
        /^cookie 政策$/i,
        /^辅助功能$/,
        /^广告信息$/,
        /^promoted by /i,
        /^© \d{4} x corp\.$/i,
        /^点击 关注 /,
        /^@[\w.]+$/,
        /^\d[\d,.]*[万亿]?$/,
        /^·$/
      ];

      return patterns.some((pattern) => pattern.test(value));
    }

    function extractXArticleContent() {
      const main = document.querySelector('main');
      const mainText = normalizeMultilineText(main && main.innerText);
      if (!mainText) {
        return null;
      }

      let lines = mainText.split('\n').map((line) => normalizeText(line)).filter(Boolean);
      lines = lines.filter((line) => !isUiNoiseLine(line));

      const stopPatterns = [
        /^想发布自己的文章？$/,
        /^升级为 premium$/i,
        /^服务条款\b/i,
        /^当前趋势$/
      ];
      const stopIndex = lines.findIndex((line) => stopPatterns.some((pattern) => pattern.test(line)));
      if (stopIndex >= 0) {
        lines = lines.slice(0, stopIndex);
      }

      const title = lines[0] || normalizeText(document.title);
      if (!title) {
        return null;
      }

      const publishTime = lines.find((line) => /^(?:上午|下午)?\d{1,2}:\d{2}\s*·\s*\d{4}年\d{1,2}月\d{1,2}日$/.test(line)
        || /^\d{1,2}月\d{1,2}日$/.test(line)) || '';
      const author = lines.length > 1 ? lines[1] : '';

      let bodyStartIndex = lines.findIndex((line, index) => {
        if (index === 0) {
          return false;
        }

        if (line === author || line === publishTime) {
          return false;
        }

        return line.length >= 20 || /[。！？.!?]/.test(line);
      });

      if (bodyStartIndex < 0) {
        bodyStartIndex = publishTime ? lines.indexOf(publishTime) + 1 : 1;
      }

      const text = lines.slice(Math.max(bodyStartIndex, 1)).join('\n').trim();
      if (!text) {
        return null;
      }

      return {
        title,
        author,
        publishTime,
        text,
        excerpt: text.slice(0, 280),
        url: location.href
      };
    }

    function pickText(selectors) {
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        const text = normalizeText(node && node.textContent);
        if (text) {
          return text;
        }
      }
      return '';
    }

    function collectText(selectors) {
      const values = [];
      const seen = new Set();

      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((node) => {
          const text = normalizeText(node.textContent);
          if (text && !seen.has(text)) {
            seen.add(text);
            values.push(text);
          }
        });
      });

      return values;
    }

    if (isXArticlePage(location.href)) {
      const articleContent = extractXArticleContent();
      if (articleContent) {
        return articleContent;
      }
    }

    const title = pickText([
      '#activity-name',
      'h1',
      'article h1',
      '[data-testid="tweetText"]',
      '.note-content',
      'title'
    ]) || normalizeText(document.title);

    const author = pickText([
      '#js_name',
      '.account_nickname',
      '.wx_profile_nickname',
      '[data-testid="User-Name"]',
      '.author',
      '.username'
    ]);

    const publishTime = pickText([
      '#publish_time',
      '.publish_time',
      'time',
      '.note-date'
    ]);

    const bodyCandidates = collectText([
      '#js_content p',
      '.rich_media_content p',
      'article p',
      'main p',
      '.note-content',
      '.content',
      '[data-testid="tweetText"]',
      '.desc',
      '.video-info-detail'
    ]);

    const bodyText = normalizeText(document.body && document.body.innerText);
    const text = bodyCandidates.join('\n').trim() || bodyText;

    return {
      title,
      author,
      publishTime,
      text,
      excerpt: text.slice(0, 280),
      url: location.href
    };
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_request, response) => {
    try {
      const browser = await ensureBrowser();
      const targets = await syncTargets();
      const endpoint = await discoverChromeEndpoint();
      response.json({
        ok: true,
        connected: true,
        endpoint,
        browserVersion: typeof browser.version === 'function' ? browser.version() : '',
        targets: targets.length
      });
    } catch (error) {
      response.status(503).json({
        ok: false,
        connected: false,
        error: error.message
      });
    }
  });

  app.get(['/targets', '/tabs'], async (_request, response) => {
    try {
      response.json({
        ok: true,
        targets: await syncTargets()
      });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/new', async (request, response) => {
    try {
      const created = await createPage(request.body?.url || '', {
        bringToFront: request.body?.bringToFront !== false
      });
      response.json({
        ok: true,
        targetId: created.targetId,
        url: created.page.url()
      });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/navigate', async (request, response) => {
    try {
      const page = await getPageByTargetId(request.body?.targetId);
      const url = String(request.body?.url || '').trim();
      if (!url) {
        throw new Error('navigate requires url');
      }

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (request.body?.bringToFront !== false) {
        await page.bringToFront();
      }

      response.json({ ok: true, targetId: ensurePageId(page), url: page.url() });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/activate', async (request, response) => {
    try {
      const page = await getPageByTargetId(request.body?.targetId);
      await page.bringToFront();
      response.json({ ok: true, targetId: ensurePageId(page), url: page.url() });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/close', async (request, response) => {
    try {
      const page = await getPageByTargetId(request.body?.targetId);
      const targetId = ensurePageId(page);
      await page.close();
      knownPages.delete(targetId);
      response.json({ ok: true, targetId });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/evaluate', async (request, response) => {
    try {
      const page = await getPageByTargetId(request.body?.targetId);
      const expression = String(request.body?.expression || '').trim();
      if (!expression) {
        throw new Error('evaluate requires expression');
      }

      const result = await page.evaluate((source) => {
        // eslint-disable-next-line no-new-func
        return Function(`return (${source});`)();
      }, expression);

      response.json({ ok: true, targetId: ensurePageId(page), result });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/click', async (request, response) => {
    try {
      const page = await getPageByTargetId(request.body?.targetId);
      const selector = String(request.body?.selector || '').trim();
      if (!selector) {
        throw new Error('click requires selector');
      }

      await page.locator(selector).first().click({ timeout: 15000 });
      response.json({ ok: true, targetId: ensurePageId(page), url: page.url() });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/type', async (request, response) => {
    try {
      const page = await getPageByTargetId(request.body?.targetId);
      const selector = String(request.body?.selector || '').trim();
      if (!selector) {
        throw new Error('type requires selector');
      }

      await page.locator(selector).first().fill(String(request.body?.text || ''));
      if (request.body?.submit) {
        await page.keyboard.press('Enter');
      }

      response.json({ ok: true, targetId: ensurePageId(page), url: page.url() });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/extract', async (request, response) => {
    let page;
    let targetId = '';
    let createdForExtract = false;

    try {
      const waitMs = Number.parseInt(String(request.body?.waitMs || '1500'), 10) || 1500;
      if (request.body?.targetId) {
        page = await getPageByTargetId(request.body.targetId);
        targetId = ensurePageId(page);
      } else {
        page = request.body?.reuseExisting === false ? null : await findPageByUrl(request.body?.url || '');
        if (page) {
          targetId = ensurePageId(page);
        } else {
          const created = await createPage(request.body?.url || '', { bringToFront: false });
          page = created.page;
          targetId = created.targetId;
          createdForExtract = true;
        }
      }

      const result = await extractPageContent(page, waitMs);

      if ((request.body?.closeAfterExtract !== false) && createdForExtract && !page.isClosed()) {
        await page.close();
        knownPages.delete(targetId);
      }

      response.json({
        ...result,
        ok: true,
        targetId
      });
    } catch (error) {
      if (page && createdForExtract && !page.isClosed()) {
        try {
          await page.close();
        } catch {
        }
      }

      if (targetId) {
        knownPages.delete(targetId);
      }

      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.listen(PORT, BIND_HOST, () => {
    console.log(`Hermes Chrome session proxy listening on http://${BIND_HOST}:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
