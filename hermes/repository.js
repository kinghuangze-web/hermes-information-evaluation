const fileManager = require('../utils/fileManager');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');
const { normalizeHermesRecord, matchesRecordFilters } = require('./library');

async function readStore() {
  return fileManager.read('hermesRecords');
}

async function writeStore(data) {
  await fileManager.write('hermesRecords', data);
}

async function listRecords(filters = {}) {
  const data = await readStore();
  const records = Array.isArray(data.records) ? data.records : [];

  return records
    .filter((record) => matchesRecordFilters(record, filters))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

async function getRecordById(id) {
  const data = await readStore();
  const record = (data.records || []).find((item) => item.id === id);
  if (!record) {
    throw new NotFoundError('Hermes 记录不存在');
  }
  return record;
}

async function findDuplicateCandidate(dedupeKey) {
  if (!String(dedupeKey || '').trim()) {
    return null;
  }

  const data = await readStore();
  return (data.records || []).find((record) => record.dedupeKey === dedupeKey) || null;
}

async function saveRecord(record) {
  const data = await readStore();
  const normalizedRecord = normalizeHermesRecord(record);
  data.records = Array.isArray(data.records) ? data.records : [];
  data.records.unshift(normalizedRecord);
  await writeStore(data);
  return normalizedRecord;
}

async function updateRecordStatus(id, status) {
  if (!String(status || '').trim()) {
    throw new ValidationError('status 不能为空');
  }

  const data = await readStore();
  const index = (data.records || []).findIndex((record) => record.id === id);
  if (index === -1) {
    throw new NotFoundError('Hermes 记录不存在');
  }

  const updatedRecord = normalizeHermesRecord({
    ...data.records[index],
    status,
    updatedAt: new Date().toISOString()
  });

  data.records[index] = updatedRecord;
  await writeStore(data);
  return updatedRecord;
}

module.exports = {
  listRecords,
  getRecordById,
  findDuplicateCandidate,
  saveRecord,
  updateRecordStatus
};
