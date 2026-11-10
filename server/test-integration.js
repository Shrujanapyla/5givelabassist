const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: createClient } = require('socket.io-client');
const { createLabServer } = require('./app');

process.env.NODE_ENV = 'test';

const timeoutMs = 5000;
function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function jsonRequest(baseUrl, route, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

async function register(baseUrl, role, suffix) {
  const { response, data } = await jsonRequest(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: {
      email: `${role}-${suffix}@example.test`, displayName: `${role} ${suffix}`,
      password: 'correct-horse-battery-staple', role,
      deviceId: `device-${role}-${suffix}`, deviceName: 'Integration test browser',
      enrollmentKey: `${role}-test-key`,
    },
  });
  assert.equal(response.status, 201, data.message);
  return data;
}

async function connect(baseUrl, token) {
  const socket = createClient(baseUrl, { auth: { token }, reconnection: false, timeout: timeoutMs });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '5gllab-test-'));
  process.env.NODE_ENV = 'production';
  assert.throws(() => createLabServer({ dataDir, professorKey: '', studentKey: '' }), /PROFESSOR_ENROLLMENT_KEY/);
  process.env.NODE_ENV = 'test';
  console.log('PASS: production startup rejects missing enrollment secrets.');
  const service = createLabServer({
    port: 0, dataDir, professorKey: 'professor-test-key', studentKey: 'student-test-key',
    adminKey: 'admin-test-key', maxStudents: 3,
  });
  const sockets = [];
  await new Promise((resolve) => service.httpServer.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${service.httpServer.address().port}`;

  try {
    const professor = await register(baseUrl, 'professor', 'one');
    const studentA = await register(baseUrl, 'student', 'one');
    const studentB = await register(baseUrl, 'student', 'two');
    const studentC = await register(baseUrl, 'student', 'three');
    const studentD = await register(baseUrl, 'student', 'four');
    const professorB = await register(baseUrl, 'professor', 'two');
    const outsider = await register(baseUrl, 'student', 'outsider');

    const deviceRegistered = await jsonRequest(baseUrl, '/api/auth/devices/register', {
      method: 'POST', token: studentA.token,
      body: { deviceId: 'student-one-second-device', deviceName: 'Second test browser', password: 'correct-horse-battery-staple' },
    });
    assert.equal(deviceRegistered.response.status, 200, 'account owner can register another device after password verification');
    const secondDeviceLogin = await jsonRequest(baseUrl, '/api/auth/login', {
      method: 'POST', body: { email: 'student-one@example.test', password: 'correct-horse-battery-staple', deviceId: 'student-one-second-device' },
    });
    assert.equal(secondDeviceLogin.response.status, 200, 'registered second device can sign in');

    const invalidKey = await jsonRequest(baseUrl, '/api/auth/register', {
      method: 'POST', body: {
        email: 'bad@example.test', displayName: 'Bad', password: 'correct-horse-battery-staple',
        role: 'professor', deviceId: 'device-bad', enrollmentKey: 'wrong',
      },
    });
    assert.equal(invalidKey.response.status, 403, 'invalid enrollment key must be denied');

    const wrongDevice = await jsonRequest(baseUrl, '/api/auth/login', {
      method: 'POST', body: {
        email: 'student-one@example.test', password: 'correct-horse-battery-staple', deviceId: 'not-registered',
      },
    });
    assert.equal(wrongDevice.response.status, 403, 'unregistered device must be denied');

    const noAuth = await jsonRequest(baseUrl, '/api/sessions', { method: 'POST' });
    assert.equal(noAuth.response.status, 401, 'session creation requires auth');
    const studentCreate = await jsonRequest(baseUrl, '/api/sessions', { method: 'POST', token: studentA.token });
    assert.equal(studentCreate.response.status, 403, 'student cannot create a session');

    const created = await jsonRequest(baseUrl, '/api/sessions', { method: 'POST', token: professor.token });
    assert.equal(created.response.status, 201, created.data.message);
    const code = created.data.session.code;
    assert.equal(code.length, 32, 'session code should carry 128 bits of CSPRNG entropy');

    const professorSocket = await connect(baseUrl, professor.token); sockets.push(professorSocket);
    let studentSocketA = await connect(baseUrl, studentA.token); sockets.push(studentSocketA);
    const studentSocketB = await connect(baseUrl, studentB.token); sockets.push(studentSocketB);
    const studentSocketC = await connect(baseUrl, studentC.token); sockets.push(studentSocketC);

    const profJoined = waitFor(professorSocket, 'session-joined');
    professorSocket.emit('join-session', { code });
    await profJoined;
    const studentJoinedA = waitFor(studentSocketA, 'session-joined');
    studentSocketA.emit('join-session', { code });
    await studentJoinedA;
    const studentJoinedB = waitFor(studentSocketB, 'session-joined');
    studentSocketB.emit('join-session', { code });
    await studentJoinedB;
    const studentJoinedC = waitFor(studentSocketC, 'session-joined');
    studentSocketC.emit('join-session', { code });
    await studentJoinedC;
    assert.equal(service.sessions.get(code).participants.size, 4, 'professor and three students should be present');
    const studentDApiJoin = await jsonRequest(baseUrl, '/api/sessions/join', { method: 'POST', token: studentD.token, body: { code } });
    assert.equal(studentDApiJoin.response.status, 409, 'fourth student should be rejected by REST capacity check');
    console.log('PASS: authenticated professor and three students joined; participant capacity is enforced.');

    const createdOnA = waitFor(studentSocketA, 'snapshot:created');
    const createdOnB = waitFor(studentSocketB, 'snapshot:created');
    professorSocket.emit('snapshot:create', {
      data: { image: 'data:image/png;base64,aGVsbG8=', annotations: [] },
      metadata: { source: 'integration-test' },
    });
    const [eventA, eventB] = await Promise.all([createdOnA, createdOnB]);
    assert.equal(eventA.snapshot.id, eventB.snapshot.id);
    const snapshotId = eventA.snapshot.id;
    console.log('PASS: snapshot changes are broadcast to all session members.');

    const studentDenied = waitFor(studentSocketA, 'snapshot:error');
    studentSocketA.emit('snapshot:update', { snapshotId, data: { annotations: [] }, expectedVersion: 1 });
    assert.match((await studentDenied).message, /role|professor/i);
    console.log('PASS: server rejects student snapshot updates.');

    const profOffer = waitFor(professorSocket, 'webrtc-offer');
    const studentBShouldNotReceiveOffer = waitFor(studentSocketB, 'webrtc-offer').then(() => 'received');
    studentSocketA.emit('webrtc-offer', { targetSocketId: professorSocket.id, offer: { type: 'offer', sdp: 'test-sdp' } });
    const offer = await profOffer;
    assert.equal(offer.fromSocketId, studentSocketA.id);
    const noOffer = await Promise.race([studentBShouldNotReceiveOffer, new Promise((resolve) => setTimeout(() => resolve('not-received'), 250))]);
    assert.equal(noOffer, 'not-received', 'other students must not receive targeted signalling');

    const answerOnA = waitFor(studentSocketA, 'webrtc-answer');
    professorSocket.emit('webrtc-answer', { targetSocketId: studentSocketA.id, answer: { type: 'answer', sdp: 'answer-sdp' } });
    assert.equal((await answerOnA).fromSocketId, professorSocket.id);
    const candidateOnA = waitFor(studentSocketA, 'webrtc-ice-candidate');
    professorSocket.emit('webrtc-ice-candidate', { targetSocketId: studentSocketA.id, candidate: { candidate: 'candidate:test' } });
    assert.equal((await candidateOnA).fromSocketId, professorSocket.id);
    console.log('PASS: WebRTC offer, answer and ICE are routed to the intended peer only.');

    const metricsOnProfessor = waitFor(professorSocket, 'network:metrics:update');
    studentSocketA.emit('network:metrics', { metrics: { rttMs: 35, jitterMs: 4, packetLossPercent: 0.5, bitrateKbps: 900, fps: 25 } });
    assert.equal((await metricsOnProfessor).participantId, studentA.user.id);
    console.log('PASS: per-participant WebRTC metrics are relayed to the room.');

    const participantLeft = waitFor(professorSocket, 'participant-left', (event) => event.userId === studentA.user.id);
    studentSocketA.disconnect();
    await participantLeft;
    const reconnectedStudentA = await connect(baseUrl, studentA.token); sockets.push(reconnectedStudentA);
    const rejoined = waitFor(reconnectedStudentA, 'session-joined');
    reconnectedStudentA.emit('join-session', { code });
    const rejoinedData = await rejoined;
    assert.equal(rejoinedData.code, code);
    assert.equal(service.sessions.get(code).participants.size, 4, 'reconnected student must replace the stale socket');
    assert.equal(rejoinedData.participants.length, 3, 'reconnected student should see current session peers');
    studentSocketA = reconnectedStudentA;
    console.log('PASS: a registered participant can reconnect and rejoin without a ghost participant.');

    const outsiderSocket = await connect(baseUrl, outsider.token); sockets.push(outsiderSocket);
    const secondSession = await jsonRequest(baseUrl, '/api/sessions', { method: 'POST', token: professorB.token });
    assert.equal(secondSession.response.status, 201);
    const secondCode = secondSession.data.session.code;
    const secondProfessorSocket = await connect(baseUrl, professorB.token); sockets.push(secondProfessorSocket);
    const secondProfessorJoined = waitFor(secondProfessorSocket, 'session-joined');
    secondProfessorSocket.emit('join-session', { code: secondCode });
    await secondProfessorJoined;
    const outsiderJoined = waitFor(outsiderSocket, 'session-joined');
    outsiderSocket.emit('join-session', { code: secondCode });
    await outsiderJoined;

    const outsiderSnapshots = await jsonRequest(baseUrl, `/api/sessions/${code}/snapshots`, { token: outsider.token });
    assert.equal(outsiderSnapshots.response.status, 404, 'member of another session cannot read this session snapshots');
    const firstSessionEvent = waitFor(studentSocketA, 'snapshot:created');
    const outsiderMustNotReceive = waitFor(outsiderSocket, 'snapshot:created').then(() => 'received');
    professorSocket.emit('snapshot:create', { data: { image: 'data:image/png;base64,aGVsbG8=' }, metadata: {} });
    await firstSessionEvent;
    const crossRoomEvent = await Promise.race([outsiderMustNotReceive, new Promise((resolve) => setTimeout(() => resolve('not-received'), 250))]);
    assert.equal(crossRoomEvent, 'not-received', 'another session must not receive this room event');
    console.log('PASS: session membership isolation blocks cross-session REST reads and Socket.IO broadcasts.');

    const auditText = fs.readFileSync(service.auditFile, 'utf8');
    assert.match(auditText, /auth\.register/);
    assert.match(auditText, /authorization\.denied/);
    assert.doesNotMatch(auditText, /correct-horse-battery-staple|professor-test-key|student-test-key/);
    console.log('PASS: audit log records security events without passwords or enrollment keys.');

    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.status, 'ok');
    console.log('PASS: health endpoint returns OK.');

    const unauthenticatedProbe = await fetch(`${baseUrl}/api/mec/probe`);
    assert.equal(unauthenticatedProbe.status, 401, 'MEC probe requires authentication');
    const probe = await jsonRequest(baseUrl, '/api/mec/probe', { token: studentA.token });
    assert.equal(probe.response.status, 200);
    assert.equal(probe.response.headers.get('cache-control').includes('no-store'), true);
    assert.equal(probe.data.success, true);
    const upload = await fetch(`${baseUrl}/api/mec/upload`, { method: 'POST', headers: { Authorization: `Bearer ${studentA.token}`, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(4096) });
    assert.equal(upload.status, 200);
    assert.equal((await upload.json()).receivedBytes, 4096);
    const download = await fetch(`${baseUrl}/api/mec/download?bytes=2048`, { headers: { Authorization: `Bearer ${studentA.token}` } });
    assert.equal((await download.arrayBuffer()).byteLength, 2048);
    const unauthorizedBenchmark = await jsonRequest(baseUrl, '/api/benchmark/config', { token: studentA.token });
    assert.equal(unauthorizedBenchmark.response.status, 403, 'benchmark configuration is professor-only');
    const benchmarkConfig = await jsonRequest(baseUrl, '/api/benchmark/config', { token: professor.token });
    assert.equal(benchmarkConfig.response.status, 200);
    assert.deepEqual(benchmarkConfig.data, { mecConfigured: false }, 'benchmark configuration exposes only the MEC endpoint');
    console.log('PASS: authenticated bounded MEC probes/transfers and professor-only benchmark configuration.');

    const restarted = createLabServer({
      port: 0, dataDir, professorKey: 'professor-test-key', studentKey: 'student-test-key',
      adminKey: 'admin-test-key', maxStudents: 3,
    });
    const restoredSession = restarted.sessions.get(code);
    assert.ok(restoredSession, 'session metadata should survive a backend restart');
    assert.equal(restoredSession.members.has(studentA.user.id), true, 'session membership should survive a backend restart');
    assert.equal(restoredSession.snapshots.size, 2, 'snapshots should survive a backend restart');
    assert.equal(restoredSession.snapshotHistory.length, 2, 'snapshot history should survive a backend restart');
    assert.equal(restoredSession.participants.size, 0, 'live WebRTC participants must be cleared on restart');
    assert.equal(restarted.users.length, service.users.length, 'users should survive a backend restart');
    assert.equal(restarted.tokens.size, 0, 'process-memory auth tokens should be invalidated on restart');
    await new Promise((resolve) => restarted.io.close(resolve));
    console.log('PASS: users, session membership, snapshots and history persist; live participants and auth tokens are reset.');

    console.log('\nALL MODULE 5/6 BACKEND INTEGRATION TESTS PASSED.');
  } catch (error) {
    console.error('\nINTEGRATION TEST FAILED:', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => service.io.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main();
