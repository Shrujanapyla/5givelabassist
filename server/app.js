const express = require('express');
const http = require('http');
const https = require('https');
const cors = require('cors');
const { Server } = require('socket.io');
const { randomBytes, randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const MAX_HISTORY = 500;
const MAX_IMAGE_CHARS = 8 * 1024 * 1024;
const DEFAULT_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    devices: (user.devices || []).map(({ id, name, registeredAt }) => ({ id, name, registeredAt })),
  };
}

function createRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const buckets = new Map();
  return function rateLimit(key) {
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return { allowed: true, remaining: max - 1 };
    }
    current.count += 1;
    return { allowed: current.count <= max, remaining: Math.max(0, max - current.count) };
  };
}

function createLabServer(options = {}) {
  const config = {
    port: Number(options.port ?? process.env.PORT ?? 3000),
    clientOrigins: (options.clientOrigins ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
      .split(',').map((origin) => origin.trim()).filter(Boolean),
    professorKey: options.professorKey ?? process.env.PROFESSOR_ENROLLMENT_KEY ?? (process.env.NODE_ENV === 'production' ? '' : 'professor-demo-key'),
    studentKey: options.studentKey ?? process.env.STUDENT_ENROLLMENT_KEY ?? (process.env.NODE_ENV === 'production' ? '' : 'student-demo-key'),
    adminKey: options.adminKey ?? process.env.ADMIN_ENROLLMENT_KEY ?? '',
    maxStudents: Number(options.maxStudents ?? process.env.MAX_STUDENTS_PER_SESSION ?? 3),
    sessionTtlMs: Number(options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS),
    aiServiceUrl: options.aiServiceUrl ?? process.env.AI_SERVICE_URL ?? '',
    dataDir: (() => {
      const configured = options.dataDir ?? process.env.DATA_DIR;
      return configured ? (path.isAbsolute(configured) ? configured : path.resolve(__dirname, configured)) : path.join(__dirname, 'data');
    })(),
    tlsKeyPath: options.tlsKeyPath ?? process.env.TLS_KEY_PATH ?? '',
    tlsCertPath: options.tlsCertPath ?? process.env.TLS_CERT_PATH ?? '',
    tlsKeyPassphrase: options.tlsKeyPassphrase ?? process.env.TLS_KEY_PASSPHRASE ?? '',
  };

  if (process.env.NODE_ENV === 'production') {
    for (const [name, value] of [['PROFESSOR_ENROLLMENT_KEY', config.professorKey], ['STUDENT_ENROLLMENT_KEY', config.studentKey]]) {
      if (typeof value !== 'string' || value.length < 32 || /demo-key|change-this|replace-me|generate_|placeholder|example/i.test(value)) {
        throw new Error(`${name} must be explicitly configured with a unique secret of at least 32 characters in production.`);
      }
    }
    if (config.adminKey && (config.adminKey.length < 32 || /demo-key|change-this|replace-me|generate_|placeholder|example/i.test(config.adminKey))) {
      throw new Error('ADMIN_ENROLLMENT_KEY must be at least 32 characters when configured in production.');
    }
    if (config.professorKey === config.studentKey || (config.adminKey && [config.professorKey, config.studentKey].includes(config.adminKey))) {
      throw new Error('Production enrollment keys must be different for each role.');
    }
    if (!process.env.CLIENT_ORIGIN || config.clientOrigins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '';
      } catch { return true; }
    })) {
      throw new Error('CLIENT_ORIGIN must contain the HTTPS frontend origin(s) in production.');
    }
    const configuredDataDir = options.dataDir ?? process.env.DATA_DIR;
    if (!configuredDataDir || !path.isAbsolute(configuredDataDir)) throw new Error('DATA_DIR must be an absolute persistent path in production.');
  }

  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(config.dataDir, 0o700);
  const usersFile = path.join(config.dataDir, 'users.json');
  const auditFile = path.join(config.dataDir, 'audit.jsonl');
  if (process.platform !== 'win32') {
    for (const file of [usersFile, auditFile]) if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  }
  let users = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    users = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const sessions = new Map();
  const sessionsFile = path.join(config.dataDir, 'sessions.json');
  if (process.platform !== 'win32' && fs.existsSync(sessionsFile)) fs.chmodSync(sessionsFile, 0o600);
  try {
    const savedSessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    if (!Array.isArray(savedSessions)) throw new Error('Session store must contain an array.');
    for (const saved of savedSessions) {
      if (!saved || typeof saved.code !== 'string' || !saved.code || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now()) continue;
      sessions.set(saved.code, {
        code: saved.code, ownerId: saved.ownerId, createdAt: saved.createdAt, expiresAt: saved.expiresAt,
        participants: new Map(), members: new Set(Array.isArray(saved.members) ? saved.members : [saved.ownerId]),
        snapshots: new Map(Array.isArray(saved.snapshots) ? saved.snapshots : []),
        snapshotHistory: Array.isArray(saved.snapshotHistory) ? saved.snapshotHistory.slice(-MAX_HISTORY) : [],
        historySequence: Number.isInteger(saved.historySequence) ? saved.historySequence : 0,
        interrupted: true,
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  function persistSessions() {
    const serialized = [...sessions.values()].map((session) => ({
      code: session.code, ownerId: session.ownerId, createdAt: session.createdAt, expiresAt: session.expiresAt,
      members: [...session.members], snapshots: [...session.snapshots.entries()],
      snapshotHistory: session.snapshotHistory.slice(-MAX_HISTORY), historySequence: session.historySequence,
    }));
    const temporary = `${sessionsFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(serialized), { mode: 0o600 });
    fs.renameSync(temporary, sessionsFile);
  }

  const tokens = new Map();
  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  if (Boolean(config.tlsKeyPath) !== Boolean(config.tlsCertPath)) {
    throw new Error('Set both TLS_KEY_PATH and TLS_CERT_PATH to enable HTTPS/WSS.');
  }
  const tlsEnabled = Boolean(config.tlsKeyPath && config.tlsCertPath);
  const resolveServerPath = (value) => path.isAbsolute(value) ? value : path.resolve(__dirname, value);
  const httpServer = tlsEnabled
    ? https.createServer({
        key: fs.readFileSync(resolveServerPath(config.tlsKeyPath)),
        cert: fs.readFileSync(resolveServerPath(config.tlsCertPath)),
        ...(config.tlsKeyPassphrase ? { passphrase: config.tlsKeyPassphrase } : {}),
      }, app)
    : http.createServer(app);
  config.tlsEnabled = tlsEnabled;
  const io = new Server(httpServer, {
    maxHttpBufferSize: 10 * 1024 * 1024,
    cors: {
      origin(origin, callback) {
        if (!origin || config.clientOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS.'));
      },
      methods: ['GET', 'POST'],
    },
  });

  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.clientOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS.'));
    },
  }));
  app.use(express.json({ limit: '9mb' }));

  const authLimiter = createRateLimiter({ windowMs: 60_000, max: 8 });
  const joinLimiter = createRateLimiter({ windowMs: 60_000, max: 12 });
  const socketJoinLimiter = createRateLimiter({ windowMs: 60_000, max: 8 });
  const aiLimiter = createRateLimiter({ windowMs: 60_000, max: 65 });
  const probeLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });
  const benchmarkLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

  function audit({ actorId = null, sessionId = null, action, outcome = 'success', ip = null, details = {} }) {
    const allowedDetails = {};
    for (const key of ['role', 'targetUserId', 'snapshotId', 'reason', 'participantCount']) {
      if (details[key] !== undefined) allowedDetails[key] = details[key];
    }
    const entry = {
      timestamp: new Date().toISOString(), actorId, sessionId, action,
      outcome, ip, details: allowedDetails,
    };
    try {
      if (fs.existsSync(auditFile) && fs.statSync(auditFile).size > 5 * 1024 * 1024) {
        fs.renameSync(auditFile, `${auditFile}.${Date.now()}.old`);
      }
      fs.appendFileSync(auditFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch (error) {
      console.error('Audit log write failed:', error.message);
    }
  }

  function persistUsers() {
    const temporary = `${usersFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(users, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, usersFile);
  }

  async function hashPassword(password) {
    return bcrypt.hash(password, 12);
  }

  async function verifyPassword(password, passwordHash) {
    return bcrypt.compare(password, passwordHash);
  }

  function issueToken(user) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    tokens.set(token, { userId: user.id, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  function userForToken(token) {
    const session = tokens.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) tokens.delete(token);
      return null;
    }
    return users.find((user) => user.id === session.userId) || null;
  }

  function bearerToken(req) {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  }

  function requireAuth(req, res, next) {
    const token = bearerToken(req);
    const user = token ? userForToken(token) : null;
    if (!user) return res.status(401).json({ success: false, message: 'Sign in with a registered account and device.' });
    req.user = user;
    req.authToken = token;
    next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Your account role cannot perform this action.' });
      next();
    };
  }

  function getSession(code) {
    const session = sessions.get(String(code || '').trim().toUpperCase());
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(session.code);
      persistSessions();
      return null;
    }
    return session;
  }

  function userIsSessionMember(session, userId) {
    return Boolean(session && session.members.has(userId));
  }

  function requireSessionMember(req, res, next) {
    const session = getSession(req.params.code);
    if (!session || !userIsSessionMember(session, req.user.id)) {
      return res.status(404).json({ success: false, message: 'Session not found or you are not a member.' });
    }
    req.labSession = session;
    next();
  }

  function getJoinedSession(socket) {
    const code = socket.data.sessionCode;
    const session = code ? getSession(code) : null;
    if (!session || !session.participants.has(socket.id)) return null;
    return session;
  }

  function sendSocketError(socket, message) {
    socket.emit('session-error', { message });
  }

  function sendSnapshotError(socket, message) {
    socket.emit('snapshot:error', { message });
  }

  function addHistory(session, action, snapshot, userId) {
    session.historySequence += 1;
    const entry = {
      historyId: randomUUID(), sequence: session.historySequence, action,
      snapshotId: snapshot.id, snapshot: structuredClone(snapshot),
      userId, timestamp: new Date().toISOString(),
    };
    session.snapshotHistory.push(entry);
    if (session.snapshotHistory.length > MAX_HISTORY) session.snapshotHistory.shift();
    return entry;
  }

  function participantSummary(participant) {
    return {
      socketId: participant.socketId,
      userId: participant.userId,
      displayName: participant.displayName,
      role: participant.role,
      joinedAt: participant.joinedAt,
    };
  }

  function validateSnapshotData(data, metadata = {}) {
    if (!isObject(data) || !isObject(metadata)) return 'Invalid snapshot data or metadata.';
    if (data.image !== undefined) {
      if (typeof data.image !== 'string' || data.image.length > MAX_IMAGE_CHARS || !/^data:image\/(png|jpeg|webp);base64,/.test(data.image)) {
        return 'Snapshot image must be a PNG, JPEG, or WebP data URL under 6 MB.';
      }
    }
    if (data.annotations !== undefined && !Array.isArray(data.annotations)) return 'Annotations must be an array.';
    return null;
  }

  function rateLimitOrReject(limiter, key, res, message) {
    const result = limiter(key);
    if (!result.allowed) {
      res.status(429).json({ success: false, message });
      return true;
    }
    return false;
  }

  app.get('/health', (_req, res) => res.json({
    status: 'ok', service: '5g-live-lab-assist', timestamp: new Date().toISOString(),
  }));

  function requireProbeAllowance(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress;
    if (rateLimitOrReject(probeLimiter, `${req.user.id}:${ip}`, res, 'MEC probes are rate-limited.')) return;
    next();
  }
  app.get('/api/mec/probe', requireAuth, requireProbeAllowance, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private').set('Pragma', 'no-cache');
    res.json({ success: true, serverTimestamp: Date.now() });
  });
  app.get('/api/mec/download', requireAuth, requireProbeAllowance, (req, res) => {
    const requested = Number.parseInt(req.query.bytes, 10);
    const bytes = Number.isInteger(requested) ? Math.min(Math.max(requested, 1024), 256 * 1024) : 64 * 1024;
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private').set('Content-Type', 'application/octet-stream').set('Content-Length', String(bytes));
    res.end(Buffer.alloc(bytes, 0x5a));
  });
  app.get('/api/mec/services', requireAuth, requireProbeAllowance, async (_req, res) => {
    let aiAvailable = false;
    if (config.aiServiceUrl) {
      try {
        const response = await fetch(`${config.aiServiceUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(1500), cache: 'no-store' });
        aiAvailable = response.ok;
      } catch { aiAvailable = false; }
    }
    res.set('Cache-Control', 'no-store').json({ backendAvailable: true, aiConfigured: Boolean(config.aiServiceUrl), aiProcessAvailable: aiAvailable });
  });
  app.post('/api/mec/upload', requireAuth, requireProbeAllowance, express.raw({ type: 'application/octet-stream', limit: '256kb' }), (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ success: true, receivedBytes: body.length, serverTimestamp: Date.now() });
  });
  app.post('/api/benchmark/run', requireAuth, requireRole('professor'), requireSessionMemberForBenchmark, async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    if (rateLimitOrReject(benchmarkLimiter, `${req.user.id}:${ip}`, res, 'Benchmark requests are rate-limited.')) return;
    const image = req.body?.image;
    if (typeof image !== 'string' || image.length > 1_000_000 || !/^data:image\/(png|jpeg|webp);base64,/.test(image)) return res.status(400).json({ success: false, message: 'Select a PNG, JPEG, or WebP benchmark image under 750 KB.' });
    const run = async (url) => {
      if (!url) return { configured: false };
      const started = performance.now();
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }), signal: AbortSignal.timeout(30_000) });
        const result = await response.json();
        return { configured: true, ok: response.ok, endpointRequestMs: Number((performance.now() - started).toFixed(2)), processingMs: Number.isFinite(Number(result.inferenceMs)) ? Number(result.inferenceMs) : null, detections: Array.isArray(result.detections) ? result.detections : [], status: response.status };
      } catch (error) { return { configured: true, ok: false, error: error.name === 'TimeoutError' ? 'Request timed out.' : 'Processing endpoint unavailable.' }; }
    };
    const url = config.aiServiceUrl ? `${config.aiServiceUrl.replace(/\/$/, '')}/detect` : '';
    const result = await run(url);
    res.json({ success: true, destination: 'mec', result, measuredAt: new Date().toISOString() });
  });
  app.get('/api/benchmark/config', requireAuth, requireRole('professor'), (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ mecConfigured: Boolean(config.aiServiceUrl) });
  });
  function requireSessionMemberForBenchmark(req, res, next) {
    const session = getSession(req.body?.sessionCode);
    if (!session || !userIsSessionMember(session, req.user.id)) return res.status(404).json({ success: false, message: 'Join a session before running benchmarks.' });
    next();
  }

  app.post('/api/auth/register', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    if (rateLimitOrReject(authLimiter, `register:${ip}`, res, 'Too many registration attempts. Try again later.')) return;
    const email = cleanText(req.body.email, 180).toLowerCase();
    const displayName = cleanText(req.body.displayName, 80);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = cleanText(req.body.role, 20);
    const deviceId = cleanText(req.body.deviceId, 128);
    const deviceName = cleanText(req.body.deviceName || 'This browser', 100);
    const enrollmentKey = typeof req.body.enrollmentKey === 'string' ? req.body.enrollmentKey : '';
    const roleKeys = { professor: config.professorKey, student: config.studentKey, administrator: config.adminKey };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName || password.length < 10 || Buffer.byteLength(password, 'utf8') > 72 || !deviceId || !roleKeys[role]) {
      return res.status(400).json({ success: false, message: 'Enter a valid email, name, a password of 10–72 UTF-8 bytes, role, and device ID.' });
    }
    if (!roleKeys[role] || !roleKeys[role].length || enrollmentKey !== roleKeys[role]) {
      audit({ action: 'auth.register', outcome: 'denied', ip, details: { role, reason: 'invalid-enrollment-key' } });
      return res.status(403).json({ success: false, message: 'The enrollment key is invalid for that role.' });
    }
    if (users.some((user) => user.email === email)) return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    const passwordRecord = await hashPassword(password);
    const user = {
      id: randomUUID(), email, displayName, role,
      password: passwordRecord,
      devices: [{ id: deviceId, name: deviceName, registeredAt: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    persistUsers();
    const auth = issueToken(user);
    audit({ actorId: user.id, action: 'auth.register', ip, details: { role } });
    res.status(201).json({ success: true, ...auth, user: publicUser(user) });
  });

  app.post('/api/auth/login', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    if (rateLimitOrReject(authLimiter, `login:${ip}`, res, 'Too many sign-in attempts. Try again later.')) return;
    const email = cleanText(req.body.email, 180).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const deviceId = cleanText(req.body.deviceId, 128);
    if (Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ success: false, message: 'Password must be no more than 72 UTF-8 bytes.' });
    const user = users.find((item) => item.email === email);
    if (!user || !await verifyPassword(password, user.password)) {
      audit({ action: 'auth.login', outcome: 'denied', ip, details: { reason: 'invalid-credentials' } });
      return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
    }
    if (!user.devices.some((device) => device.id === deviceId)) {
      audit({ actorId: user.id, action: 'auth.login', outcome: 'denied', ip, details: { reason: 'unregistered-device' } });
      return res.status(403).json({ success: false, message: 'This browser is not registered. Sign in from a registered device or register this device from your existing session.' });
    }
    const auth = issueToken(user);
    audit({ actorId: user.id, action: 'auth.login', ip, details: { role: user.role } });
    res.json({ success: true, ...auth, user: publicUser(user) });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ success: true, user: publicUser(req.user) }));

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    tokens.delete(req.authToken);
    audit({ actorId: req.user.id, action: 'auth.logout', ip: req.ip });
    res.json({ success: true });
  });

  app.post('/api/auth/devices/register', requireAuth, async (req, res) => {
    const deviceId = cleanText(req.body.deviceId, 128);
    const deviceName = cleanText(req.body.deviceName || 'New browser', 100);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!deviceId || Buffer.byteLength(password, 'utf8') > 72 || !await verifyPassword(password, req.user.password)) {
      return res.status(400).json({ success: false, message: 'Provide this account password and a valid device ID.' });
    }
    if (!req.user.devices.some((device) => device.id === deviceId)) {
      req.user.devices.push({ id: deviceId, name: deviceName, registeredAt: new Date().toISOString() });
      persistUsers();
    }
    audit({ actorId: req.user.id, action: 'auth.device.register', ip: req.ip });
    res.json({ success: true, user: publicUser(req.user) });
  });

  app.post('/api/sessions', requireAuth, requireRole('professor'), (req, res) => {
    let code;
    do { code = randomBytes(16).toString('hex').toUpperCase(); } while (sessions.has(code));
    const now = Date.now();
    const session = {
      code, ownerId: req.user.id, createdAt: new Date(now).toISOString(),
      expiresAt: now + config.sessionTtlMs, participants: new Map(), members: new Set([req.user.id]),
      snapshots: new Map(), snapshotHistory: [], historySequence: 0,
    };
    sessions.set(code, session);
    persistSessions();
    audit({ actorId: req.user.id, sessionId: code, action: 'session.create', ip: req.ip });
    res.status(201).json({ success: true, session: { code, expiresAt: new Date(session.expiresAt).toISOString() } });
  });

  app.post('/api/sessions/join', requireAuth, requireRole('student'), (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    if (rateLimitOrReject(joinLimiter, `join:${req.user.id}:${ip}`, res, 'Too many join attempts. Wait before trying again.')) return;
    const code = cleanText(req.body.code, 40).toUpperCase();
    const session = getSession(code);
    if (!session) {
      audit({ actorId: req.user.id, sessionId: code, action: 'session.join', outcome: 'denied', ip, details: { reason: 'unknown-or-expired-code' } });
      return res.status(404).json({ success: false, message: 'Session not found or expired. Check the code.' });
    }
    const activeStudents = [...session.participants.values()].filter((person) => person.role === 'student').length;
    if (activeStudents >= config.maxStudents && !session.members.has(req.user.id)) {
      return res.status(409).json({ success: false, message: `This session has reached its ${config.maxStudents}-student limit.` });
    }
    res.json({ success: true, session: { code: session.code } });
  });

  app.get('/api/sessions/:code/snapshots', requireAuth, requireSessionMember, (req, res) => {
    res.json({ success: true, snapshots: [...req.labSession.snapshots.values()] });
  });

  app.get('/api/sessions/:code/snapshots/history', requireAuth, requireSessionMember, (req, res) => {
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), MAX_HISTORY) : 100;
    res.json({ success: true, history: req.labSession.snapshotHistory.slice(-limit) });
  });

  app.get('/api/admin/audit', requireAuth, requireRole('administrator'), (req, res) => {
    try {
      const records = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).slice(-500).map((line) => JSON.parse(line)) : [];
      res.json({ success: true, records });
    } catch {
      res.status(500).json({ success: false, message: 'Could not read audit records.' });
    }
  });

  app.post('/api/ai/detect', requireAuth, requireRole('professor'), requireSessionMemberForBody, async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    if (rateLimitOrReject(aiLimiter, `${req.user.id}:${ip}`, res, 'AI frame sampling is rate-limited.')) return;
    const image = req.body.image;
    if (typeof image !== 'string' || image.length > 2_500_000 || !/^data:image\/(png|jpeg|webp);base64,/.test(image)) {
      return res.status(400).json({ success: false, message: 'Send a PNG, JPEG, or WebP frame smaller than 1.8 MB.' });
    }
    const student = users.find((user) => user.id === cleanText(req.body.participantId, 128));
    if (!student || student.role !== 'student' || !req.labSession.members.has(student.id)) {
      return res.status(403).json({ success: false, message: 'The selected video source is not a student member of this session.' });
    }
    const frameTimestamp = Number.isFinite(Number(req.body.frameTimestamp)) ? Number(req.body.frameTimestamp) : Date.now();
    if (!config.aiServiceUrl) return res.status(503).json({ success: false, message: 'AI service is not configured. Start the optional Python AI service and set AI_SERVICE_URL.' });
    try {
      const response = await fetch(`${config.aiServiceUrl.replace(/\/$/, '')}/detect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok) return res.status(response.status).json({ success: false, message: result.detail || 'AI inference failed.' });
      const session = getSession(req.body.sessionCode);
      const detections = {
        ...result, sessionCode: req.labSession.code, participantId: student.id, frameTimestamp,
      };
      if (session) {
        io.to(session.code).emit('ai:detections', {
          ...detections, displayName: student.displayName,
        });
      }
      res.json({ success: true, ...detections });
    } catch (error) {
      res.status(503).json({ success: false, message: `AI service unavailable: ${error.message}` });
    }
  });

  function requireSessionMemberForBody(req, res, next) {
    const session = getSession(req.body.sessionCode);
    if (!session || !userIsSessionMember(session, req.user.id)) return res.status(404).json({ success: false, message: 'Session not found or you are not a member.' });
    req.labSession = session;
    next();
  }

  io.use((socket, next) => {
    const token = cleanText(socket.handshake.auth?.token, 256);
    const user = token ? userForToken(token) : null;
    if (!user) return next(new Error('Authentication required. Sign in before connecting.'));
    socket.data.user = { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    console.log(`Authenticated client connected: ${user.displayName} (${user.role})`);

    socket.on('join-session', ({ code } = {}) => {
      const joinAttempt = socketJoinLimiter(`${user.id}:${socket.handshake.address || 'unknown'}`);
      if (!joinAttempt.allowed) return sendSocketError(socket, 'Too many session join attempts. Wait before trying again.');
      code = cleanText(code, 40).toUpperCase();
      const session = getSession(code);
      if (!session) return sendSocketError(socket, 'Session not found or expired.');
      if (user.role === 'professor' && session.ownerId !== user.id) {
        audit({ actorId: user.id, sessionId: code, action: 'session.join', outcome: 'denied', details: { reason: 'not-session-owner' } });
        return sendSocketError(socket, 'Only the professor who created this session can manage it.');
      }
      if (!['professor', 'student'].includes(user.role)) return sendSocketError(socket, 'This account role cannot join a laboratory session.');
      if (user.role === 'student') {
        const alreadyActive = [...session.participants.values()].some((person) => person.userId === user.id);
        const activeStudents = [...session.participants.values()].filter((person) => person.role === 'student').length;
        if (alreadyActive) return sendSocketError(socket, 'This student account is already connected to the session.');
        if (activeStudents >= config.maxStudents) return sendSocketError(socket, `This session is limited to ${config.maxStudents} students.`);
      }
      if (user.role === 'professor' && [...session.participants.values()].some((person) => person.role === 'professor' && person.userId !== user.id)) {
        return sendSocketError(socket, 'A professor is already active in this session.');
      }

      const priorCode = socket.data.sessionCode;
      if (priorCode && priorCode !== code) leaveCurrentSession(socket, 'session.switch');
      const existingParticipants = [...session.participants.values()].map(participantSummary);
      const participant = {
        socketId: socket.id, userId: user.id, displayName: user.displayName,
        role: user.role, joinedAt: new Date().toISOString(),
      };
      session.participants.set(socket.id, participant);
      session.members.add(user.id);
      persistSessions();
      socket.data.sessionCode = code;
      socket.join(code);
      socket.emit('session-joined', {
        code, role: user.role, user: { id: user.id, displayName: user.displayName },
        participants: existingParticipants,
        snapshots: [...session.snapshots.values()],
      });
      socket.to(code).emit('participant-joined', participantSummary(participant));
      audit({ actorId: user.id, sessionId: code, action: 'session.join', details: { role: user.role, participantCount: session.participants.size } });
      console.log(`${user.displayName} joined ${code} as ${user.role}`);
    });

    function leaveCurrentSession(activeSocket, action = 'session.leave') {
      const code = activeSocket.data.sessionCode;
      const session = code ? getSession(code) : null;
      if (session) {
        session.participants.delete(activeSocket.id);
        activeSocket.to(code).emit('participant-left', { socketId: activeSocket.id, userId: user.id });
        audit({ actorId: user.id, sessionId: code, action });
      }
      activeSocket.leave(code || '');
      delete activeSocket.data.sessionCode;
    }

    function authorizeJoined(socketRef, allowedRoles) {
      const session = getJoinedSession(socketRef);
      if (!session) {
        sendSnapshotError(socketRef, 'Join a session first.');
        return null;
      }
      if (allowedRoles && !allowedRoles.includes(socketRef.data.user.role)) {
        audit({ actorId: user.id, sessionId: session.code, action: 'authorization.denied', outcome: 'denied', details: { role: user.role, reason: 'role-not-permitted' } });
        sendSnapshotError(socketRef, 'Your role is not allowed to perform this action.');
        return null;
      }
      return session;
    }

    socket.on('snapshot:create', ({ data, metadata = {} } = {}) => {
      const session = authorizeJoined(socket, ['professor']);
      if (!session) return;
      const validationError = validateSnapshotData(data, metadata);
      if (validationError) return sendSnapshotError(socket, validationError);
      const now = new Date().toISOString();
      const snapshot = {
        id: randomUUID(), sessionCode: session.code, data: structuredClone(data), metadata: structuredClone(metadata),
        createdAt: now, updatedAt: now, createdBy: user.id, updatedBy: user.id, version: 1,
      };
      session.snapshots.set(snapshot.id, snapshot);
      const historyEntry = addHistory(session, 'created', snapshot, user.id);
      persistSessions();
      io.to(session.code).emit('snapshot:created', { snapshot, historyEntry });
      audit({ actorId: user.id, sessionId: session.code, action: 'snapshot.create', details: { snapshotId: snapshot.id } });
    });

    socket.on('snapshot:update', ({ snapshotId, data, metadata, expectedVersion } = {}) => {
      const session = authorizeJoined(socket, ['professor']);
      if (!session) return;
      const snapshot = session.snapshots.get(snapshotId);
      if (!snapshot) return sendSnapshotError(socket, 'Snapshot not found.');
      if (expectedVersion !== undefined && expectedVersion !== snapshot.version) {
        socket.emit('snapshot:conflict', { message: 'Snapshot changed since it was loaded.', currentSnapshot: structuredClone(snapshot) });
        audit({ actorId: user.id, sessionId: session.code, action: 'snapshot.update', outcome: 'denied', details: { snapshotId, reason: 'version-conflict' } });
        return;
      }
      if (data !== undefined || metadata !== undefined) {
        const validationError = validateSnapshotData(data === undefined ? snapshot.data : data, metadata === undefined ? snapshot.metadata : metadata);
        if (validationError) return sendSnapshotError(socket, validationError);
      }
      if (data !== undefined) snapshot.data = structuredClone(data);
      if (metadata !== undefined) snapshot.metadata = structuredClone(metadata);
      snapshot.updatedAt = new Date().toISOString();
      snapshot.updatedBy = user.id;
      snapshot.version += 1;
      const historyEntry = addHistory(session, 'updated', snapshot, user.id);
      persistSessions();
      io.to(session.code).emit('snapshot:updated', { snapshot, historyEntry });
      audit({ actorId: user.id, sessionId: session.code, action: 'snapshot.update', details: { snapshotId } });
    });

    socket.on('snapshot:delete', ({ snapshotId } = {}) => {
      const session = authorizeJoined(socket, ['professor']);
      if (!session) return;
      const snapshot = session.snapshots.get(snapshotId);
      if (!snapshot) return sendSnapshotError(socket, 'Snapshot not found.');
      const historyEntry = addHistory(session, 'deleted', snapshot, user.id);
      session.snapshots.delete(snapshotId);
      persistSessions();
      io.to(session.code).emit('snapshot:deleted', { snapshotId, historyEntry });
      audit({ actorId: user.id, sessionId: session.code, action: 'snapshot.delete', details: { snapshotId } });
    });

    socket.on('snapshot:history:request', () => {
      const session = authorizeJoined(socket);
      if (!session) return;
      socket.emit('snapshot:history', { history: session.snapshotHistory });
    });

    socket.on('snapshot:restore', ({ historyId } = {}) => {
      const session = authorizeJoined(socket, ['professor']);
      if (!session) return;
      const historyEntry = session.snapshotHistory.find((entry) => entry.historyId === historyId);
      if (!historyEntry) return sendSnapshotError(socket, 'Snapshot history entry not found.');
      const previous = historyEntry.snapshot;
      const restored = {
        ...structuredClone(previous), updatedAt: new Date().toISOString(), updatedBy: user.id,
        version: (session.snapshots.get(previous.id)?.version || 0) + 1,
      };
      session.snapshots.set(restored.id, restored);
      const newHistoryEntry = addHistory(session, 'restored', restored, user.id);
      persistSessions();
      io.to(session.code).emit('snapshot:updated', { snapshot: restored, historyEntry: newHistoryEntry });
      audit({ actorId: user.id, sessionId: session.code, action: 'snapshot.restore', details: { snapshotId: restored.id } });
    });

    function findPeer(targetSocketId, expectedRole) {
      const session = getJoinedSession(socket);
      if (!session) return null;
      const self = session.participants.get(socket.id);
      const target = session.participants.get(targetSocketId);
      if (!self || !target || target.role !== expectedRole || targetSocketId === socket.id) return null;
      return { session, self, target };
    }

    socket.on('webrtc-offer', ({ offer, targetSocketId } = {}) => {
      if (!offer || user.role !== 'student') return;
      const peer = findPeer(targetSocketId, 'professor');
      if (!peer) return sendSocketError(socket, 'The professor is not an active member of this session.');
      io.to(targetSocketId).emit('webrtc-offer', { offer, fromSocketId: socket.id, participant: participantSummary(peer.self) });
    });

    socket.on('webrtc-answer', ({ answer, targetSocketId } = {}) => {
      if (!answer || user.role !== 'professor') return;
      const peer = findPeer(targetSocketId, 'student');
      if (!peer) return sendSocketError(socket, 'The student is no longer in this session.');
      io.to(targetSocketId).emit('webrtc-answer', { answer, fromSocketId: socket.id });
    });

    socket.on('webrtc-ice-candidate', ({ candidate, targetSocketId } = {}) => {
      if (!candidate) return;
      const session = getJoinedSession(socket);
      const self = session?.participants.get(socket.id);
      const target = session?.participants.get(targetSocketId);
      if (!session || !self || !target || self.role === target.role || targetSocketId === socket.id) return;
      io.to(targetSocketId).emit('webrtc-ice-candidate', { candidate, fromSocketId: socket.id });
    });

    socket.on('network:metrics', ({ metrics } = {}) => {
      const session = authorizeJoined(socket);
      if (!session || !isObject(metrics)) return;
      const bounded = {};
      for (const key of ['rttMs', 'jitterMs', 'packetLossPercent', 'bitrateKbps', 'fps', 'width', 'height']) {
        const value = Number(metrics[key]);
        if (Number.isFinite(value) && value >= 0 && value < 1_000_000) bounded[key] = Math.round(value * 100) / 100;
      }
      io.to(session.code).emit('network:metrics:update', {
        participantId: user.id, displayName: user.displayName, role: user.role,
        timestamp: Date.now(), metrics: {
          ...bounded,
          quality: ['good', 'degraded', 'poor', 'connecting', 'unknown'].includes(metrics.quality) ? metrics.quality : 'unknown',
          direction: ['inbound', 'outbound'].includes(metrics.direction) ? metrics.direction : 'unknown',
        },
        connectionState: cleanText(metrics.connectionState, 40),
        adaptiveProfile: ['high', 'medium', 'low'].includes(metrics.adaptiveProfile) ? metrics.adaptiveProfile : 'unknown',
      });
    });

    socket.on('annotation-update', ({ annotation } = {}) => {
      const session = authorizeJoined(socket, ['professor']);
      if (!session || !isObject(annotation)) return;
      io.to(session.code).emit('annotation-update', { annotation, from: user.id });
      audit({ actorId: user.id, sessionId: session.code, action: 'annotation.update' });
    });

    socket.on('annotation-clear', () => {
      const session = authorizeJoined(socket, ['professor']);
      if (!session) return;
      io.to(session.code).emit('annotation-clear', { from: user.id });
      audit({ actorId: user.id, sessionId: session.code, action: 'annotation.clear' });
    });

    socket.on('disconnect', () => {
      if (socket.data.sessionCode) leaveCurrentSession(socket);
      console.log(`Client disconnected: ${user.displayName}`);
    });
  });

  return { app, httpServer, io, sessions, users, tokens, config, auditFile, sessionsFile };
}

module.exports = { createLabServer };
