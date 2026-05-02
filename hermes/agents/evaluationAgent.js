const {
  INTEREST_KEYWORDS,
  ACTIONABILITY_KEYWORDS,
  RETURN_KEYWORDS,
  TIMELINESS_KEYWORDS,
  UNIQUENESS_KEYWORDS
} = require('../constants');
const { clampScore, averageScore } = require('../library');

function countMatches(text, keywords) {
  const lowered = String(text || '').toLowerCase();
  return keywords.reduce((count, keyword) => count + (lowered.includes(String(keyword).toLowerCase()) ? 1 : 0), 0);
}

function buildEvaluationReasons(scores, topic) {
  const reasons = [];

  if (scores.interestFit >= 7) {
    reasons.push('主题与当前关注方向较匹配');
  }
  if (scores.actionability >= 7) {
    reasons.push('内容具备较强可执行性');
  }
  if (scores.potentialReturn >= 7) {
    reasons.push('这条信息可能带来较高回报');
  }
  if (scores.timeliness >= 7) {
    reasons.push('存在一定时效窗口');
  }
  if (scores.uniqueness >= 7) {
    reasons.push('具备一定独特性');
  }
  if (reasons.length === 0) {
    reasons.push(`该信息已归入 ${topic} 主题，建议先保留观察。`);
  }

  return reasons;
}

function evaluateValue(taskEnvelope, contentResult) {
  const text = `${taskEnvelope.rawText} ${contentResult.summary} ${contentResult.keywords.join(' ')}`;

  const interestFit = clampScore(4 + countMatches(text, INTEREST_KEYWORDS) * 2);
  const actionability = clampScore(3 + countMatches(text, ACTIONABILITY_KEYWORDS) * 2 + (taskEnvelope.links.length > 0 ? 1 : 0));
  const potentialReturn = clampScore(3 + countMatches(text, RETURN_KEYWORDS) * 2);
  const timeliness = clampScore(3 + countMatches(text, TIMELINESS_KEYWORDS) * 2);
  const uniqueness = clampScore(4 + countMatches(text, UNIQUENESS_KEYWORDS) * 2 + (taskEnvelope.links.length > 0 ? 1 : 0));

  const scores = {
    interestFit,
    actionability,
    potentialReturn,
    timeliness,
    uniqueness
  };
  const overall = averageScore(Object.values(scores));

  return {
    scores: {
      ...scores,
      overall
    },
    worthDoing: overall >= 7,
    reasons: buildEvaluationReasons({ ...scores, overall }, contentResult.topic)
  };
}

module.exports = { evaluateValue };
