const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { root, npmCommand } = require('./process');

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportedNode = (nodeMajor === 20 && nodeMinor >= 19) || (nodeMajor >= 22 && (nodeMajor > 22 || nodeMinor >= 12));
if (!supportedNode) {
  console.error(`Node.js ${process.versions.node} is not supported. Install Node.js 20.19+ (20.x) or 22.12+ (recommended LTS), then run npm start again.`);
  process.exit(1);
}

function dependenciesPresent() {
  const requiredServer = ['express', 'cors', 'socket.io', 'bcryptjs'];
  const requiredClient = ['vite', 'react', 'react-dom', 'socket.io-client', '@vitejs/plugin-react'];
  const installed = (folder, packages) => packages.every((name) =>
    fs.existsSync(path.join(root, folder, 'node_modules', name, 'package.json'))
  );
  return installed('server', requiredServer) && installed('client', requiredClient);
}

function configuredBackendPort() {
  if (process.env.PORT) return process.env.PORT;
  const envFile = path.join(root, 'server', '.env');
  if (fs.existsSync(envFile)) {
    const line = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find((entry) => /^\s*PORT\s*=/.test(entry));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '') || '3000';
  }
  return '3000';
}

if (!dependenciesPresent()) {
  console.log('[5G Live Lab] Dependencies not found. Installing them automatically...');
  const commands = [
    ['install', '--prefix', 'server', '--no-audit', '--no-fund'],
    ['install', '--prefix', 'client', '--no-audit', '--no-fund'],
  ];
  for (const args of commands) {
    const result = spawnSync(npmCommand, args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });
    if (result.status !== 0) {
      console.error('\nDependency installation failed. Check your internet connection and run `npm run setup`.');
      process.exit(result.status || 1);
    }
  }
}

const node = process.execPath;
const backendPort = configuredBackendPort();
const frontendPort = 5180;
const server = spawn(node, ['server/index.js'], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
const clientRoot = path.join(root, 'client');
const client = spawn(node, [path.join(clientRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '0.0.0.0', '--port', String(frontendPort), '--strictPort'], { cwd: clientRoot, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
const children = [server, client];
let shuttingDown = false;

console.log('\n5G Live Lab Assist 2.0 is starting.');
console.log(`Frontend: http://localhost:${frontendPort}`);
console.log(`Backend:  http://localhost:${backendPort}/health`);
console.log('Stop both services with Ctrl+C.');

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 700).unref();
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('A service could not start:', error.message);
    stopAll(1);
  });
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`A service exited unexpectedly (code ${code}).`);
      stopAll(code || 1);
    }
  });
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
