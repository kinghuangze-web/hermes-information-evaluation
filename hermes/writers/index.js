const { LocalHermesRecordWriter } = require('./localHermesRecordWriter');
const { FeishuBitableWriter } = require('./feishuBitableWriter');

function getHermesWriter(type = 'local', options = {}) {
  if (type === 'local') {
    return new LocalHermesRecordWriter({
      env: options.env,
      deps: options.deps
    });
  }

  if (type === 'bitable') {
    return new FeishuBitableWriter({
      env: options.env,
      deps: options.deps
    });
  }

  throw new Error(`Unsupported Hermes writer type: ${type}`);
}

module.exports = { getHermesWriter };
