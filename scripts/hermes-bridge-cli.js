#!/usr/bin/env node

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const fs = require('node:fs');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((item) => normalizeString(item)).filter(Boolean))];
}

function detectPlatform(url = '') {
  const value = normalizeString(url);
  if (!value) {
    return 'chat';
  }

  if (/mp\.weixin\.qq\.com/i.test(value)) {
    return 'wechat';
  }
  if (/douyin\.com|iesdouyin\.com/i.test(value)) {
    return 'douyin';
  }
  if (/xiaohongshu\.com|xhslink\.com/i.test(value)) {
    return 'xiaohongshu';
  }
  if (/x\.com|twitter\.com/i.test(value)) {
    return 'x';
  }
  if (/bilibili\.com|b23\.tv/i.test(value)) {
    return 'bilibili';
  }

  return 'other';
}

function isUrlOnlyText(value = '') {
  const normalized = normalizeString(value);
  if (!normalized) {
    return false;
  }

  const withoutUrls = normalized.replace(/https?:\/\/[^\s]+/gi, ' ').replace(/\s+/g, ' ').trim();
  return !withoutUrls;
}

function parseArgs(argv) {
  const options = {
    useStdin: false,
    rawPayload: '',
    dataDir: '',
    allowRemoteFetch: true,
    writerType: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--stdin') {
      options.useStdin = true;
      continue;
    }

    if (arg === '--data-dir' && argv[index + 1]) {
      options.dataDir = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }

    if (arg.startsWith('--data-dir=')) {
      options.dataDir = String(arg.split('=').slice(1).join('=') || '').trim();
      continue;
    }

    if (arg === '--no-remote-fetch') {
      options.allowRemoteFetch = false;
      continue;
    }

    if (arg === '--writer-type' && argv[index + 1]) {
      options.writerType = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }

    if (arg.startsWith('--writer-type=')) {
      options.writerType = String(arg.split('=').slice(1).join('=') || '').trim();
      continue;
    }

    if (!arg.startsWith('--') && !options.rawPayload) {
      options.rawPayload = arg;
    }
  }

  return options;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function buildRawTextPayload(rawInput) {
  return {
    rawText: normalizeString(rawInput),
    links: [],
    images: [],
    attachments: [],
    sourcePlatform: 'hermes_orchestrator',
    sourceType: 'text'
  };
}

function readExtraContextFile(env = process.env) {
  const filePath = normalizeString(env.HERMES_EXTRA_CONTEXT_FILE);
  if (!filePath) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildLinkExpansionFromExtraContext(extraContext = {}, fallbackUrl = '') {
  const url = normalizeString(extraContext.url || fallbackUrl);
  const text = normalizeString(
    extraContext.fullTextSummary
      || extraContext.fullText
      || extraContext.text
      || extraContext.body
  );
  const title = normalizeString(extraContext.title);
  const excerpt = normalizeString(extraContext.excerpt || text.slice(0, 280));

  if (!url || !text) {
    return null;
  }

  return {
    url,
    status: 'resolved',
    platform: normalizeString(extraContext.platform || extraContext.sourcePlatformOverride || detectPlatform(url)),
    fetchMethod: normalizeString(extraContext.fetchMethod || 'chrome_session_bridge'),
    title,
    excerpt,
    text,
    author: normalizeString(extraContext.author),
    publishTime: normalizeString(extraContext.publishTime),
    note: normalizeString(extraContext.note)
  };
}

function mergePayloadWithExtraContext(payload, extraContext = {}, rawInput = '') {
  if (!extraContext || typeof extraContext !== 'object') {
    return payload;
  }

  const normalizedRawInput = normalizeString(rawInput);
  const existingLinks = normalizeStringArray(payload.links);
  const inferredUrl = normalizeString(extraContext.url || (normalizedRawInput.startsWith('http') ? normalizedRawInput : ''));
  const links = normalizeStringArray([...existingLinks, inferredUrl]);
  const linkExpansion = buildLinkExpansionFromExtraContext(extraContext, links[0] || inferredUrl);
  const existingMetadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata
    : {};
  const existingLinkExpansions = Array.isArray(existingMetadata.linkExpansions)
    ? existingMetadata.linkExpansions
    : [];
  const mergedLinkExpansions = linkExpansion
    ? [
      ...existingLinkExpansions.filter((item) => normalizeString(item?.url) !== linkExpansion.url),
      linkExpansion
    ]
    : existingLinkExpansions;

  const preferredContextText = normalizeString(
    extraContext.fullTextSummary
    || extraContext.fullText
    || extraContext.text
    || extraContext.body
  );
  const mergedRawText = normalizeString(
    (isUrlOnlyText(payload.rawText) ? '' : payload.rawText)
    || preferredContextText
    || normalizedRawInput
  );

  return {
    ...payload,
    rawText: mergedRawText,
    links,
    sourcePlatform: normalizeString(payload.sourcePlatform || extraContext.sourcePlatformOverride) || payload.sourcePlatform || 'hermes_orchestrator',
    sourceType: normalizeString(payload.sourceType) || 'text',
    metadata: {
      ...existingMetadata,
      originalRawText: normalizeString(existingMetadata.originalRawText || inferredUrl || normalizedRawInput || mergedRawText),
      evidenceCapturedAt: normalizeString(existingMetadata.evidenceCapturedAt || extraContext.evidenceCapturedAt) || new Date().toISOString(),
      linkExpansions: mergedLinkExpansions,
      extraContextNote: normalizeString(extraContext.note || existingMetadata.extraContextNote)
    }
  };
}

function parsePayloadInput(rawInput, extraContext = null) {
  const normalized = normalizeString(rawInput);

  if (!normalized) {
    return mergePayloadWithExtraContext({}, extraContext, rawInput);
  }

  try {
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return mergePayloadWithExtraContext(parsed, extraContext, rawInput);
    }
  } catch {
  }

  return mergePayloadWithExtraContext(buildRawTextPayload(normalized), extraContext, rawInput);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const originalDataDirEnv = process.env.HERMES_DATA_DIR;

  try {
    if (options.dataDir) {
      process.env.HERMES_DATA_DIR = options.dataDir;
    }

    const rawPayload = options.useStdin ? await readStdin() : options.rawPayload;
    const extraContext = readExtraContextFile(process.env);
    const payload = parsePayloadInput(rawPayload, extraContext);

    const { processHermesInput } = require('../hermes/orchestrator');
    const result = await processHermesInput(payload, {
      allowRemoteFetch: options.allowRemoteFetch,
      writerType: options.writerType || undefined
    });

    process.stdout.write(JSON.stringify({ success: true, data: result }, null, 2));
  } finally {
    if (options.dataDir) {
      if (originalDataDirEnv === undefined) {
        delete process.env.HERMES_DATA_DIR;
      } else {
        process.env.HERMES_DATA_DIR = originalDataDirEnv;
      }
    }
  }
}

main().catch((error) => {
  const payload = {
    success: false,
    error: {
      message: error.message,
      stack: error.stack
    }
  };

  process.stderr.write(JSON.stringify(payload, null, 2));
  process.exit(1);
});
