const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'CHECKPOINTS', 'status.json');
const [,, moduleId, status, ...noteParts] = process.argv;
const allowed = new Set(['not_started', 'in_progress', 'implemented', 'implemented_with_limitations', 'verified', 'deployment_prepared', 'deployment_pending', 'excluded_by_user']);

if (!fs.existsSync(file)) {
  console.error('Checkpoint file is missing; refusing to create a new progress state over unknown project history.');
  process.exit(1);
}
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!moduleId) {
  console.log('Usage: npm run checkpoint -- M1|M2|M3|M4|M5|M6 STATUS "checkpoint note"');
  console.log(`Modules: ${(state.modules || []).map((item) => item.id).join(', ')}`);
  process.exit(0);
}
const module = (state.modules || []).find((item) => item.id === moduleId);
if (!module) {
    console.error(`Unknown module ${moduleId}. Known modules: ${(state.modules || []).map((item) => item.id).join(', ')}`);
  process.exit(1);
}
if (status) {
  if (!allowed.has(status)) {
    console.error(`Invalid status. Allowed: ${[...allowed].join(', ')}`);
    process.exit(1);
  }
  module.status = status;
}
if (noteParts.length) module.note = noteParts.join(' ');
state.lastUpdated = new Date().toISOString();
state.checkpointCount = (state.checkpointCount || 0) + 1;
fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
console.log(`Checkpoint saved for ${moduleId}: ${file}`);
