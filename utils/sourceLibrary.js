function detectPlatform(url = '') {
  const value = String(url || '').trim();

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

function normalizeProjectId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeTextForFingerprint(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
    .replace(/\s+/g, ' ');
}

function buildSourceDedupeKey(item = {}) {
  const normalizedUrl = normalizeTextForFingerprint(item.url || '');
  if (normalizedUrl) {
    return `url:${normalizedUrl}`;
  }

  const normalizedTitle = normalizeTextForFingerprint(item.title || '');
  const normalizedIntro = normalizeTextForFingerprint(item.intro || '');
  const fallback = [normalizedTitle, normalizedIntro].filter(Boolean).join('|');

  return fallback ? `text:${fallback}` : `generated:${Date.now()}`;
}

function resolveSourcePlatform(item = {}, options = {}) {
  const url = typeof item.url === 'string' ? item.url.trim() : '';
  const providedPlatform = typeof item.platform === 'string' ? item.platform.trim() : '';
  const detectedPlatform = detectPlatform(url);

  if ((options.preferProvidedPlatform || item.platformOverride) && providedPlatform) {
    return providedPlatform;
  }

  if (url && detectedPlatform && detectedPlatform !== 'chat') {
    return detectedPlatform;
  }

  return providedPlatform || detectedPlatform;
}

function normalizeSourceEntry(item = {}, options = {}) {
  const now = new Date().toISOString();
  const url = typeof item.url === 'string' ? item.url.trim() : '';
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const intro = typeof item.intro === 'string' ? item.intro.trim() : '';
  const notes = typeof item.notes === 'string' ? item.notes.trim() : '';
  const platform = resolveSourcePlatform({ ...item, url }, options);
  const status = item.status || (intro ? 'OK' : 'NEEDS_INPUT');
  const projectId = normalizeProjectId(item.projectId);
  const hasHermesOverallScore = item.hermesOverallScore !== null && item.hermesOverallScore !== undefined && item.hermesOverallScore !== '';

  return {
    id: item.id,
    platform,
    url: url || null,
    title: title.slice(0, 200),
    intro: intro.slice(0, 800),
    notes: notes.slice(0, 800),
    status,
    source: item.source || 'manual',
    projectId,
    platformOverride: Boolean(options.preferProvidedPlatform || item.platformOverride),
    hermesRecordId: typeof item.hermesRecordId === 'string' ? item.hermesRecordId.trim() || null : null,
    hermesTaskId: typeof item.hermesTaskId === 'string' ? item.hermesTaskId.trim() || null : null,
    hermesRunId: typeof item.hermesRunId === 'string' ? item.hermesRunId.trim() || null : null,
    hermesRecommendedAction: typeof item.hermesRecommendedAction === 'string' ? item.hermesRecommendedAction.trim() || null : null,
    hermesWorthDoing: typeof item.hermesWorthDoing === 'boolean' ? item.hermesWorthDoing : null,
    hermesOverallScore: hasHermesOverallScore && Number.isFinite(Number(item.hermesOverallScore)) ? Number(item.hermesOverallScore) : null,
    hermesExecutionMode: typeof item.hermesExecutionMode === 'string' ? item.hermesExecutionMode.trim() || null : null,
    hermesRealProfilesExecution: typeof item.hermesRealProfilesExecution === 'boolean' ? item.hermesRealProfilesExecution : null,
    hermesWorkerSessions: typeof item.hermesWorkerSessions === 'string' ? item.hermesWorkerSessions.trim() || null : null,
    hermesContentSummary: typeof item.hermesContentSummary === 'string' ? item.hermesContentSummary.trim() || null : null,
    hermesEvaluationSummary: typeof item.hermesEvaluationSummary === 'string' ? item.hermesEvaluationSummary.trim() || null : null,
    hermesActionSummary: typeof item.hermesActionSummary === 'string' ? item.hermesActionSummary.trim() || null : null,
    dedupeKey: item.dedupeKey || buildSourceDedupeKey({ url, title, intro }),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || item.createdAt || now
  };
}

function normalizeSourcesData(data = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  const normalizedItems = items.map((item) => normalizeSourceEntry(item));
  const byPlatform = normalizedItems.reduce((accumulator, item) => {
    accumulator[item.platform] = (accumulator[item.platform] || 0) + 1;
    return accumulator;
  }, {});

  return {
    version: data.version || '1.0.0',
    lastUpdated: data.lastUpdated || new Date().toISOString(),
    items: normalizedItems,
    metadata: {
      total: normalizedItems.length,
      byPlatform
    }
  };
}

function pickFirstReadable(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function pickFirstNonNull(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }

  return null;
}

function mergeSourceEntries(keeper = {}, duplicates = []) {
  const duplicateList = Array.isArray(duplicates) ? duplicates : [];
  const merged = duplicateList.reduce((accumulator, item) => ({
    ...accumulator,
    platform: accumulator.platform === 'chat' ? (item.platform || accumulator.platform) : accumulator.platform,
    url: pickFirstNonNull(accumulator.url, item.url),
    title: pickFirstReadable(accumulator.title, item.title),
    intro: pickFirstReadable(accumulator.intro, item.intro),
    notes: pickFirstReadable(accumulator.notes, item.notes),
    status: accumulator.status === 'OK' || item.status === 'OK'
      ? 'OK'
      : (accumulator.status || item.status || 'NEEDS_INPUT'),
    source: accumulator.source || item.source || 'manual',
    projectId: pickFirstNonNull(accumulator.projectId, item.projectId),
    hermesRecordId: pickFirstNonNull(item.hermesRecordId, accumulator.hermesRecordId),
    hermesTaskId: pickFirstNonNull(item.hermesTaskId, accumulator.hermesTaskId),
    hermesRunId: pickFirstNonNull(item.hermesRunId, accumulator.hermesRunId),
    hermesRecommendedAction: pickFirstNonNull(item.hermesRecommendedAction, accumulator.hermesRecommendedAction),
    hermesWorthDoing: pickFirstNonNull(item.hermesWorthDoing, accumulator.hermesWorthDoing),
    hermesOverallScore: pickFirstNonNull(item.hermesOverallScore, accumulator.hermesOverallScore),
    hermesExecutionMode: pickFirstNonNull(item.hermesExecutionMode, accumulator.hermesExecutionMode),
    hermesRealProfilesExecution: pickFirstNonNull(item.hermesRealProfilesExecution, accumulator.hermesRealProfilesExecution),
    hermesWorkerSessions: pickFirstNonNull(item.hermesWorkerSessions, accumulator.hermesWorkerSessions),
    hermesContentSummary: pickFirstNonNull(item.hermesContentSummary, accumulator.hermesContentSummary),
    hermesEvaluationSummary: pickFirstNonNull(item.hermesEvaluationSummary, accumulator.hermesEvaluationSummary),
    hermesActionSummary: pickFirstNonNull(item.hermesActionSummary, accumulator.hermesActionSummary),
    dedupeKey: accumulator.dedupeKey || item.dedupeKey,
    createdAt: accumulator.createdAt && item.createdAt
      ? (new Date(accumulator.createdAt) <= new Date(item.createdAt) ? accumulator.createdAt : item.createdAt)
      : (accumulator.createdAt || item.createdAt),
    updatedAt: accumulator.updatedAt && item.updatedAt
      ? (new Date(accumulator.updatedAt) >= new Date(item.updatedAt) ? accumulator.updatedAt : item.updatedAt)
      : (accumulator.updatedAt || item.updatedAt)
  }), { ...keeper });

  return normalizeSourceEntry({
    ...merged,
    id: keeper.id,
    updatedAt: new Date().toISOString()
  });
}

module.exports = {
  detectPlatform,
  normalizeProjectId,
  normalizeTextForFingerprint,
  buildSourceDedupeKey,
  resolveSourcePlatform,
  mergeSourceEntries,
  normalizeSourceEntry,
  normalizeSourcesData
};
