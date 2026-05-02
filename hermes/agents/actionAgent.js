function recommendAction({ evaluationResult, duplicateCandidate }) {
  if (duplicateCandidate) {
    return {
      recommendedAction: '继续观察',
      nextStep: `先核对已有记录 ${duplicateCandidate.id}，确认是否需要合并信息。`,
      executionWindow: 'before-processing',
      status: 'duplicate_candidate',
      reasons: ['命中重复候选，需要先避免重复处理。']
    };
  }

  const { overall, interestFit, actionability, timeliness } = evaluationResult.scores;

  if (overall >= 8) {
    return {
      recommendedAction: '立即跟进',
      nextStep: '提炼 3 个最关键动作，并在今天内安排第一步执行。',
      executionWindow: 'today',
      status: 'new',
      reasons: ['综合优先级高，值得快速投入。']
    };
  }

  if (overall >= 7) {
    return {
      recommendedAction: '本周处理',
      nextStep: '本周内拆成行动清单，确认负责人和触发时点。',
      executionWindow: 'this_week',
      status: 'new',
      reasons: ['综合优先级较高，适合纳入本周安排。']
    };
  }

  if (interestFit >= 7 && actionability <= 5) {
    return {
      recommendedAction: '进入选题池',
      nextStep: '保留核心洞察，等条件成熟后再转为具体动作。',
      executionWindow: 'backlog',
      status: 'new',
      reasons: ['方向感强，但目前还不够容易立刻执行。']
    };
  }

  if (timeliness >= 7) {
    return {
      recommendedAction: '继续观察',
      nextStep: '补充更多上下文后再次评估，避免错过时效窗口。',
      executionWindow: 'monitor',
      status: 'new',
      reasons: ['时效性较强，但信息还不够确定。']
    };
  }

  return {
    recommendedAction: '仅归档',
    nextStep: '先归档沉淀，后续按主题回看是否值得再次激活。',
    executionWindow: 'archive',
    status: 'archived',
    reasons: ['当前优先级有限，先保留记录即可。']
  };
}

module.exports = { recommendAction };
