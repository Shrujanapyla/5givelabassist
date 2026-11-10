const fs = require('fs');
const path = require('path');
const { createLabServer } = require('./app');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '.env'));
const service = createLabServer();
service.httpServer.listen(service.config.port, '0.0.0.0', () => {
  const protocol = service.config.tlsEnabled ? 'https' : 'http';
  console.log(`5G Live Lab Assist API listening on ${protocol}://0.0.0.0:${service.config.port}`);
  console.log(`Allowed frontend origins: ${service.config.clientOrigins.join(', ')}`);
  console.log(`AI inference proxy: ${service.config.aiServiceUrl || 'disabled (optional service not configured)'}`);
});

function shutdown(signal) {
  console.log(`${signal} received; closing API and Socket.IO...`);
  service.io.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
