const crypto = require('crypto');
const {
  HERMES_ACTIONS,
  HERMES_RECORD_STATUSES,
  HERMES_TOPICS,
  TOPIC_KEYWORDS
} = require('./constants');

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeList(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

function summarizeText(value, maxLength = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function stripLinksFromText(value = '') {
  return String(value || '')
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEvidenceItems(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => {
    const text = String(item?.text || '').trim();
    const excerpt = String(item?.excerpt || '').trim();
    const title = String(item?.title || '').trim();
    const hasReadableContent = Boolean(text || excerpt || title);
    const usable = Boolean(item?.status === 'resolved' && hasReadableContent && !item?.isPartial);

    return {
      url: String(item?.url || item?.imageUrl || '').trim(),
      normalizedUrl: normalizeLinkForDedupe(item?.url || item?.imageUrl || ''),
      status: String(item?.status || '').trim(),
      platform: String(item?.platform || '').trim(),
      fetchMethod: String(item?.fetchMethod || '').trim(),
      title,
      excerpt,
      text,
      author: String(item?.author || '').trim(),
      publishTime: String(item?.publishTime || '').trim(),
      articleUrl: String(item?.articleUrl || '').trim(),
      isPartial: Boolean(item?.isPartial),
      error: String(item?.error || '').trim(),
      usable
    };
  });
}

function buildEvidencePacket(payload = {}) {
  const metadata = normalizeMetadata(payload.metadata);
  const originalRawText = String(metadata.originalRawText || payload.rawText || '').trim();
  const normalizedRawText = String(payload.rawText || '').trim();
  const links = normalizeList(payload.links);
  const images = normalizeList(payload.images);
  const linkEvidence = normalizeEvidenceItems(metadata.linkExpansions);
  const imageEvidence = normalizeEvidenceItems(metadata.imageExpansions);
  const narrativeText = stripLinksFromText(originalRawText);
  const hasNarrativeEvidence = narrativeText.length >= 40;
  const hasUsableLinkEvidence = linkEvidence.some((item) => item.usable);
  const hasUsableImageEvidence = imageEvidence.some((item) => item.usable);

  return {
    capturedAt: metadata.evidenceCapturedAt || new Date().toISOString(),
    sourcePlatform: String(payload.sourcePlatform || '').trim() || 'manual',
    sourceType: String(payload.sourceType || '').trim() || 'text',
    originalRawText,
    normalizedRawText,
    narrativeText,
    links,
    images,
    attachments: normalizeList(payload.attachments),
    linkEvidence,
    imageEvidence,
    hasNarrativeEvidence,
    hasUsableLinkEvidence,
    hasUsableImageEvidence,
    hasUsableEvidence: hasNarrativeEvidence || hasUsableLinkEvidence || hasUsableImageEvidence
  };
}

function buildWorkerAudits(agentExecution = {}, results = {}) {
  const details = agentExecution.agentDetails || {};
  const sessions = agentExecution.sessions || {};
  const contentResult = results.contentResult || {};
  const evaluationResult = results.evaluationResult || {};
  const actionResult = results.actionResult || {};

  return {
    content: {
      profile: details.content?.profile || '',
      sessionId: details.content?.sessionId || sessions.content || '',
      status: details.content?.status || 'unknown',
      summary: summarizeText([
        contentResult.title,
        contentResult.summary,
        contentResult.coreConclusion
      ].filter(Boolean).join(' | '))
    },
    evaluation: {
      profile: details.evaluation?.profile || '',
      sessionId: details.evaluation?.sessionId || sessions.evaluation || '',
      status: details.evaluation?.status || 'unknown',
      summary: summarizeText([
        Number.isFinite(Number(evaluationResult.scores?.overall)) ? `overall:${Number(evaluationResult.scores.overall)}/10` : '',
        typeof evaluationResult.worthDoing === 'boolean' ? `worthDoing:${evaluationResult.worthDoing}` : '',
        Array.isArray(evaluationResult.reasons) ? evaluationResult.reasons.join('; ') : ''
      ].filter(Boolean).join(' | '))
    },
    action: {
      profile: details.action?.profile || '',
      sessionId: details.action?.sessionId || sessions.action || '',
      status: details.action?.status || 'unknown',
      summary: summarizeText([
        actionResult.recommendedAction,
        actionResult.nextStep,
        actionResult.executionWindow
      ].filter(Boolean).join(' | '))
    }
  };
}

function normalizeLinkForDedupe(link) {
  const value = String(link || '').trim();
  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${hostname}${pathname}`.toLowerCase();
  } catch {
    return value.toLowerCase().replace(/\?.*$/, '');
  }
}

function buildHermesDedupeKey(input = {}) {
  const rawText = String(input.rawText || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const links = normalizeList(input.links).map(normalizeLinkForDedupe).sort();
  const payload = JSON.stringify({ rawText, links });
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function buildTaskEnvelope(payload = {}) {
  const links = normalizeList(payload.links);
  const images = normalizeList(payload.images);
  const attachments = normalizeList(payload.attachments);
  const providedRawText = String(payload.rawText || '').trim();
  const rawText = providedRawText || (
    images.length > 0 || attachments.length > 0
      ? `收到 ${images.length} 张图片和 ${attachments.length} 个附件。当前版本会先保留素材并进入人工复核流程，后续可继续接入 OCR 与视觉解析。`
      : ''
  );

  return {
    taskId: createId('hermes_task'),
    rawText,
    links,
    images,
    attachments,
    sourcePlatform: String(payload.sourcePlatform || 'manual').trim() || 'manual',
    sourceType: String(payload.sourceType || 'text').trim() || 'text',
    submittedAt: new Date().toISOString(),
    dedupeKey: buildHermesDedupeKey({ rawText, links }),
    evidencePacket: buildEvidencePacket({
      rawText,
      links,
      images,
      attachments,
      sourcePlatform: payload.sourcePlatform,
      sourceType: payload.sourceType,
      metadata: payload.metadata
    }),
    metadata: normalizeMetadata(payload.metadata)
  };
}

function clampScore(value) {
  return Math.max(1, Math.min(10, Math.round(Number(value) || 0)));
}

function averageScore(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 1;
  }
  const sum = values.reduce((total, value) => total + Number(value || 0), 0);
  return clampScore(sum / values.length);
}

function extractKeywords(text) {
  const source = String(text || '');
  const lowered = source.toLowerCase();
  const keywords = new Set();

  if (/\bai\b/i.test(source) || source.includes('AI')) {
    keywords.add('AI');
  }

  Object.values(TOPIC_KEYWORDS).flat().forEach((keyword) => {
    if (lowered.includes(String(keyword).toLowerCase())) {
      keywords.add(keyword === 'ai' ? 'AI' : keyword);
    }
  });

  return Array.from(keywords).slice(0, 8);
}

function detectTopic(text, keywords = []) {
  const source = `${String(text || '').toLowerCase()} ${keywords.join(' ').toLowerCase()}`;
  const ranking = Object.entries(TOPIC_KEYWORDS)
    .map(([topic, topicKeywords]) => ({
      topic,
      score: topicKeywords.reduce((count, keyword) => count + (source.includes(String(keyword).toLowerCase()) ? 1 : 0), 0)
    }))
    .sort((left, right) => right.score - left.score);

  return ranking[0] && ranking[0].score > 0 ? ranking[0].topic : 'other';
}

function buildAutoTitle(rawText, topic) {
  const trimmed = String(rawText || '').trim();
  if (trimmed) {
    return trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : trimmed;
  }

  const topicTitle = {
    sales: '销售机会线索',
    marketing: '营销增长线索',
    product: '产品洞察线索',
    ai: 'AI 自动化线索',
    content: '内容选题线索',
    operations: '运营流程线索',
    other: '待处理信息线索'
  };

  return topicTitle[topic] || topicTitle.other;
}

function buildThreeSentenceSummary(rawText, links = []) {
  const trimmed = String(rawText || '').trim();
  const firstSentence = trimmed || '输入内容以链接为主，需要后续补充上下文。';
  const secondSentence = links.length > 0
    ? `当前附带 ${links.length} 个链接，可作为后续核验来源。`
    : '当前没有附带链接，判断主要依赖原始文本。';
  const thirdSentence = 'Hermes 已将该输入转为结构化分析任务，可继续进入评估与行动决策。';

  return [firstSentence, secondSentence, thirdSentence].join(' ');
}

function buildCoreConclusion(topic, keywords = [], rawText = '') {
  const keywordText = keywords.length > 0 ? keywords.slice(0, 3).join('、') : '核心要点';
  const fallback = String(rawText || '').trim().slice(0, 30);
  const conclusionPrefix = {
    sales: '这条信息更像销售增长机会',
    marketing: '这条信息偏向营销增长策略',
    product: '这条信息偏向产品方向洞察',
    ai: '这条信息聚焦 AI 自动化机会',
    content: '这条信息适合作为内容选题素材',
    operations: '这条信息更适合沉淀为运营流程优化',
    other: '这条信息具备进一步分析价值'
  };

  return `${conclusionPrefix[topic] || conclusionPrefix.other}，目前提炼出的关键词是 ${keywordText}${fallback ? `，原文重点为“${fallback}”` : ''}。`;
}

function normalizeHermesRecord(record = {}) {
  const recommendedAction = HERMES_ACTIONS.includes(record.recommendedAction) ? record.recommendedAction : '仅归档';
  const status = HERMES_RECORD_STATUSES.includes(record.status) ? record.status : 'new';
  const topic = HERMES_TOPICS.includes(record.topic) ? record.topic : 'other';
  const createdAt = record.createdAt || new Date().toISOString();

  return {
    id: record.id || createId('hermes_record'),
    taskId: record.taskId || createId('hermes_task'),
    title: String(record.title || '').trim(),
    summary: String(record.summary || '').trim(),
    keywords: normalizeList(record.keywords),
    topic,
    coreConclusion: String(record.coreConclusion || '').trim(),
    scores: {
      interestFit: clampScore(record.scores?.interestFit || 1),
      actionability: clampScore(record.scores?.actionability || 1),
      potentialReturn: clampScore(record.scores?.potentialReturn || 1),
      timeliness: clampScore(record.scores?.timeliness || 1),
      uniqueness: clampScore(record.scores?.uniqueness || 1),
      overall: clampScore(record.scores?.overall || 1)
    },
    worthDoing: Boolean(record.worthDoing),
    recommendedAction,
    nextStep: String(record.nextStep || '').trim(),
    executionWindow: String(record.executionWindow || 'someday').trim() || 'someday',
    reasons: normalizeList(record.reasons),
    status,
    sourcePlatform: String(record.sourcePlatform || 'manual').trim() || 'manual',
    sourceType: String(record.sourceType || 'text').trim() || 'text',
    rawText: String(record.rawText || '').trim(),
    links: normalizeList(record.links),
    images: normalizeList(record.images),
    attachments: normalizeList(record.attachments),
    dedupeKey: String(record.dedupeKey || '').trim(),
    dedupe: {
      isDuplicateCandidate: Boolean(record.dedupe?.isDuplicateCandidate),
      matchedRecordId: record.dedupe?.matchedRecordId || null
    },
    metadata: normalizeMetadata(record.metadata),
    createdAt,
    updatedAt: record.updatedAt || createdAt
  };
}

function normalizeHermesRecordsData(data = {}) {
  const records = Array.isArray(data.records) ? data.records.map((record) => normalizeHermesRecord(record)) : [];

  return {
    version: data.version || '1.0.0',
    lastUpdated: data.lastUpdated || new Date().toISOString(),
    records,
    metadata: {
      total: records.length,
      byAction: records.reduce((accumulator, record) => {
        accumulator[record.recommendedAction] = (accumulator[record.recommendedAction] || 0) + 1;
        return accumulator;
      }, {}),
      byStatus: records.reduce((accumulator, record) => {
        accumulator[record.status] = (accumulator[record.status] || 0) + 1;
        return accumulator;
      }, {}),
      duplicateCandidates: records.filter((record) => record.dedupe?.isDuplicateCandidate).length
    }
  };
}

function buildFinalRecord({
  taskEnvelope,
  contentResult,
  evaluationResult,
  actionResult,
  duplicateCandidate
}) {
  const agentExecution = taskEnvelope.metadata?.agentExecution || {};
  const workerAudits = buildWorkerAudits(agentExecution, {
    contentResult,
    evaluationResult,
    actionResult
  });

  return normalizeHermesRecord({
    id: createId('hermes_record'),
    taskId: taskEnvelope.taskId,
    title: contentResult.title,
    summary: contentResult.summary,
    keywords: contentResult.keywords,
    topic: contentResult.topic,
    coreConclusion: contentResult.coreConclusion,
    scores: evaluationResult.scores,
    worthDoing: evaluationResult.worthDoing,
    recommendedAction: actionResult.recommendedAction,
    nextStep: actionResult.nextStep,
    executionWindow: actionResult.executionWindow,
    reasons: [...evaluationResult.reasons, ...(actionResult.reasons || [])],
    status: actionResult.status || 'new',
    sourcePlatform: taskEnvelope.sourcePlatform,
    sourceType: taskEnvelope.sourceType,
    rawText: taskEnvelope.rawText,
    links: taskEnvelope.links,
    images: taskEnvelope.images,
    attachments: taskEnvelope.attachments,
    dedupeKey: taskEnvelope.dedupeKey,
    dedupe: {
      isDuplicateCandidate: Boolean(duplicateCandidate),
      matchedRecordId: duplicateCandidate?.id || null
    },
    metadata: {
      ...taskEnvelope.metadata,
      evidencePacket: taskEnvelope.evidencePacket || taskEnvelope.metadata?.evidencePacket || null,
      workerAudits
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

function matchesRecordFilters(record, filters = {}) {
  if (filters.recommendedAction && record.recommendedAction !== filters.recommendedAction) {
    return false;
  }
  if (filters.status && record.status !== filters.status) {
    return false;
  }
  if (filters.topic && record.topic !== filters.topic) {
    return false;
  }
  if (filters.sourcePlatform && record.sourcePlatform !== filters.sourcePlatform) {
    return false;
  }
  return true;
}

module.exports = {
  createId,
  normalizeList,
  normalizeMetadata,
  summarizeText,
  stripLinksFromText,
  normalizeLinkForDedupe,
  buildHermesDedupeKey,
  buildEvidencePacket,
  buildWorkerAudits,
  buildTaskEnvelope,
  clampScore,
  averageScore,
  extractKeywords,
  detectTopic,
  buildAutoTitle,
  buildThreeSentenceSummary,
  buildCoreConclusion,
  normalizeHermesRecord,
  normalizeHermesRecordsData,
  buildFinalRecord,
  matchesRecordFilters
};
