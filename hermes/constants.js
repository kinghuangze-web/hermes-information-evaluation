const HERMES_ACTIONS = ['立即跟进', '本周处理', '进入选题池', '继续观察', '仅归档'];
const HERMES_RECORD_STATUSES = ['new', 'reviewed', 'acted', 'archived', 'duplicate_candidate'];
const HERMES_TOPICS = ['sales', 'marketing', 'product', 'ai', 'content', 'operations', 'other'];

const TOPIC_KEYWORDS = {
  sales: ['销售', '线索', '转化', '客户', '成交', '获客', 'crm', 'pipeline'],
  marketing: ['营销', '增长', '投放', '品牌', '流量', 'campaign'],
  product: ['产品', '需求', '功能', '迭代', '体验', 'roadmap', '同步', '知识库', 'obsidian'],
  ai: ['ai', '模型', 'agent', '自动化', '智能体', 'llm', 'skill', '联网', '工作流'],
  content: ['内容', '选题', '文章', '视频', '公众号', '小红书', '推文', '文档', '开源'],
  operations: ['运营', '流程', '效率', '协同', 'sop', '系统', 'github', '集成', '飞书']
};

const INTEREST_KEYWORDS = ['ai', 'agent', '自动化', '销售', '增长', '内容', '产品', '工作流', '飞书', 'skill', 'github', 'obsidian'];
const ACTIONABILITY_KEYWORDS = ['步骤', '方法', '清单', '模板', '打法', '流程', '行动', '执行', '跟进', '策略', '安装', '配置', '接入', '同步'];
const RETURN_KEYWORDS = ['销售', '增长', '转化', '回报', '收入', '客户', '机会', 'roi', '线索', '自动化', '效率', '工作流', '同步', '开源'];
const TIMELINESS_KEYWORDS = ['本周', '今天', '立即', '最近', '趋势', '现在', '窗口', '及时', '刚开源', '新'];
const UNIQUENESS_KEYWORDS = ['独家', '首次', '新', '创新', '独特', '稀缺', '开源', '零成本', '2.8k', '首发'];

module.exports = {
  HERMES_ACTIONS,
  HERMES_RECORD_STATUSES,
  HERMES_TOPICS,
  TOPIC_KEYWORDS,
  INTEREST_KEYWORDS,
  ACTIONABILITY_KEYWORDS,
  RETURN_KEYWORDS,
  TIMELINESS_KEYWORDS,
  UNIQUENESS_KEYWORDS
};
