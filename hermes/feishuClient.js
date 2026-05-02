function readJson(response) {
  return response.json ? response.json() : Promise.resolve({});
}

function assertFeishuSuccess(data, action) {
  const code = Number(data?.code ?? 0);
  if (code !== 0) {
    throw new Error(`${action} failed with code ${code}: ${data?.msg || 'unknown error'}`);
  }
  return data;
}

function getFeishuOpenBaseUrl(input = {}) {
  const env = input.env || process.env;
  return input.baseUrl || env.FEISHU_OPEN_BASE_URL || 'https://open.feishu.cn';
}

async function getTenantAccessToken({ appId, appSecret }, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const baseUrl = getFeishuOpenBaseUrl({ baseUrl: deps.baseUrl, env: deps.env });
  const response = await fetchImpl(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret
    })
  });

  if (!response.ok) {
    throw new Error(`Feishu tenant token request failed with status ${response.status}`);
  }

  const data = await readJson(response);
  assertFeishuSuccess(data, 'Feishu tenant token request');
  if (!data.tenant_access_token) {
    throw new Error('Feishu tenant token missing in response');
  }

  return data.tenant_access_token;
}

async function sendTextMessage({ tenantAccessToken, receiveId, message, receiveIdType = 'chat_id' }, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const baseUrl = getFeishuOpenBaseUrl({ baseUrl: deps.baseUrl, env: deps.env });
  const response = await fetchImpl(`${baseUrl}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({
        text: message
      })
    })
  });

  if (!response.ok) {
    throw new Error(`Feishu send message failed with status ${response.status}`);
  }

  const data = await readJson(response);
  assertFeishuSuccess(data, 'Feishu send message');
  return {
    messageId: data.data?.message_id || null,
    raw: data
  };
}

async function maybeReplyInFeishu(input = {}, deps = {}) {
  const appId = input.appId || process.env.FEISHU_APP_ID;
  const appSecret = input.appSecret || process.env.FEISHU_APP_SECRET;
  const enabled = input.enabled ?? (process.env.FEISHU_REPLY_ENABLED === 'true' || Boolean(appId && appSecret));
  const receiveId = input.chatId || input.receiveId || input.openId || null;
  const receiveIdType = input.chatId ? 'chat_id' : (input.receiveIdType || (input.openId ? 'open_id' : 'chat_id'));
  const message = String(input.message || '').trim();

  if (!enabled) {
    return { status: 'skipped', reason: 'disabled' };
  }

  if (!appId || !appSecret) {
    return { status: 'skipped', reason: 'missing_credentials' };
  }

  if (!receiveId || !message) {
    return { status: 'skipped', reason: 'missing_target_or_message' };
  }

  try {
    const tenantAccessToken = await getTenantAccessToken({ appId, appSecret }, {
      ...deps,
      env: deps.env || process.env
    });
    const result = await sendTextMessage({ tenantAccessToken, receiveId, message, receiveIdType }, {
      ...deps,
      env: deps.env || process.env
    });
    return {
      status: 'sent',
      receiveId,
      receiveIdType,
      messageId: result.messageId
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: error.message
    };
  }
}

module.exports = {
  getFeishuOpenBaseUrl,
  getTenantAccessToken,
  sendTextMessage,
  maybeReplyInFeishu
};
