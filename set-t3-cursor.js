const fs = require('fs');
const p = 'C:/Users/zheng/.t3/userdata/settings.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.providers = d.providers || {};
d.providers.cursor = {
  enabled: true,
  binaryPath: 'C:/Users/zheng/project-workbench/kimi-cursor-shim/cursor-agent.exe',
};
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log(JSON.stringify(d.providers.cursor));
