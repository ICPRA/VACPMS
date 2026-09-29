const fs = require('fs');
const path = require('path');
const home = process.env.USERPROFILE;
const p = path.join(home, '.t3', 'userdata', 'settings.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.providers = d.providers || {};
d.providers.cursor = {
  enabled: true,
  binaryPath: path.join(home, 'project-workbench', 'kimi-cursor-shim', 'cursor-agent.exe'),
};
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log(JSON.stringify(d.providers.cursor));
