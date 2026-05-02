const fs = require('fs');
const { detectPlatform } = require('../../utils/sourceLibrary');
const {
  getChromeSessionConfig,
  isChromeSessionEnabled,
  extractWithChromeSession,
  recoverChromeSession
} = require('./chromeSessionClient');

const LOGIN_SENSITIVE_PLATFORMS = new Set(['x', 'wechat', 'xiaohongshu', 'douyin', 'bilibili']);

function resolvePlaywrightExecutablePath(fileSystem = fs) {
  const candidates = [
    process.env.HERMES_BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fileSystem.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function extractWithPlaywright(url) {
  let playwright;

  try {
    playwright = require('playwright');
  } catch (error) {
    error.message = `Playwright is required for browser fallback: ${error.message}`;
    throw error;
  }

  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: resolvePlaywrightExecutablePath(),
    args: ['--disable-blink-features=AutomationControlled']
  });

  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);

    return await page.evaluate(() => {
      function pickText(selectors) {
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (node && node.textContent && node.textContent.trim()) {
            return node.textContent.trim();
          }
        }
        return '';
      }

      function collectParagraphs(selectors) {
        const values = [];
        const seen = new Set();

        for (const selector of selectors) {
          const nodes = Array.from(document.querySelectorAll(selector));
          for (const node of nodes) {
            const text = (node.textContent || '').trim();
            if (text && !seen.has(text)) {
              seen.add(text);
              values.push(text);
            }
          }
        }

        return values;
      }

      const title = pickText(['#activity-name', 'h1', 'title']);
      const author = pickText(['#js_name', '.account_nickname', '.wx_profile_nickname']);
      const publishTime = pickText(['#publish_time', '.publish_time']);
      const paragraphs = collectParagraphs(['#js_content p', '.rich_media_content p', 'article p', 'main p']);
      const text = paragraphs.join('\n').trim() || (document.body?.innerText || '').trim();
      const excerpt = text.slice(0, 280);

      return {
        title,
        author,
        publishTime,
        text,
        excerpt
      };
    });
  } finally {
    await browser.close();
  }
}

function shouldForceChromeSession(url, chromeSessionConfig, deps = {}) {
  if (deps.allowFreshBrowserFallback === true) {
    return false;
  }

  if (!isChromeSessionEnabled(chromeSessionConfig)) {
    return false;
  }

  return LOGIN_SENSITIVE_PLATFORMS.has(detectPlatform(url));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function looksLikeXLoginShell(result = {}) {
  const combined = `${result.title || ''}\n${result.text || result.excerpt || ''}`.toLowerCase();
  if (!combined.trim()) {
    return false;
  }

  const patterns = [
    /sign in to x/,
    /sign up for x/,
    /create an account/,
    /already have an account/,
    /join x/,
    /立即注册/,
    /立即登录/,
    /注册 x/,
    /登录 x/,
    /x。尽是新鲜事/
  ];

  if (patterns.some((pattern) => pattern.test(combined))) {
    return true;
  }

  return combined.includes('查看键盘快捷键')
    && combined.includes('grok')
    && combined.includes('premium')
    && combined.length < 2500;
}

function isSuspiciousBrowserExtraction(url, result = {}) {
  const platform = detectPlatform(url);
  const text = normalizeText(result.text || result.excerpt);
  const title = normalizeText(result.title);
  const combined = `${title}\n${text}`.toLowerCase();

  if (!combined) {
    return true;
  }

  if (platform === 'x') {
    if (looksLikeXLoginShell(result)) {
      return true;
    }

    if (/\/(?:i\/article\/|[^/]+\/article\/)\d+/i.test(String(url || ''))) {
      return text.length < 120;
    }
  }

  if (platform === 'wechat') {
    return text.length < 80 || /环境异常|完成验证后即可继续访问/i.test(combined);
  }

  if (platform === 'xiaohongshu') {
    return text.length < 80 || /请在 app 内打开|下载小红书 app|登录后查看|页面不存在/i.test(combined);
  }

  if (platform === 'douyin') {
    return text.length < 60 || /请在app内打开|douyin/i.test(combined);
  }

  if (platform === 'bilibili') {
    return /视频去哪了/i.test(combined) || text.length < 40;
  }

  return false;
}

async function extractWithChromeSessionResilient(url, chromeSessionConfig, deps = {}, options = {}) {
  const extractionOptions = { config: chromeSessionConfig, ...(options || {}) };
  const initialResult = await extractWithChromeSession(url, extractionOptions, deps);

  if (!isSuspiciousBrowserExtraction(url, initialResult)) {
    return initialResult;
  }

  if (!chromeSessionConfig.autoRecover || !chromeSessionConfig.recoverCommand || extractionOptions.__retriedAfterSuspiciousContent) {
    return initialResult;
  }

  await recoverChromeSession(chromeSessionConfig, deps);
  return extractWithChromeSession(url, {
    ...extractionOptions,
    __retriedAfterSuspiciousContent: true,
    waitMs: Math.max(Number.parseInt(String(extractionOptions.waitMs || '0'), 10) || 0, 6000),
    closeAfterExtract: extractionOptions.closeAfterExtract !== false
  }, deps);
}

async function extractWithBrowser(url, deps = {}) {
  const chromeSessionConfig = deps.chromeSessionConfig || getChromeSessionConfig();
  const forceChromeSession = shouldForceChromeSession(url, chromeSessionConfig, deps);

  if (isChromeSessionEnabled(chromeSessionConfig)) {
    try {
      return await extractWithChromeSessionResilient(url, chromeSessionConfig, deps);
    } catch (error) {
      if (deps.failOnChromeSessionError || forceChromeSession) {
        throw error;
      }
    }
  }

  const fallbackExtractor = deps.playwrightExtractor || extractWithPlaywright;
  return fallbackExtractor(url);
}

module.exports = {
  extractWithBrowser,
  extractWithPlaywright,
  resolvePlaywrightExecutablePath
};
