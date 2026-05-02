const { ValidationError } = require('../middleware/errorHandler');
const { normalizeList } = require('./library');
const { extractUrlsFromText } = require('./enrichment/remoteContent');

function parseFeishuMessagePayload(body = {}) {
  const event = body.event || {};
  const message = event.message || {};
  const messageType = message.message_type;
  const sharedMetadata = {
    chatId: message.chat_id || null,
    senderOpenId: event.sender?.sender_id?.open_id || null,
    messageType,
    eventType: body.header?.event_type || null
  };

  let content = {};
  try {
    content = JSON.parse(message.content || '{}');
  } catch {
    throw new ValidationError('飞书消息内容不是合法 JSON');
  }

  if (messageType === 'text') {
    const text = String(content.text || '').trim();
    if (!text) {
      throw new ValidationError('飞书消息文本不能为空');
    }

    return {
      rawText: text,
      links: normalizeList(extractUrlsFromText(text)),
      images: [],
      attachments: [],
      sourcePlatform: 'feishu',
      sourceType: 'text',
      metadata: sharedMetadata
    };
  }

  if (messageType === 'image') {
    const imageKey = String(content.image_key || '').trim();
    return {
      rawText: '',
      links: [],
      images: imageKey ? [`feishu://image/${imageKey}`] : [],
      attachments: [],
      sourcePlatform: 'feishu',
      sourceType: 'image',
      metadata: {
        ...sharedMetadata,
        imageKey: imageKey || null
      }
    };
  }

  if (messageType === 'file') {
    const fileKey = String(content.file_key || '').trim();
    return {
      rawText: '',
      links: [],
      images: [],
      attachments: fileKey ? [`feishu://file/${fileKey}`] : [],
      sourcePlatform: 'feishu',
      sourceType: 'file',
      metadata: {
        ...sharedMetadata,
        fileKey: fileKey || null,
        fileName: String(content.file_name || '').trim() || null
      }
    };
  }

  throw new ValidationError('当前仅支持飞书 text、image、file 消息');
}

module.exports = {
  parseFeishuMessagePayload
};
