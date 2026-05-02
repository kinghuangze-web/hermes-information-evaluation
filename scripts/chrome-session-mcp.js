#!/usr/bin/env node
const readline = require('readline');

const PROXY_URL = (process.env.HERMES_CHROME_PROXY_URL || 'http://127.0.0.1:3456').replace(/\/+$/, '');

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, payload) {
  send({ jsonrpc: '2.0', id, result: payload });
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45000);

  try {
    const response = await fetch(`${PROXY_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      throw new Error(data.error || `Chrome session proxy request failed with status ${response.status}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function textContent(data) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      }
    ]
  };
}

const tools = [
  {
    name: 'list_pages',
    description: 'List open pages in the already logged-in Chrome session.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'extract_url',
    description: 'Open or reuse a URL in the logged-in Chrome session, wait briefly, and extract page title, URL, text, author, and publish time.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to extract.' },
        waitMs: { type: 'number', description: 'Extra wait time in milliseconds after page settles.', default: 2500 },
        closeAfterExtract: { type: 'boolean', description: 'Close a tab created only for this extraction.', default: true }
      },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'open_url',
    description: 'Open a URL in the logged-in Chrome session and return the tab id. Use this when a page needs follow-up interactions.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open.' },
        bringToFront: { type: 'boolean', description: 'Bring the tab to the front.', default: true }
      },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'evaluate_tab',
    description: 'Evaluate JavaScript in an existing Chrome tab by targetId. Use for read-only DOM extraction.',
    inputSchema: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Tab targetId from list_pages or open_url.' },
        expression: { type: 'string', description: 'JavaScript expression to evaluate.' }
      },
      required: ['targetId', 'expression'],
      additionalProperties: false
    }
  },
  {
    name: 'close_tab',
    description: 'Close an existing Chrome tab by targetId.',
    inputSchema: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Tab targetId from list_pages or open_url.' }
      },
      required: ['targetId'],
      additionalProperties: false
    }
  }
];

async function callTool(name, args = {}) {
  if (name === 'list_pages') {
    return textContent(await requestJson('/targets'));
  }

  if (name === 'extract_url') {
    const url = String(args.url || '').trim();
    if (!url) {
      throw new Error('extract_url requires url');
    }

    return textContent(await requestJson('/extract', {
      method: 'POST',
      body: JSON.stringify({
        url,
        waitMs: Number.parseInt(String(args.waitMs || '2500'), 10) || 2500,
        closeAfterExtract: args.closeAfterExtract !== false
      }),
      timeoutMs: 90000
    }));
  }

  if (name === 'open_url') {
    const url = String(args.url || '').trim();
    if (!url) {
      throw new Error('open_url requires url');
    }

    return textContent(await requestJson('/new', {
      method: 'POST',
      body: JSON.stringify({
        url,
        bringToFront: args.bringToFront !== false
      }),
      timeoutMs: 90000
    }));
  }

  if (name === 'evaluate_tab') {
    const targetId = String(args.targetId || '').trim();
    const expression = String(args.expression || '').trim();
    if (!targetId || !expression) {
      throw new Error('evaluate_tab requires targetId and expression');
    }

    return textContent(await requestJson('/evaluate', {
      method: 'POST',
      body: JSON.stringify({ targetId, expression }),
      timeoutMs: 90000
    }));
  }

  if (name === 'close_tab') {
    const targetId = String(args.targetId || '').trim();
    if (!targetId) {
      throw new Error('close_tab requires targetId');
    }

    return textContent(await requestJson('/close', {
      method: 'POST',
      body: JSON.stringify({ targetId }),
      timeoutMs: 45000
    }));
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  const { id, method, params = {} } = message;

  if (method === 'initialize') {
    result(id, {
      protocolVersion: params.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'zx-orbit-chrome-session',
        version: '1.0.0'
      }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    result(id, { tools });
    return;
  }

  if (method === 'tools/call') {
    try {
      result(id, await callTool(params.name, params.arguments || {}));
    } catch (err) {
      error(id, -32000, err.message || String(err));
    }
    return;
  }

  if (id !== undefined) {
    error(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  try {
    const message = JSON.parse(trimmed);
    handle(message).catch((err) => {
      if (message.id !== undefined) {
        error(message.id, -32000, err.message || String(err));
      }
    });
  } catch (err) {
    error(null, -32700, `Parse error: ${err.message}`);
  }
});
