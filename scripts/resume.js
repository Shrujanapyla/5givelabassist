const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'CHECKPOINTS', 'status.json');

if (!fs.existsSync(file)) {
  console.error('No checkpoint found. This ZIP should include CHECKPOINTS/status.json; do not reset or recreate the repository.');
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('\n5G LIVE LAB ASSIST — RESUME AUDIT');
console.log(`Baseline: ${state.baseline || 'not recorded'}`);
console.log(`Last checkpoint: ${state.lastUpdated || 'not recorded'}`);
console.log(`Checkpoint count: ${state.checkpointCount || 0}`);
console.log(`Excluded scope: ${(state.excluded || []).join('; ') || 'none'}`);

let missing = 0;
console.log('\nModule progress:');
for (const module of state.modules || []) {
  console.log(`\n[${module.status.toUpperCase()}] ${module.id} — ${module.name}`);
  console.log(`  ${module.note || ''}`);
  for (const relative of module.files || []) {
    const exists = fs.existsSync(path.join(root, relative));
    console.log(`  ${exists ? 'OK' : 'MISSING'}  ${relative}`);
    if (!exists) missing += 1;
  }
}

console.log('\nResume guidance:');
console.log(`- Missing tracked source files: ${missing}`);
console.log(`- Next recommended task: ${state.nextRecommended || 'Run npm run verify.'}`);
console.log('- This audit is read-only. It does not reset, overwrite, clone or reinstall the project.');
console.log('- Module 1 deployment preparation is tracked; do not claim university deployment until VM setup and acceptance are complete.');
if (missing > 0) process.exitCode = 2;
