const { detectPlatform } = require('../../utils/sourceLibrary');
const { normalizeList, normalizeMetadata } = require('../library');
const { extractWithBrowser } = require('./browserFetcher');
const { getCamofoxConfig, isCamofoxEnabled, extractWithCamofox } = require('./camofoxClient');
const { resolveImageText } = require('./imageOcr');

function extractUrlsFromText(value = '') {
  const matches = String(value || '').match(/https?:\/\/[^\s]+/gi);
  return normalizeList(matches || []);
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function hasReadableExpansionContent(item = {}) {
  return Boolean(String(item?.text || item?.excerpt || item?.title || '').trim());
}

function shouldPreserveExistingExpansion(item = {}) {
  if (String(item?.status || '').trim() !== 'resolved') {
    return false;
  }

  if (!hasReadableExpansionContent(item)) {
    return false;
  }

  if (String(item?.fetchMethod || '').trim() === 'chrome_session_bridge') {
    return true;
  }

  return !item?.isPartial;
}

function stripHtml(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaContent(html = '', matcher) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${matcher}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${matcher}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${matcher}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${matcher}["']`, 'i')
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return '';
}

function extractTitleFromHtml(html = '') {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  return pickFirstNonEmpty(
    extractMetaContent(html, 'og:title'),
    titleMatch?.[1] || ''
  );
}

function looksLikeWechatVerificationPage(html = '') {
  const content = String(html || '');
  return /环境异常|完成验证后即可继续访问|secitptpage\/verify|当前环境异常/i.test(content);
}

function buildGenericHtmlResult(url, html) {
  const title = extractTitleFromHtml(html);
  const excerpt = pickFirstNonEmpty(
    extractMetaContent(html, 'description'),
    extractMetaContent(html, 'og:description'),
    stripHtml(html).slice(0, 280)
  );
  const text = stripHtml(html).slice(0, 4000);

  return {
    url,
    status: 'resolved',
    platform: detectPlatform(url),
    fetchMethod: 'html_fetch',
    title,
    excerpt,
    text
  };
}

function buildBrowserFallbackResult(url, result = {}) {
  return {
    url,
    status: 'resolved',
    platform: detectPlatform(url),
    fetchMethod: 'browser_fallback',
    title: result.title || '',
    excerpt: result.excerpt || '',
    text: result.text || '',
    author: result.author || '',
    publishTime: result.publishTime || ''
  };
}

function buildCamofoxResult(url, result = {}) {
  return {
    url,
    status: 'resolved',
    platform: detectPlatform(url),
    fetchMethod: 'camofox_browser',
    title: result.title || '',
    excerpt: result.excerpt || '',
    text: result.text || ''
  };
}

function shouldUseCamofoxFirst(url, config = getCamofoxConfig()) {
  if (!isCamofoxEnabled(config)) {
    return false;
  }

  const platform = detectPlatform(url);
  return ['wechat', 'xiaohongshu', 'douyin', 'bilibili'].includes(platform);
}

function shouldUseBrowserFallback(url, html, genericResult = {}) {
  const platform = detectPlatform(url);
  const text = String(genericResult.text || '');
  const title = String(genericResult.title || '');
  const combined = `${html || ''} ${text} ${title}`.toLowerCase();

  if (looksLikeWechatVerificationPage(html)) {
    return true;
  }

  if (platform === 'douyin') {
    return !title.trim() || text.trim().length < 40 || /请在app内打开|douyin/i.test(combined);
  }

  if (platform === 'xiaohongshu') {
    return /页面不见了|请在 app 内打开|下载小红书 app|登录后查看|访问的页面不见了/i.test(combined)
      || text.trim().length < 40;
  }

  if (platform === 'bilibili') {
    return /视频去哪了呢/i.test(combined);
  }

  return false;
}

function extractTweetId(url = '') {
  const match = String(url || '').match(/status\/(\d+)/i);
  return match?.[1] || '';
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeXArticleUrl(value = '') {
  const rawValue = String(value || '').trim();
  if (!rawValue || !/x\.com\/i\/article\//i.test(rawValue)) {
    return '';
  }

  return rawValue.replace(/^http:\/\//i, 'https://');
}

function extractXArticleUrl(data = {}) {
  const articleId = String(data.article?.rest_id || '').trim();
  if (articleId) {
    return `https://x.com/i/article/${articleId}`;
  }

  const entityUrls = Array.isArray(data.entities?.urls) ? data.entities.urls : [];
  for (const item of entityUrls) {
    const articleUrl = normalizeXArticleUrl(item.expanded_url || item.url);
    if (articleUrl) {
      return articleUrl;
    }
  }

  return '';
}

function isDirectXArticleUrl(value = '') {
  return /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/article\/|[^/]+\/article\/)\d+/i.test(String(value || '').trim());
}

function shouldUseXArticleBrowserFallback(deps = {}) {
  if (deps.xArticleBrowserFallback !== undefined) {
    return parseBoolean(deps.xArticleBrowserFallback);
  }

  return parseBoolean(process.env.HERMES_X_ARTICLE_BROWSER_FALLBACK);
}

function looksLikeXLoginShell(result = {}) {
  const title = String(result.title || '').trim();
  const text = String(result.text || result.excerpt || '').trim();
  const combined = `${title}\n${text}`.toLowerCase();

  if (!combined) {
    return false;
  }

  const patterns = [
    /注册\s*x/,
    /登录\s*x/,
    /sign in to x/,
    /sign up for x/,
    /join x/,
    /x。尽是新鲜事/,
    /x\. it'?s what's happening/,
    /create an account/,
    /already have an account/,
    /立即登录/,
    /立即注册/
  ];

  if (patterns.some((pattern) => pattern.test(combined))) {
    return true;
  }

  return combined.includes('查看键盘快捷键')
    && combined.includes('grok')
    && combined.includes('premium')
    && text.length < 2000;
}

function shouldAcceptXArticleBrowserResult(articleResult = {}, baseResult = {}) {
  const articleText = pickFirstNonEmpty(articleResult.text, articleResult.excerpt);
  if (!articleText) {
    return false;
  }

  if (looksLikeXLoginShell(articleResult)) {
    return false;
  }

  const minimumLength = Math.max(String(baseResult.text || '').length, 20);
  return articleText.length >= minimumLength;
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Remote fetch failed with status ${response.status}`);
  }

  return response.text();
}

async function resolveXTweetContent(url, deps = {}) {
  const tweetId = extractTweetId(url);
  if (!tweetId) {
    return {
      url,
      status: 'unresolved',
      platform: 'other',
      fetchMethod: 'x_syndication',
      title: '',
      excerpt: '',
      text: ''
    };
  }

  const resolver = deps.tweetResolver || (async () => {
    const fetchImpl = deps.fetchImpl || fetch;
    const response = await fetchImpl(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=x`, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Tweet syndication failed with status ${response.status}`);
    }

    const data = await response.json();
    const text = pickFirstNonEmpty(data.article?.preview_text, data.text);
    const articleUrl = extractXArticleUrl(data);

    return {
      title: pickFirstNonEmpty(data.article?.title, data.user?.name ? `${data.user.name} 的推文` : ''),
      text,
      excerpt: text.slice(0, 280),
      author: data.user?.screen_name || '',
      articleUrl,
      isPartial: Boolean(articleUrl)
    };
  });

  const result = await resolver({ url, tweetId });
  const articleUrl = result.articleUrl || '';
  const baseResult = {
    url,
    status: 'resolved',
    platform: 'x',
    fetchMethod: articleUrl && result.isPartial !== false ? 'x_syndication_preview' : 'x_syndication',
    title: result.title || '',
    excerpt: result.excerpt || '',
    text: result.text || '',
    author: result.author || '',
    articleUrl,
    isPartial: Boolean(articleUrl && result.isPartial !== false)
  };

  if (!articleUrl || !shouldUseXArticleBrowserFallback(deps)) {
    return baseResult;
  }

  const articleExtractor = deps.xArticleExtractor
    || deps.browserExtractor
    || ((targetUrl) => extractWithBrowser(targetUrl, deps));

  try {
    const articleResult = await articleExtractor(articleUrl);
    const articleText = pickFirstNonEmpty(articleResult.text, articleResult.excerpt);

    if (shouldAcceptXArticleBrowserResult(articleResult, baseResult)) {
      return {
        ...baseResult,
        fetchMethod: 'x_article_browser',
        title: pickFirstNonEmpty(articleResult.title, baseResult.title),
        excerpt: pickFirstNonEmpty(articleResult.excerpt, articleText.slice(0, 280), baseResult.excerpt),
        text: articleText,
        isPartial: false
      };
    }

    if (articleText) {
      return {
        ...baseResult,
        articleFetchError: 'Current Chrome session did not expose a readable X article body'
      };
    }
  } catch (error) {
    return {
      ...baseResult,
      articleFetchError: error.message
    };
  }

  return baseResult;
}

async function resolveWechatContent(url, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const html = await fetchText(url, fetchImpl);

  if (!looksLikeWechatVerificationPage(html)) {
    return buildGenericHtmlResult(url, html);
  }

  const browserExtractor = deps.browserExtractor || ((targetUrl) => extractWithBrowser(targetUrl, deps));
  return buildBrowserFallbackResult(url, await browserExtractor(url));
}

async function resolveDirectXArticleContent(url, deps = {}) {
  const browserExtractor = deps.browserExtractor || ((targetUrl) => extractWithBrowser(targetUrl, deps));
  const articleResult = await browserExtractor(url);
  const articleText = pickFirstNonEmpty(articleResult.text, articleResult.excerpt);

  if (!articleText || looksLikeXLoginShell(articleResult)) {
    return {
      url,
      status: 'failed',
      platform: 'x',
      fetchMethod: 'x_article_browser_direct',
      title: articleResult.title || '',
      excerpt: articleResult.excerpt || '',
      text: articleResult.text || '',
      error: 'Current Chrome session did not expose a readable X article body'
    };
  }

  return {
    url,
    status: 'resolved',
    platform: 'x',
    fetchMethod: 'x_article_browser_direct',
    title: articleResult.title || '',
    excerpt: pickFirstNonEmpty(articleResult.excerpt, articleText.slice(0, 280)),
    text: articleText,
    author: articleResult.author || '',
    publishTime: articleResult.publishTime || ''
  };
}

async function resolveRemoteContent(input = {}, deps = {}) {
  const url = String(input.url || '').trim();
  if (!url) {
    return {
      url: '',
      status: 'unresolved',
      platform: 'other',
      fetchMethod: 'none',
      title: '',
      excerpt: '',
      text: ''
    };
  }

  if (/x\.com\/.+\/status\/|twitter\.com\/.+\/status\//i.test(url)) {
    return resolveXTweetContent(url, deps);
  }

  if (isDirectXArticleUrl(url)) {
    return resolveDirectXArticleContent(url, deps);
  }

  const camofoxConfig = deps.camofoxConfig || getCamofoxConfig();
  const camofoxExtractor = deps.camofoxExtractor || ((targetUrl) => extractWithCamofox(targetUrl, { config: camofoxConfig }, deps));

  if (shouldUseCamofoxFirst(url, camofoxConfig)) {
    try {
      const camofoxResult = await camofoxExtractor(url);
      if (String(camofoxResult.text || camofoxResult.excerpt || '').trim()) {
        return buildCamofoxResult(url, camofoxResult);
      }
    } catch {
    }
  }

  if (/mp\.weixin\.qq\.com/i.test(url)) {
    return resolveWechatContent(url, deps);
  }

  const fetchImpl = deps.fetchImpl || fetch;
  const html = await fetchText(url, fetchImpl);
  const genericResult = buildGenericHtmlResult(url, html);

  if (shouldUseBrowserFallback(url, html, genericResult)) {
    const browserExtractor = deps.browserExtractor || ((targetUrl) => extractWithBrowser(targetUrl, deps));
    return buildBrowserFallbackResult(url, await browserExtractor(url));
  }

  return genericResult;
}

function buildEnrichedRawText(rawText, expansions) {
  const parts = [String(rawText || '').trim()].filter(Boolean);

  expansions.forEach((item) => {
    if (item.status !== 'resolved') {
      return;
    }

    const snippet = pickFirstNonEmpty(item.text, item.excerpt).slice(0, 1200);
    const source = `来源：${item.url}`;
    const title = item.title ? `标题：${item.title}` : '';
    const text = snippet ? `摘录：${snippet}` : '';
    const partialNote = item.isPartial
      ? `状态：仅抓取到预览，完整正文可能需要登录浏览器打开 ${item.articleUrl || item.url}`
      : '';
    parts.push([source, title, text, partialNote].filter(Boolean).join('\n'));
  });

  return parts.join('\n\n').trim();
}

function buildEnrichedImageText(expansions) {
  const snippets = [];

  expansions.forEach((item) => {
    if (item.status !== 'resolved' || !item.text) {
      return;
    }

    const source = pickFirstNonEmpty(item.imageUrl, item.imagePath, 'image');
    snippets.push(`图片识别来源：${source}\n识别文本：${item.text.slice(0, 800)}`);
  });

  return snippets.join('\n\n').trim();
}

async function enrichHermesPayload(payload = {}, deps = {}) {
  const originalRawText = String(payload.rawText || '').trim();
  const detectedLinks = extractUrlsFromText(originalRawText);
  const links = normalizeList([...(payload.links || []), ...detectedLinks]);
  const images = normalizeList(payload.images);
  const metadata = normalizeMetadata(payload.metadata);
  const resolveContent = deps.resolveContent || ((input) => resolveRemoteContent(input, deps));
  const resolveImage = deps.resolveImageText || ((input) => resolveImageText(input, deps));
  const existingLinkExpansions = Array.isArray(metadata.linkExpansions) ? metadata.linkExpansions : [];
  const existingLinkExpansionMap = new Map(
    existingLinkExpansions
      .filter((item) => String(item?.url || '').trim())
      .map((item) => [String(item.url).trim(), item])
  );
  const linkExpansions = [];
  const imageExpansions = [];

  for (const url of links) {
    const existingExpansion = existingLinkExpansionMap.get(url);
    if (shouldPreserveExistingExpansion(existingExpansion)) {
      linkExpansions.push(existingExpansion);
      continue;
    }

    try {
      linkExpansions.push(await resolveContent({ url }));
    } catch (error) {
      linkExpansions.push({
        url,
        status: 'failed',
        platform: detectPlatform(url),
        fetchMethod: 'error',
        title: '',
        excerpt: '',
        text: '',
        error: error.message
      });
    }
  }

  for (const imageUrl of images) {
    try {
      imageExpansions.push(await resolveImage({ imageUrl }));
    } catch (error) {
      imageExpansions.push({
        imageUrl,
        status: 'failed',
        fetchMethod: 'ocr',
        text: '',
        excerpt: '',
        error: error.message
      });
    }
  }

  const enrichedImageText = buildEnrichedImageText(imageExpansions);

  return {
    ...payload,
    links,
    rawText: [buildEnrichedRawText(originalRawText, linkExpansions), enrichedImageText].filter(Boolean).join('\n\n').trim(),
    metadata: {
      ...metadata,
      evidenceCapturedAt: new Date().toISOString(),
      originalRawText,
      linkExpansions,
      imageExpansions
    }
  };
}

module.exports = {
  extractUrlsFromText,
  stripHtml,
  extractTitleFromHtml,
  looksLikeWechatVerificationPage,
  resolveRemoteContent,
  enrichHermesPayload
};
