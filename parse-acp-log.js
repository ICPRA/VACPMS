const fs = require('fs');
const log = process.argv[2];
const lines = fs.readFileSync(log, 'utf8').split('\n');
let text = '';
for (const l of lines) {
  const i = l.indexOf('agent_message_chunk');
  if (i < 0) continue;
  try {
    const j = l.indexOf('{', l.indexOf(']'));
    const msg = JSON.parse(l.slice(j));
    const parts = msg.params?.update?.content;
    if (Array.isArray(parts)) for (const p of parts) if (p.type === 'text' && p.text) text += p.text;
    else if (parts?.type === 'text' && parts.text) text += parts.text;
  } catch {}
}
console.log('=== agent final message ===');
console.log(text.slice(0, 600));
console.log('=== tool_call_update statuses ===');
for (const l of lines) {
  if (!l.includes('tool_call_update')) continue;
  try {
    const j = l.indexOf('{', l.indexOf(']'));
    const u = JSON.parse(l.slice(j)).params.update;
    console.log(JSON.stringify(u).slice(0, 300));
  } catch {}
}
