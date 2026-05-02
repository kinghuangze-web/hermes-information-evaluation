const express = require('express');
const router = express.Router();

const { ValidationError } = require('../middleware/errorHandler');
const { processHermesInput } = require('../hermes/orchestrator');
const { listRecords, getRecordById, updateRecordStatus } = require('../hermes/repository');
const { parseFeishuMessagePayload } = require('../hermes/feishuAdapter');
const { maybeReplyInFeishu } = require('../hermes/feishuClient');
const {
  buildMonitorOverview,
  getRunTraceById,
  listRunTraces,
  patchRunTrace
} = require('../hermes/runTraceRepository');

function validateStringArray(value, fieldName) {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} 必须是数组`);
  }
}

function validateProcessPayload(payload = {}) {
  const hasRawText = Boolean(String(payload.rawText || '').trim());
  const hasLinks = Array.isArray(payload.links) && payload.links.some((item) => String(item || '').trim());
  const hasImages = Array.isArray(payload.images) && payload.images.some((item) => String(item || '').trim());
  const hasAttachments = Array.isArray(payload.attachments) && payload.attachments.some((item) => String(item || '').trim());

  if (!hasRawText && !hasLinks && !hasImages && !hasAttachments) {
    throw new ValidationError('rawText、links、images、attachments 至少提供一项');
  }

  validateStringArray(payload.links, 'links');
  validateStringArray(payload.images, 'images');
  validateStringArray(payload.attachments, 'attachments');
}

router.post('/process', async (req, res, next) => {
  try {
    validateProcessPayload(req.body);
    const result = await processHermesInput(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/feishu/events', async (req, res, next) => {
  let payload = null;
  try {
    if (req.body?.type === 'url_verification' && req.body?.challenge) {
      return res.json({ challenge: req.body.challenge });
    }

    payload = parseFeishuMessagePayload(req.body);
    const result = await processHermesInput(payload);
    const feishuReply = await maybeReplyInFeishu({
      enabled: process.env.FEISHU_REPLY_ENABLED === 'true',
      chatId: payload.metadata?.chatId,
      openId: payload.metadata?.senderOpenId,
      message: result.feedback
    });

    let runTrace = result.runTrace || null;
    if (runTrace?.runId) {
      const replyStatus = feishuReply.status === 'sent'
        ? 'success'
        : (feishuReply.status === 'failed' ? 'failed' : 'unknown');
      runTrace = await patchRunTrace(runTrace.runId, {
        pipeline: {
          reply: {
            feishu: {
              status: replyStatus,
              reason: feishuReply.reason || '',
              metadata: feishuReply
            }
          }
        }
      });
    }

    res.status(201).json({
      success: true,
      data: {
        ...result,
        feishuReply,
        runTrace
      }
    });
  } catch (error) {
    try {
      if (payload?.metadata?.chatId || payload?.metadata?.senderOpenId) {
        const feishuReply = await maybeReplyInFeishu({
          enabled: process.env.FEISHU_REPLY_ENABLED === 'true',
          chatId: payload.metadata?.chatId,
          openId: payload.metadata?.senderOpenId,
          message: error.userMessage || error.message || 'Hermes 处理失败'
        });

        if (error.runTrace?.runId) {
          await patchRunTrace(error.runTrace.runId, {
            pipeline: {
              reply: {
                feishu: {
                  status: feishuReply.status === 'sent'
                    ? 'success'
                    : (feishuReply.status === 'failed' ? 'failed' : 'unknown'),
                  reason: feishuReply.reason || '',
                  metadata: feishuReply
                }
              }
            }
          });
        }
      }
    } catch {
    }
    next(error);
  }
});

router.get('/monitor/overview', async (req, res, next) => {
  try {
    const overview = await buildMonitorOverview();
    res.json({ success: true, data: overview });
  } catch (error) {
    next(error);
  }
});

router.get('/monitor/runs', async (req, res, next) => {
  try {
    const result = await listRunTraces(req.query);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.get('/monitor/runs/:runId', async (req, res, next) => {
  try {
    const run = await getRunTraceById(req.params.runId);
    res.json({ success: true, data: { run } });
  } catch (error) {
    next(error);
  }
});

router.get('/records', async (req, res, next) => {
  try {
    const records = await listRecords(req.query);
    res.json({ success: true, data: { records } });
  } catch (error) {
    next(error);
  }
});

router.get('/records/:id', async (req, res, next) => {
  try {
    const record = await getRecordById(req.params.id);
    res.json({ success: true, data: { record } });
  } catch (error) {
    next(error);
  }
});

router.patch('/records/:id/status', async (req, res, next) => {
  try {
    const record = await updateRecordStatus(req.params.id, req.body?.status);
    res.json({ success: true, data: { record } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
