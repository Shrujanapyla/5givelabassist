const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { root, npmCommand } = require('./process');

function run(command, args, cwd, label, shell = false) {
  console.log(`\n========== ${label} ==========`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

try {
  run(npmCommand, ['test'], path.join(root, 'server'), 'Backend authentication, authorization, snapshot, multi-student and reconnect tests', process.platform === 'win32');
  run(npmCommand, ['run', 'test:unit'], path.join(root, 'client'), 'Frontend WebRTC metrics/adaptation and AI geometry unit tests', process.platform === 'win32');
  run(npmCommand, ['run', 'lint'], path.join(root, 'client'), 'Frontend lint', process.platform === 'win32');
  run(npmCommand, ['run', 'build'], path.join(root, 'client'), 'Frontend production build', process.platform === 'win32');
  console.log('\nALL CORE PROJECT VERIFICATION STEPS PASSED.');
} catch (error) {
  console.error(`\nVerification stopped: ${error.message}`);
  process.exitCode = 1;
}
