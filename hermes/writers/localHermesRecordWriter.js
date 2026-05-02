const { saveRecord } = require('../repository');
const { normalizeHermesRecord } = require('../library');
const { writeRecordToSourceLibrary } = require('./sourceLibrarySync');

class LocalHermesRecordWriter {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.deps = options.deps || {};
  }

  async write(record, context = {}) {
    let sourceSyncResult;

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
        sourceSync: sourceSyncResult
      }
    });

    return saveRecord(normalizedRecord);
  }
}

module.exports = { LocalHermesRecordWriter };
