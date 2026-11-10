import { useState } from 'react';
import './auth.css';

function getDeviceId() {
  const key = '5g-live-lab-device-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export default function AuthScreen({ serverUrl, onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '', role: 'student', enrollmentKey: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const update = (event) => setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = {
        email: form.email, password: form.password,
        deviceId: getDeviceId(), deviceName: navigator.userAgent.slice(0, 90),
        ...(mode === 'register' ? { displayName: form.displayName, role: form.role, enrollmentKey: form.enrollmentKey } : {}),
      };
      const response = await fetch(`${serverUrl}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Authentication failed.');
      sessionStorage.setItem('5g-live-lab-token', data.token);
      onAuthenticated({ token: data.token, user: data.user });
    } catch (error) {
      setMessage(error.message || 'Could not connect to the authentication service.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand"><span>5G</span><div><strong>Live Lab Assist</strong><small>Secure laboratory collaboration</small></div></div>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setMessage(''); }}>Sign in</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setMessage(''); }}>Register device</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <>
            <label>Full name<input name="displayName" value={form.displayName} onChange={update} autoComplete="name" required /></label>
            <label>Account role<select name="role" value={form.role} onChange={update}><option value="student">Student</option><option value="professor">Professor</option></select></label>
            <label>Enrollment key<input name="enrollmentKey" type="password" value={form.enrollmentKey} onChange={update} autoComplete="off" required /></label>
          </>}
          <label>Email<input name="email" type="email" value={form.email} onChange={update} autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" value={form.password} onChange={update} minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account and register this browser' : 'Sign in'}</button>
        </form>
        {message && <p className="auth-message" role="alert">{message}</p>}
        <p className="auth-footnote">This browser is registered as a device after signup. Accounts require a role-specific enrollment key. Use HTTPS when accessing the app outside localhost.</p>
      </section>
    </main>
  );
}
