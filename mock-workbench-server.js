// Mock SpecGraph workbench companion server (v0.2 with object details).
// Serves GET /current-view, GET /specs/:slug, GET /tasks/:id on :8600.
// Replace with the real SpecGraph-backed service in milestone 1 - the client
// speaks these shapes only.
const http = require('http');

const SPECS = {
  'export-policy': {
    slug: 'export-policy',
    title: 'Export policy',
    stage: 'approved',
    summary: '导出操作必须遵守的统一策略。',
    requirements: [
      { id: 'REQ-EXPORT-1', revision: 7, text: '导出前必须显示确认对话框，列出目标格式与范围。', acceptedAt: '2026-09-10T09:30:00Z', source: '会话 #412（已确认）' },
      { id: 'REQ-EXPORT-2', revision: 7, text: '导出文件名的默认规则：{项目名}-{日期}.{格式}。', acceptedAt: '2026-09-10T09:30:00Z', source: '会话 #412（已确认）' },
    ],
    decisions: [
      { id: 'DEC-18', revision: 3, text: '确认对话框采用双按钮布局（取消/导出），不采用复选框记忆。', acceptedAt: '2026-09-11T14:00:00Z' },
    ],
    scope: ['export-module', 'project-global'],
    dependencies: [],
    acceptanceCriteria: [
      { id: 'AC-1', text: '触发导出时弹出确认对话框，内容含格式与范围。', verifiedBy: 'TC-export-confirm-01（人工验收）' },
    ],
    evidence: [
      { id: 'EV-91', kind: 'manual-check', result: 'pass', at: '2026-09-12T10:00:00Z', note: '人工走查通过' },
    ],
    gaps: [],
    conflicts: [],
  },
  'overwrite-confirmation': {
    slug: 'overwrite-confirmation',
    title: 'Overwrite confirmation',
    stage: 'specified',
    summary: '目标文件已存在时的覆盖确认行为。',
    requirements: [
      { id: 'REQ-OW-1', revision: 3, text: '目标路径已存在文件时，必须二次确认并展示差异摘要。', acceptedAt: '2026-09-15T16:20:00Z', source: '纠错补记（原确认 2026-08-28，本次记入 2026-09-15）' },
    ],
    decisions: [],
    scope: ['export-module'],
    dependencies: [{ slug: 'export-policy', note: '覆盖确认在导出确认之后触发' }],
    acceptanceCriteria: [
      { id: 'AC-1', text: '已存在文件时展示差异摘要供用户决策。', verifiedBy: '未登记' },
    ],
    evidence: [],
    gaps: ['差异摘要的生成规则未定（低影响，未阻塞）'],
    conflicts: [],
  },
};

const TASKS = {
  'WP-42-8': {
    id: 'WP-42-8',
    title: 'Implement export confirmation dialog',
    status: 'ready',
    specSlug: 'export-policy',
    package: {
      acceptedRefs: { 'export-policy': 7, 'overwrite-confirmation': 3 },
      scopeRevisions: { 'project-global': 12, 'export-module': 9 },
      codeBaseline: 'commit a1b2c3d',
      unresolvedLinks: [],
      unreviewedSources: [],
    },
    runs: [
      { generation: 1, threadRef: 't3://thread/9f2c…', state: 'ended', note: '已结束，待提交交付' },
    ],
    deliveries: [],
    acceptance: null,
  },
  'WP-42-9': {
    id: 'WP-42-9',
    title: 'Wire export policy to confirmation',
    status: 'blocked',
    specSlug: 'overwrite-confirmation',
    package: null,
    runs: [],
    deliveries: [],
    acceptance: null,
    blockedReason: '依赖 WP-42-8 交付并通过验收（export-policy 依赖未满足）',
  },
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const write = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  if (url.pathname === '/current-view' || url.pathname === '/workbench-api/current-view') {
    return write({
      project: 'mock-project',
      generatedAt: new Date().toISOString(),
      specs: Object.values(SPECS).map((s) => ({ slug: s.slug, title: s.title, stage: s.stage })),
      tasks: Object.values(TASKS).map((t) => ({ id: t.id, title: t.title, status: t.status })),
      gaps: ['Mock data — replace with SpecGraph ReadCurrentView'],
    });
  }
  const specMatch = url.pathname.match(/^\/specs\/([^/]+)$/);
  if (specMatch && SPECS[specMatch[1]]) return write(SPECS[specMatch[1]]);
  const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch && TASKS[taskMatch[1]]) return write(TASKS[taskMatch[1]]);
  res.writeHead(404); res.end('not found');
});

server.listen(8600, () => console.log('mock workbench server v0.2 on :8600'));
