const {
  extractKeywords,
  detectTopic,
  buildAutoTitle,
  buildCoreConclusion
} = require('../library');

function buildContentSummary(taskEnvelope, linkExpansions) {
  const originalText = String(taskEnvelope.metadata?.originalRawText || taskEnvelope.rawText || '').trim();
  const resolvedExpansions = (Array.isArray(linkExpansions) ? linkExpansions : []).filter((item) => item.status === 'resolved');
  const resolvedImageExpansions = (Array.isArray(taskEnvelope.metadata?.imageExpansions) ? taskEnvelope.metadata.imageExpansions : [])
    .filter((item) => item.status === 'resolved');
  const firstExpansion = resolvedExpansions[0];
  const firstImageExpansion = resolvedImageExpansions[0];

  const firstSentence = originalText || firstExpansion?.title || '输入内容以链接为主，需要后续补充上下文。';
  const secondSentence = firstExpansion?.excerpt
    ? `外部来源的核心信息是：${firstExpansion.excerpt.slice(0, 120)}`
    : firstImageExpansion?.excerpt
      ? `图片 OCR 识别出的核心信息是：${firstImageExpansion.excerpt.slice(0, 120)}`
      : taskEnvelope.links.length > 0
        ? `当前附带 ${taskEnvelope.links.length} 个链接，可作为后续核验来源。`
        : '当前没有附带链接，判断主要依赖原始文本。';
  const thirdSentence = resolvedExpansions.length > 1
    ? `系统还补充解析了 ${resolvedExpansions.length - 1} 条相关来源，便于后续统一评估。`
    : resolvedImageExpansions.length > 0
      ? `系统还额外完成了 ${resolvedImageExpansions.length} 张图片的 OCR 识别，可继续人工复核。`
      : 'Hermes 已将该输入转为结构化分析任务，可继续进入评估与行动决策。';

  return [firstSentence, secondSentence, thirdSentence].join(' ');
}

function analyzeContent(taskEnvelope) {
  const text = [taskEnvelope.rawText, ...taskEnvelope.links].filter(Boolean).join(' ');
  const keywords = extractKeywords(text);
  const topic = detectTopic(text, keywords);
  const linkExpansions = taskEnvelope.metadata?.linkExpansions || [];
  const imageExpansions = taskEnvelope.metadata?.imageExpansions || [];
  const preferredTitle = linkExpansions.find((item) => item.status === 'resolved' && item.title)?.title
    || imageExpansions.find((item) => item.status === 'resolved' && item.excerpt)?.excerpt
    || '';

  return {
    title: preferredTitle || buildAutoTitle(taskEnvelope.metadata?.originalRawText || taskEnvelope.rawText, topic),
    summary: buildContentSummary(taskEnvelope, linkExpansions),
    keywords,
    topic,
    coreConclusion: buildCoreConclusion(topic, keywords, taskEnvelope.metadata?.originalRawText || taskEnvelope.rawText)
  };
}

module.exports = { analyzeContent };
