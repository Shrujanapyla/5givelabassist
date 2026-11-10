const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const serviceDir = path.join(root, 'ai-service');
const localVenv = path.join(serviceDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const candidates = process.env.PYTHON
  ? [process.env.PYTHON]
  : [
      ...(fs.existsSync(localVenv) ? [localVenv] : []),
      ...(process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python']),
    ];

let python = null;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ['-c', 'import fastapi, PIL'], { cwd: serviceDir, stdio: 'ignore', shell: process.platform === 'win32' && !path.isAbsolute(candidate) });
  if (!probe.error && probe.status === 0) { python = candidate; break; }
}

if (!python) {
  console.log('SKIP: optional AI Python dependencies (FastAPI and Pillow) are not installed.');
  console.log('To enable the AI module and its tests, run START_AI.bat on Windows or install ai-service/requirements.txt in a Python virtual environment.');
  process.exit(0);
}

const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', '.', '-p', 'test*.py', '-v'], {
  cwd: serviceDir, stdio: 'inherit', shell: process.platform === 'win32' && !path.isAbsolute(python),
});
if (result.error) {
  console.error(`Could not run Python tests: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status || 1);
