// Full-turn ACP test through the shim, from a client's perspective (mimics T3).
// Usage: node acp-fulltest.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SHIM = path.join(os.homedir(), 'project-workbench', 'kimi-cursor-shim', 'cursor-agent.exe');
const CWD = path.join(os.homedir(), 'kimi-acp-test');
fs.mkdirSync(CWD, { recursive: true });

const proc = spawn(SHIM, ['acp'], { cwd: CWD });
let buf = '';
let nextId = 1;
const start = Date.now();
const t = (msg) => console.log(`[${((Date.now() - start) / 1000).toFixed(1)}s] ${msg}`);

function send(obj) {
  proc.stdin.write(JSON.stringify(obj) + '\r\n');
  t(`-> ${obj.method ?? obj.result !== undefined ? obj.method ?? 'response' : obj.method} ${obj.id ? '#' + obj.id : ''}`);
}

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    fs.appendFileSync(path.join(__dirname, 'acp-raw.ndjson'), line + '\n');
    let msg;
    try { msg = JSON.parse(line); } catch { t('!! unparsed: ' + line.slice(0, 120)); continue; }
    if (msg.method) {
      t(`<- request ${msg.method} #${msg.id} ${JSON.stringify(msg.params).slice(0, 140)}`);
      handleAgentRequest(msg);
    } else {
      t(`<- response #${msg.id} ${JSON.stringify(msg.result ?? msg.error).slice(0, 140)}`);
      handleResponse(msg);
    }
  }
});
proc.stderr.on('data', (d) => t('stderr: ' + d.toString().trim().slice(0, 200)));

const pending = {};
function request(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending[id] = resolve;
    send({ jsonrpc: '2.0', id, method, params });
  });
}

async function handleAgentRequest(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) {
    // ACP notifications (session/update etc.): no response allowed.
    if (method === 'session/update' && params?.update?.sessionUpdate === 'tool_call') {
      t('   tool_call: ' + JSON.stringify(params.update).slice(0, 200));
    }
    return;
  }
  switch (method) {
    case 'session/request_permission': {
      const opts = params.toolCall ? null : params.options;
      t('   permission request: ' + JSON.stringify(params).slice(0, 200));
      // ACP: reply by selecting an option id ("approve_once" preferred).
      const optionId =
        params.options?.find((o) => o.kind === 'allow_once')?.optionId ??
        params.options?.find((o) => o.kind === 'allow_always')?.optionId ??
        params.options?.[0]?.optionId;
      send({
        jsonrpc: '2.0', id,
        result: { outcome: { outcome: 'selected', optionId } },
      });
      break;
    }
    case 'session/update':
      if (params.update?.sessionUpdate === 'tool_call') {
        t('   tool_call: ' + JSON.stringify(params.update).slice(0, 160));
      }
      send({ jsonrpc: '2.0', id, result: {} });
      break;
    default:
      t('   auto-ack agent request ' + method);
      send({ jsonrpc: '2.0', id, result: {} });
  }
}

let sessionId;
async function handleResponse(msg) {
  const { id, result, error } = msg;
  if (pending[id]) { pending[id]({ result, error }); delete pending[id]; }
}

(async () => {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'acp-fulltest', version: '0.0.1' },
  });
  t('initialized: agent=' + init.result?.agentInfo?.name);

  const auth = await request('authenticate', { method: 'login', args: [] });
  t('authenticate ack: ' + JSON.stringify(auth.result));

  const models = await request('cursor/list_available_models', {});
  t('models: ' + (models.result?.models ?? []).map((m) => m.name).join(', '));

  const sn = await request('session/new', { cwd: CWD, mcpServers: [] });
  sessionId = sn.result?.sessionId;
  t('session: ' + sessionId);

  await request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'Create a file named acp-result.txt containing the single line "hello from kimi acp". Then stop.' }],
  });
  t('prompt sent, waiting for turn completion (60s)...');

  setTimeout(async () => {
    const file = path.join(CWD, 'acp-result.txt');
    if (fs.existsSync(file)) {
      t('FILE CREATED: ' + fs.readFileSync(file, 'utf8').trim());
    } else {
      t('FILE MISSING');
    }
    try { await request('session/cancel', { sessionId }); } catch {}
    proc.kill();
    process.exit(fs.existsSync(file) ? 0 : 1);
  }, 60000);
})();
