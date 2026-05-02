function normalizeWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripLinksFromText(rawText = '', links = []) {
  let text = String(rawText || '');

  for (const link of Array.isArray(links) ? links : []) {
    if (!link) {
      continue;
    }
    text = text.split(String(link)).join(' ');
  }

  text = text.replace(/https?:\/\/[^\s]+/gi, ' ');
  return normalizeWhitespace(text);
}

function normalizePriority(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return 'medium';
  }

  if (['高', 'high', 'p1'].includes(text)) {
    return 'high';
  }

  if (['低', 'low', 'p3'].includes(text)) {
    return 'low';
  }

  return 'medium';
}

function parseLabeledLines(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function escapeLabel(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractField(lines = [], labels = []) {
  for (const line of lines) {
    for (const label of labels) {
      const regex = new RegExp(`^${escapeLabel(label)}\\s*[:：]\\s*(.+)$`, 'i');
      const match = line.match(regex);
      if (match) {
        return match[1].trim();
      }
    }
  }

  return '';
}

function detectInboxIntent(rawText = '') {
  const text = String(rawText || '').trim();
  const match = text.match(/^(?:灵感|想法|idea|记录灵感)\s*[:：]\s*([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const content = match[1].trim();
  if (!content) {
    return null;
  }

  return {
    kind: 'workspace_directive',
    action: 'create_inbox',
    payload: {
      content
    }
  };
}

function detectProjectIntent(rawText = '') {
  const text = String(rawText || '').trim();
  const match = text.match(/^(?:创建项目|新建项目)\s*[:：]\s*([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const body = match[1].trim();
  const lines = parseLabeledLines(body);
  const name = extractField(lines, ['项目', '名称']) || lines[0] || '';
  if (!name) {
    return null;
  }

  const description = extractField(lines, ['描述', '说明']) || lines.slice(1).join('\n');
  const tags = (extractField(lines, ['标签', 'tags']) || '')
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const priority = normalizePriority(extractField(lines, ['优先级', 'priority']));

  return {
    kind: 'workspace_directive',
    action: 'create_project',
    payload: {
      name,
      description,
      tags,
      priority
    }
  };
}

function detectTaskIntent(rawText = '') {
  const text = String(rawText || '').trim();
  const match = text.match(/^(?:添加任务|新建任务|创建任务|待办)\s*[:：]\s*([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const body = match[1].trim();
  const lines = parseLabeledLines(body);
  const title = extractField(lines, ['任务', '标题']) || lines[0] || '';
  const project = extractField(lines, ['项目', 'project']);
  if (!title || !project) {
    return null;
  }

  return {
    kind: 'workspace_directive',
    action: 'create_task',
    payload: {
      project,
      title,
      description: extractField(lines, ['描述', '说明']),
      priority: normalizePriority(extractField(lines, ['优先级', 'priority'])),
      dueDate: extractField(lines, ['截止', 'due', '日期']) || null
    }
  };
}

function detectCaptureSourceIntent(taskEnvelope = {}) {
  const links = Array.isArray(taskEnvelope.links) ? taskEnvelope.links.filter(Boolean) : [];
  if (links.length === 0) {
    return null;
  }

  const meaningfulText = stripLinksFromText(taskEnvelope.rawText, links);
  if (!meaningfulText) {
    return {
      kind: 'capture_source',
      action: 'capture_source',
      payload: {
        onlyLinks: true
      }
    };
  }

  return null;
}

function detectIntakeIntent(taskEnvelope = {}) {
  const rawText = String(taskEnvelope.rawText || '').trim();

  return (
    detectInboxIntent(rawText)
    || detectProjectIntent(rawText)
    || detectTaskIntent(rawText)
    || detectCaptureSourceIntent(taskEnvelope)
    || {
      kind: 'analysis',
      action: 'analyze',
      payload: {}
    }
  );
}

module.exports = {
  detectIntakeIntent,
  normalizePriority,
  stripLinksFromText
};
