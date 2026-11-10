import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const keyPath = env.VITE_DEV_TLS_KEY_PATH;
  const certPath = env.VITE_DEV_TLS_CERT_PATH;
  if (Boolean(keyPath) !== Boolean(certPath)) {
    throw new Error('Set both VITE_DEV_TLS_KEY_PATH and VITE_DEV_TLS_CERT_PATH to enable HTTPS in the Vite dev server.');
  }
  const https = keyPath && certPath
    ? {
        key: fs.readFileSync(path.resolve(process.cwd(), keyPath)),
        cert: fs.readFileSync(path.resolve(process.cwd(), certPath)),
      }
    : undefined;

  return {
    plugins: [react()],
    server: { host: '0.0.0.0', ...(https ? { https } : {}) },
  };
});
