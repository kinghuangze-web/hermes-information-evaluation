const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../middleware/logger');
const { normalizeSourcesData } = require('./sourceLibrary');
const { getDataDir } = require('./storagePaths');

const DATA_FILES = {
  projects: 'projects.json',
  inbox: 'inbox.json',
  config: 'config.json',
  archive: 'archive.json',
  sprints: 'sprints.json',
  sources: 'sources.json',
  hermesRecords: 'hermesRecords.json',
  hermesRunTraces: 'hermesRunTraces.json'
};

const AUTO_SNAPSHOT_RETENTION = Math.max(5, Number(process.env.DATA_SNAPSHOT_RETENTION || 30));

class FileManager {
  constructor() {
    this.initDataDir();
  }

  getDataDir() {
    return getDataDir();
  }

  initDataDir() {
    const dataDir = this.getDataDir();
    fs.ensureDirSync(dataDir);
    Object.values(DATA_FILES).forEach((file) => {
      const filePath = path.join(dataDir, file);
      if (!fs.existsSync(filePath) || this.isFileEmpty(filePath)) {
        this.initFile(file, this.getDefaultData(file));
      }
    });
  }

  isFileEmpty(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return !content || content.trim() === '' || content.trim() === '{}';
    } catch {
      return true;
    }
  }

  getDefaultData(file) {
    const defaults = {
      projects: {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        projects: [],
        metadata: { totalProjects: 0, activeProjects: 0, completedProjects: 0 }
      },
      inbox: {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        items: [],
        settings: { autoExpire: 30, maxItems: 100 }
      },
      config: {
        version: '1.0.0',
        user: { name: 'Hermes User', timezone: 'UTC' },
        ui: { theme: 'light', language: 'en', paperTexture: true },
        automation: { enabled: true },
        backup: { enabled: true, interval: 'daily' },
        notifications: { taskDue: true, projectUpdate: true }
      },
      archive: { version: '1.0.0', lastUpdated: new Date().toISOString(), archivedProjects: [] },
      sprints: {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        sprints: [],
        metadata: { totalSprints: 0, activeSprints: 0, planningSprints: 0, completedSprints: 0 }
      },
      sources: {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        items: [],
        metadata: { total: 0, byPlatform: {} }
      },
      hermesRecords: {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        records: [],
        metadata: { total: 0, byAction: {}, byStatus: {}, duplicateCandidates: 0 }
      },
      hermesRunTraces: {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        runs: [],
        metadata: { total: 0, byExecutionMode: {}, byStatus: {}, byFailedNode: {} }
      }
    };
    return defaults[file] || {};
  }

  normalizeTask(task = {}) {
    const normalizedTask = {
      id: task.id,
      title: task.title || '',
      description: task.description || '',
      status: task.status || 'todo',
      priority: task.priority || 'medium',
      dueDate: task.dueDate || null,
      completedAt: task.completedAt || null,
      hermesRecordId: task.hermesRecordId || null,
      hermesRunId: task.hermesRunId || null,
      createdAt: task.createdAt || new Date().toISOString()
    };

    if (normalizedTask.status !== 'done') {
      normalizedTask.completedAt = null;
    }

    if (normalizedTask.status === 'done' && !normalizedTask.completedAt) {
      normalizedTask.completedAt = new Date().toISOString();
    }

    return normalizedTask;
  }

  normalizeProjectData(data = {}) {
    const projects = (Array.isArray(data.projects) ? data.projects : []).map((project) => {
      const tasks = (project.tasks || []).map((task) => this.normalizeTask(task));
      const completedTasks = tasks.filter((task) => task.status === 'done').length;
      const totalTasks = tasks.length;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : (project.progress || 0);

      return {
        id: project.id,
        name: project.name || '',
        description: project.description || '',
        status: project.status || 'active',
        tags: Array.isArray(project.tags) ? project.tags : [],
        priority: project.priority || 'medium',
        progress,
        tasks,
        notes: project.notes || '',
        hermesRecordId: project.hermesRecordId || null,
        hermesRunId: project.hermesRunId || null,
        createdAt: project.createdAt || new Date().toISOString(),
        updatedAt: project.updatedAt || new Date().toISOString()
      };
    });

    return {
      version: data.version || '1.0.0',
      lastUpdated: data.lastUpdated || new Date().toISOString(),
      projects,
      metadata: {
        totalProjects: projects.length,
        activeProjects: projects.filter((project) => project.status === 'active').length,
        completedProjects: projects.filter((project) => project.status === 'completed').length
      }
    };
  }

  normalizeInboxData(data = {}) {
    const items = (Array.isArray(data.items) ? data.items : []).map((item) => ({
      id: item.id,
      content: item.content || '',
      source: item.source || 'manual',
      tags: Array.isArray(item.tags) ? item.tags : [],
      status: item.status || 'new',
      relatedProject: item.relatedProject ?? null,
      aiExpanded: Boolean(item.aiExpanded),
      aiAnalysis: item.aiAnalysis ?? null,
      hermesRecordId: item.hermesRecordId || null,
      hermesRunId: item.hermesRunId || null,
      createdAt: item.createdAt || new Date().toISOString(),
      processedAt: item.processedAt ?? null
    }));

    return {
      version: data.version || '1.0.0',
      lastUpdated: data.lastUpdated || new Date().toISOString(),
      items,
      settings: {
        autoExpire: data.settings?.autoExpire || 30,
        maxItems: data.settings?.maxItems || 100
      }
    };
  }

  normalizeConfigData(data = {}) {
    const defaults = this.getDefaultData('config');
    return {
      ...defaults,
      ...data,
      user: { ...defaults.user, ...(data.user || {}) },
      ui: { ...defaults.ui, ...(data.ui || {}) },
      automation: { ...defaults.automation, ...(data.automation || {}) },
      backup: { ...defaults.backup, ...(data.backup || {}) },
      notifications: { ...defaults.notifications, ...(data.notifications || {}) }
    };
  }

  normalizeArchiveData(data = {}) {
    return {
      version: data.version || '1.0.0',
      lastUpdated: data.lastUpdated || new Date().toISOString(),
      archivedProjects: Array.isArray(data.archivedProjects) ? data.archivedProjects : []
    };
  }

  normalizeSprintData(data = {}) {
    const sprints = (Array.isArray(data.sprints) ? data.sprints : []).map((sprint) => ({
      id: sprint.id,
      name: sprint.name || '',
      projectId: sprint.projectId || null,
      goal: sprint.goal || '',
      status: sprint.status || 'planning',
      startDate: sprint.startDate || null,
      endDate: sprint.endDate || null,
      tasks: Array.isArray(sprint.tasks) ? sprint.tasks : [],
      progress: typeof sprint.progress === 'number' ? sprint.progress : 0,
      createdAt: sprint.createdAt || new Date().toISOString(),
      updatedAt: sprint.updatedAt || new Date().toISOString()
    }));

    return {
      version: data.version || '1.0.0',
      lastUpdated: data.lastUpdated || new Date().toISOString(),
      sprints,
      metadata: {
        totalSprints: sprints.length,
        activeSprints: sprints.filter((sprint) => sprint.status === 'active').length,
        planningSprints: sprints.filter((sprint) => sprint.status === 'planning').length,
        completedSprints: sprints.filter((sprint) => sprint.status === 'completed').length
      }
    };
  }

  normalizeData(file, data = {}) {
    switch (file) {
      case 'projects':
        return this.normalizeProjectData(data);
      case 'inbox':
        return this.normalizeInboxData(data);
      case 'config':
        return this.normalizeConfigData(data);
      case 'archive':
        return this.normalizeArchiveData(data);
      case 'sprints':
        return this.normalizeSprintData(data);
      case 'sources':
        return normalizeSourcesData(data);
      case 'hermesRecords':
        return require('../hermes/library').normalizeHermesRecordsData(data);
      case 'hermesRunTraces':
        return require('../hermes/runTrace').normalizeHermesRunTraceStore(data);
      default:
        return data;
    }
  }

  initFile(file, defaultData) {
    const filePath = this.getDataPath(file);
    fs.writeJsonSync(filePath, defaultData, { spaces: 2 });
    logger.info(`初始化数据文件 ${file}`);
  }

  ensureDataFile(file) {
    if (!DATA_FILES[file]) {
      return;
    }

    const dataDir = this.getDataDir();
    fs.ensureDirSync(dataDir);
    const filePath = this.getDataPath(file);
    if (!fs.existsSync(filePath) || this.isFileEmpty(filePath)) {
      this.initFile(file, this.getDefaultData(file));
    }
  }

  getSnapshotDir(file) {
    return path.join(this.getDataDir(), 'backups', 'autosnapshots', file);
  }

  async createSnapshot(file, filePath) {
    if (!DATA_FILES[file]) {
      return;
    }

    if (!(await fs.pathExists(filePath))) {
      return;
    }

    const snapshotDir = this.getSnapshotDir(file);
    await fs.ensureDir(snapshotDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = path.join(snapshotDir, `${file}-${timestamp}.json`);
    await fs.copy(filePath, snapshotPath, { overwrite: true });
    await this.pruneSnapshots(file);
  }

  async pruneSnapshots(file) {
    const snapshotDir = this.getSnapshotDir(file);
    if (!(await fs.pathExists(snapshotDir))) {
      return;
    }

    const entries = await fs.readdir(snapshotDir);
    const snapshots = await Promise.all(
      entries
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const fullPath = path.join(snapshotDir, name);
          const stats = await fs.stat(fullPath);
          return { fullPath, mtimeMs: stats.mtimeMs };
        })
    );

    snapshots.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const staleSnapshots = snapshots.slice(AUTO_SNAPSHOT_RETENTION);
    await Promise.all(staleSnapshots.map((item) => fs.remove(item.fullPath)));
  }

  async restoreFromLatestSnapshot(file, filePath) {
    if (!DATA_FILES[file]) {
      return false;
    }

    const snapshotDir = this.getSnapshotDir(file);
    if (!(await fs.pathExists(snapshotDir))) {
      return false;
    }

    const entries = await fs.readdir(snapshotDir);
    if (entries.length === 0) {
      return false;
    }

    const snapshots = await Promise.all(
      entries
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const fullPath = path.join(snapshotDir, name);
          const stats = await fs.stat(fullPath);
          return { fullPath, mtimeMs: stats.mtimeMs };
        })
    );

    if (snapshots.length === 0) {
      return false;
    }

    snapshots.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latestSnapshot = snapshots[0];
    await fs.copy(latestSnapshot.fullPath, filePath, { overwrite: true });
    logger.warn(`检测到 ${file} 数据损坏，已从快照恢复: ${latestSnapshot.fullPath}`);
    return true;
  }

  async read(file) {
    const dataKey = DATA_FILES[file] ? file : null;
    const filePath = this.getDataPath(file);
    try {
      if (dataKey) {
        this.ensureDataFile(file);
      }
      const data = await fs.readJson(filePath);
      return dataKey ? this.normalizeData(dataKey, data) : data;
    } catch (error) {
      if (dataKey) {
        try {
          const recovered = await this.restoreFromLatestSnapshot(file, filePath);
          if (recovered) {
            const recoveredData = await fs.readJson(filePath);
            return this.normalizeData(dataKey, recoveredData);
          }
        } catch (recoveryError) {
          logger.error(`快照恢复失败: ${file}`, recoveryError);
        }
      }
      logger.error(`读取文件失败: ${file}`, error);
      throw error;
    }
  }

  async write(file, data) {
    const dataKey = DATA_FILES[file] ? file : null;
    const filePath = this.getDataPath(file);
    const tempFilePath = `${filePath}.tmp-${Date.now()}-${process.pid}`;
    try {
      if (dataKey) {
        this.ensureDataFile(file);
      }
      const normalizedData = dataKey ? this.normalizeData(dataKey, data) : data;
      normalizedData.lastUpdated = new Date().toISOString();
      await fs.ensureDir(path.dirname(filePath));
      await this.createSnapshot(file, filePath);
      await fs.writeJson(tempFilePath, normalizedData, { spaces: 2 });
      await fs.move(tempFilePath, filePath, { overwrite: true });
      return true;
    } catch (error) {
      if (await fs.pathExists(tempFilePath)) {
        await fs.remove(tempFilePath);
      }
      logger.error(`写入文件失败: ${file}`, error);
      throw error;
    }
  }

  getDataPath(file) {
    return path.join(this.getDataDir(), DATA_FILES[file] || file);
  }
}

module.exports = new FileManager();
