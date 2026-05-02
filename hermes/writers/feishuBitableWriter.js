const { normalizeHermesRecord } = require('../library');
const { saveRecord } = require('../repository');
const { writeRecordToFeishuBitable } = require('../feishuBitable');
const { writeRecordToSourceLibrary } = require('./sourceLibrarySync');

class FeishuBitableWriter {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.deps = options.deps || {};
  }

  async write(record, context = {}) {
    let feishuBitableResult;
    let sourceSyncResult;

    try {
      feishuBitableResult = await writeRecordToFeishuBitable(record, {
        env: this.env
      }, this.deps);
    } catch (error) {
      feishuBitableResult = {
        status: 'failed',
        reason: error.message
      };
    }

    try {
      sourceSyncResult = await writeRecordToSourceLibrary(record, {
        ...context,
        env: this.env
      }, this.deps);
    } catch (error) {
      sourceSyncResult = {
        status: 'failed',
        reason: error.message
      };
    }

    const normalizedRecord = normalizeHermesRecord({
      ...record,
      metadata: {
        ...(record.metadata || {}),
        feishuBitable: feishuBitableResult,
        sourceSync: sourceSyncResult
      }
    });

    return saveRecord(normalizedRecord);
  }
}

module.exports = { FeishuBitableWriter };
