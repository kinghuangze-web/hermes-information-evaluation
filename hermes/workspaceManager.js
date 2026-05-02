const fileManager = require('../utils/fileManager');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');
const { createId } = require('./library');

function truncate(value = '', maxLength = 2000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.map((tag) => truncate(tag, 40)).filter(Boolean))];
}

function normalizePriority(priority = 'medium') {
  return ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';
}

function normalizeDueDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).trim() || null;
  }

  return date.toISOString();
}

function buildHermesLinkage(context = {}) {
  return {
    hermesRecordId: context.hermesRecordId || null,
    hermesRunId: context.hermesRunId || null
  };
}

function projectMatchesReference(project = {}, reference = '') {
  const normalizedReference = String(reference || '').trim().toLowerCase();
  if (!normalizedReference) {
    return false;
  }

  return [project.id, project.name]
    .filter(Boolean)
    .some((value) => String(value).trim().toLowerCase() === normalizedReference);
}

async function createInboxItem(payload = {}, context = {}) {
  const content = truncate(payload.content, 2000);
  if (!content) {
    throw new ValidationError('灵感内容不能为空');
  }

  const data = await fileManager.read('inbox');
  const now = new Date().toISOString();
  const newItem = {
    id: createId('idea'),
    content,
    source: 'hermes',
    tags: normalizeTags(payload.tags),
    status: 'new',
    relatedProject: payload.relatedProject ?? null,
    aiExpanded: false,
    aiAnalysis: null,
    ...buildHermesLinkage(context),
    createdAt: now,
    processedAt: null
  };

  data.items = Array.isArray(data.items) ? data.items : [];
  data.items.unshift(newItem);
  await fileManager.write('inbox', data);

  return {
    action: 'create_inbox',
    entityType: 'inbox',
    entityId: newItem.id,
    entity: newItem,
    title: `灵感录入：${content.slice(0, 30)}`,
    summary: '已将该内容录入灵感库，等待后续整理或转项目。',
    feedback: `已录入灵感库：${content.slice(0, 60)}`
  };
}

async function createProject(payload = {}, context = {}) {
  const name = truncate(payload.name, 100);
  if (!name) {
    throw new ValidationError('项目名称不能为空');
  }

  const data = await fileManager.read('projects');
  const now = new Date().toISOString();
  const newProject = {
    id: createId('proj'),
    name,
    description: truncate(payload.description, 500),
    status: 'active',
    tags: normalizeTags(payload.tags),
    priority: normalizePriority(payload.priority),
    progress: 0,
    tasks: [],
    notes: truncate(payload.notes, 1200),
    ...buildHermesLinkage(context),
    createdAt: now,
    updatedAt: now
  };

  data.projects = Array.isArray(data.projects) ? data.projects : [];
  data.projects.unshift(newProject);
  await fileManager.write('projects', data);

  return {
    action: 'create_project',
    entityType: 'project',
    entityId: newProject.id,
    entity: newProject,
    title: `项目创建：${newProject.name}`,
    summary: `已在工作区创建项目「${newProject.name}」，后续可以继续挂任务和来源。`,
    feedback: `已创建项目：${newProject.name}`
  };
}

async function createTask(payload = {}, context = {}) {
  const title = truncate(payload.title, 200);
  if (!title) {
    throw new ValidationError('任务标题不能为空');
  }

  const projectReference = String(payload.project || '').trim();
  if (!projectReference) {
    throw new ValidationError('创建任务时必须指定项目');
  }

  const data = await fileManager.read('projects');
  data.projects = Array.isArray(data.projects) ? data.projects : [];
  const projectIndex = data.projects.findIndex((project) => projectMatchesReference(project, projectReference));
  if (projectIndex === -1) {
    throw new NotFoundError(`未找到项目: ${projectReference}`);
  }

  const now = new Date().toISOString();
  const newTask = {
    id: createId('task'),
    title,
    description: truncate(payload.description, 500),
    status: 'todo',
    priority: normalizePriority(payload.priority),
    dueDate: normalizeDueDate(payload.dueDate),
    completedAt: null,
    ...buildHermesLinkage(context),
    createdAt: now
  };

  data.projects[projectIndex].tasks = Array.isArray(data.projects[projectIndex].tasks)
    ? data.projects[projectIndex].tasks
    : [];
  data.projects[projectIndex].tasks.unshift(newTask);
  data.projects[projectIndex].updatedAt = now;

  await fileManager.write('projects', data);

  return {
    action: 'create_task',
    entityType: 'task',
    entityId: newTask.id,
    entity: newTask,
    projectId: data.projects[projectIndex].id,
    projectName: data.projects[projectIndex].name,
    title: `任务创建：${title}`,
    summary: `已在项目「${data.projects[projectIndex].name}」下创建任务。`,
    feedback: `已在项目「${data.projects[projectIndex].name}」下创建任务：${title}`
  };
}

async function executeWorkspaceDirective(intent = {}, context = {}) {
  if (intent.action === 'create_inbox') {
    return createInboxItem(intent.payload, context);
  }

  if (intent.action === 'create_project') {
    return createProject(intent.payload, context);
  }

  if (intent.action === 'create_task') {
    return createTask(intent.payload, context);
  }

  throw new ValidationError(`Unsupported workspace directive: ${intent.action || 'unknown'}`);
}

module.exports = {
  executeWorkspaceDirective
};
