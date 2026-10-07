// Offline tests for lead delivery and the admin panel API (no Groq needed).
// Run: npm run test:leads
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-leads-'));
process.env.LEADS_FILE = path.join(tmp, 'leads.json');
process.env.ADMIN_PASSWORD = 'correct horse battery staple';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const leadsHandler = require('../api/leads');
const sessionHandler = require('../api/admin/session');
const adminLeadsHandler = require('../api/admin/leads');
const { parseLeadInput } = require('../api/lib/lead-record');

let failures = 0;
function assert(cond, label, detail) {
  if (cond) console.log('  PASS ' + label);
  else {
    failures++;
    console.log('  FAIL ' + label + (detail ? ' :: ' + detail : ''));
  }
}

function call(handler, { method = 'POST', body, headers = {}, ip = '10.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.jsonBody = obj; resolve(this); },
      end() { resolve(this); },
    };
    const req = { method, headers: { 'x-forwarded-for': ip, ...headers }, socket: { remoteAddress: ip }, body };
    handler(req, res).catch((err) => {
      failures++;
      console.log('  FAIL handler threw: ' + err.message);
      resolve(res);
    });
  });
}

const CID = '3f2b8c1e-9a4d-4e57-8b21-0c6d5a7e1f90';
const goodLead = {
  cid: CID,
  name: 'Rajesh',
  phone: '+91 98765 43210',
  email: 'rajesh@example.com',
  projectType: 'Modular Interior',
  bhk: '2BHK',
  location: 'Kothrud, Pune',
  budget: '12 lakh',
  summary: 'Wants a modular interior.',
  summarizing: true,
  transcript: [
    { role: 'assistant', content: 'Hello!' },
    { role: 'user', content: 'I need interiors' },
  ],
};

async function login(password, ip) {
  const res = await call(sessionHandler, { body: { password }, ip });
  const cookie = res.headers['Set-Cookie'] ? String(res.headers['Set-Cookie']).split(';')[0] : '';
  return { res, cookie };
}

(async () => {
  console.log('\n[L1] Public lead endpoint validation');
  let r = await call(leadsHandler, { body: { ...goodLead, cid: 'short' } });
  assert(r.statusCode === 400, 'rejects a bad lead id', r.statusCode);
  r = await call(leadsHandler, { body: { ...goodLead, phone: '', email: '' } });
  assert(r.statusCode === 400, 'rejects a lead with no phone or email', r.statusCode);
  r = await call(leadsHandler, { body: 'nope' });
  assert(r.statusCode === 400, 'rejects a non-object body', r.statusCode);
  r = await call(leadsHandler, { method: 'GET' });
  assert(r.statusCode === 405, 'GET is not allowed (write-only endpoint)', r.statusCode);
  r = await call(leadsHandler, { method: 'OPTIONS' });
  assert(r.headers['Access-Control-Allow-Origin'] === '*', 'CORS preflight works for the widget');

  const clipped = parseLeadInput({ ...goodLead, name: 'A'.repeat(500), summary: 'x'.repeat(5000), status: 'closed', notes: 'hack' });
  assert(clipped.record.name.length === 80, 'name is length-capped');
  assert(clipped.record.summary.length === 1500, 'summary is length-capped');
  assert(clipped.record.status === undefined && clipped.record.notes === undefined, 'server-owned fields are never taken from the request');
  const junk = parseLeadInput({ ...goodLead, phone: '12', email: 'not-an-email' });
  assert(junk.error, 'invalid phone and email together are rejected', JSON.stringify(junk));
  const ctrl = parseLeadInput({ ...goodLead, name: 'Ra' + String.fromCharCode(0) + 'jesh' });
  assert(ctrl.record.name === 'Rajesh', 'control characters are stripped');
  const big = parseLeadInput({ ...goodLead, transcript: Array.from({ length: 400 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: 'm' + i })) });
  assert(big.record.transcript.length === 300 && big.record.transcript[299].content === 'm399', 'transcript keeps the latest 300 messages');
  const badRoles = parseLeadInput({ ...goodLead, transcript: [{ role: 'system', content: 'x' }, { role: 'user', content: 'ok' }] });
  assert(badRoles.record.transcript.length === 1, 'only user/assistant messages are kept');

  console.log('\n[L2] Save, update and merge');
  r = await call(leadsHandler, { body: goodLead });
  assert(r.statusCode === 200 && r.jsonBody.ok, 'a valid lead is saved', JSON.stringify(r.jsonBody));
  const { cookie } = await login(process.env.ADMIN_PASSWORD);
  assert(cookie.startsWith('ia_admin='), 'admin can sign in');

  let list = await call(adminLeadsHandler, { method: 'GET', headers: { cookie } });
  assert(list.statusCode === 200 && list.jsonBody.leads.length === 1, 'admin sees the saved lead');
  const saved = list.jsonBody.leads[0];
  assert(saved.name === 'Rajesh' && saved.phone === '+919876543210' && saved.location === 'Kothrud, Pune', 'fields stored correctly', JSON.stringify(saved));
  assert(saved.status === 'new' && saved.transcript.length === 2, 'new lead has status new and the transcript');

  r = await call(adminLeadsHandler, { method: 'PATCH', headers: { cookie }, body: { cid: CID, status: 'contacted', notes: 'Called at 5pm' } });
  assert(r.statusCode === 200 && r.jsonBody.lead.status === 'contacted', 'admin can change status and add notes');

  // the visitor's later sync (summary lands) must not reset the owner's work
  r = await call(leadsHandler, { body: { ...goodLead, summarizing: false, summary: 'Final summary.', name: '', transcript: [...goodLead.transcript, { role: 'assistant', content: 'Noted.' }] } });
  list = await call(adminLeadsHandler, { method: 'GET', headers: { cookie } });
  const after = list.jsonBody.leads[0];
  assert(list.jsonBody.leads.length === 1, 'same lead id updates in place (no duplicate)');
  assert(after.status === 'contacted' && after.notes === 'Called at 5pm', 'a later visitor sync keeps the owner status and notes');
  assert(after.name === 'Rajesh', 'a blank field never erases a known detail');
  assert(after.summary === 'Final summary.' && after.summarizing === false, 'summary update is applied');
  assert(after.transcript.length === 3, 'transcript grows with the conversation');

  const attacker = await call(leadsHandler, { body: { ...goodLead, status: 'closed', notes: 'owned' } });
  list = await call(adminLeadsHandler, { method: 'GET', headers: { cookie } });
  assert(list.jsonBody.leads[0].status === 'contacted' && list.jsonBody.leads[0].notes === 'Called at 5pm', 'public endpoint cannot set status or notes', attacker.statusCode);

  const CID2 = '11111111-2222-4333-8444-555555555555';
  await call(leadsHandler, { body: { ...goodLead, cid: CID2, name: 'Meera', phone: '9000000001', email: '' } });
  list = await call(adminLeadsHandler, { method: 'GET', headers: { cookie } });
  assert(list.jsonBody.leads.length === 2 && list.jsonBody.leads[0].cid === CID2, 'leads from different visitors are listed, newest first');

  console.log('\n[L3] Admin access control');
  r = await call(adminLeadsHandler, { method: 'GET' });
  assert(r.statusCode === 401, 'listing without a session is refused');
  r = await call(adminLeadsHandler, { method: 'PATCH', body: { cid: CID, status: 'closed' } });
  assert(r.statusCode === 401, 'editing without a session is refused');
  r = await call(adminLeadsHandler, { method: 'DELETE', body: { cid: CID } });
  assert(r.statusCode === 401, 'deleting without a session is refused');
  r = await call(adminLeadsHandler, { method: 'GET', headers: { cookie: 'ia_admin=9999999999.deadbeef' } });
  assert(r.statusCode === 401, 'a forged cookie is refused');
  r = await call(adminLeadsHandler, { method: 'GET', headers: { cookie: 'ia_admin=1.' + cookie.split('.')[1] } });
  assert(r.statusCode === 401, 'an expired cookie is refused');
  const bad = await login('wrong password', '10.0.0.9');
  assert(bad.res.statusCode === 401 && !bad.cookie, 'wrong password is refused with no cookie');
  const flags = String((await login(process.env.ADMIN_PASSWORD)).res.headers['Set-Cookie']);
  assert(/HttpOnly/.test(flags) && /SameSite=Strict/.test(flags), 'session cookie is HttpOnly and SameSite=Strict');
  const secure = await call(sessionHandler, { body: { password: process.env.ADMIN_PASSWORD }, headers: { 'x-forwarded-proto': 'https' } });
  assert(/; Secure/.test(String(secure.headers['Set-Cookie'])), 'cookie is Secure behind https');
  r = await call(sessionHandler, { method: 'GET', headers: { cookie } });
  assert(r.jsonBody.authed === true, 'session check reports signed in');
  r = await call(sessionHandler, { method: 'GET' });
  assert(r.jsonBody.authed === false, 'session check reports signed out without a cookie');

  let blocked;
  for (let i = 0; i < 9; i++) blocked = await call(sessionHandler, { body: { password: 'guess' + i }, ip: '10.9.9.9' });
  assert(blocked.statusCode === 429, 'repeated wrong passwords get rate limited', blocked.statusCode);
  const stillBlocked = await call(sessionHandler, { body: { password: process.env.ADMIN_PASSWORD }, ip: '10.9.9.9' });
  assert(stillBlocked.statusCode === 429, 'a blocked address cannot sign in even with the right password');

  const saveEnv = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'a different password';
  r = await call(adminLeadsHandler, { method: 'GET', headers: { cookie } });
  assert(r.statusCode === 401, 'changing the password signs existing sessions out');
  delete process.env.ADMIN_PASSWORD;
  r = await call(sessionHandler, { body: { password: '' } });
  assert(r.statusCode === 503, 'sign in is refused when no admin password is configured');
  process.env.ADMIN_PASSWORD = saveEnv;

  console.log('\n[L4] Admin edits and delete');
  r = await call(adminLeadsHandler, { method: 'PATCH', headers: { cookie }, body: { cid: CID, status: 'bogus' } });
  assert(r.statusCode === 400, 'invalid status is refused');
  r = await call(adminLeadsHandler, { method: 'PATCH', headers: { cookie }, body: { cid: '99999999-2222-4333-8444-555555555555', status: 'closed' } });
  assert(r.statusCode === 404, 'editing an unknown lead returns 404');
  r = await call(adminLeadsHandler, { method: 'DELETE', headers: { cookie }, body: { cid: CID2 } });
  list = await call(adminLeadsHandler, { method: 'GET', headers: { cookie } });
  assert(r.statusCode === 200 && list.jsonBody.leads.length === 1, 'admin can delete a lead');
  r = await call(adminLeadsHandler, { method: 'DELETE', headers: { cookie }, body: { cid: '../etc/passwd' } });
  assert(r.statusCode === 400, 'a malformed lead id is refused');

  console.log('\n[L5] Storage safety');
  const stored = JSON.parse(fs.readFileSync(process.env.LEADS_FILE, 'utf8'));
  assert(Object.keys(stored).length === 1, 'storage file holds the remaining lead');
  process.env.VERCEL = '1';
  const savedFile = process.env.LEADS_FILE;
  delete process.env.LEADS_FILE;
  r = await call(leadsHandler, { body: { ...goodLead, cid: '77777777-2222-4333-8444-555555555555' } });
  assert(r.statusCode === 503, 'on Vercel without Redis the lead endpoint reports storage not configured', r.statusCode);
  const unconfigured = await login(process.env.ADMIN_PASSWORD, '10.0.0.77');
  r = await call(adminLeadsHandler, { method: 'GET', headers: { cookie: unconfigured.cookie } });
  assert(r.statusCode === 503 && r.jsonBody.error === 'storage_not_configured', 'admin gets a clear storage_not_configured error');
  delete process.env.VERCEL;
  process.env.LEADS_FILE = savedFile;

  console.log('\n[L6] Redis storage adapter (mocked REST)');
  const realFetch = global.fetch;
  const redisData = new Map();
  global.fetch = async (url, opts) => {
    const cmd = JSON.parse(opts.body);
    const [op, , field, value] = cmd;
    let result = null;
    if (op === 'HSET') { redisData.set(field, value); result = 1; }
    else if (op === 'HGET') result = redisData.get(field) || null;
    else if (op === 'HDEL') { redisData.delete(field); result = 1; }
    else if (op === 'HGETALL') result = [...redisData.entries()].flat();
    return { ok: opts.headers.Authorization === 'Bearer tok', status: 200, json: async () => ({ result }) };
  };
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
  try {
    const rcid = '88888888-2222-4333-8444-555555555555';
    r = await call(leadsHandler, { body: { ...goodLead, cid: rcid } });
    assert(r.statusCode === 200 && redisData.has(rcid), 'lead is written to Redis when configured');
    const viaRedis = await call(adminLeadsHandler, { method: 'GET', headers: { cookie } });
    assert(viaRedis.jsonBody.storage === 'redis' && viaRedis.jsonBody.leads.some((l) => l.cid === rcid), 'admin reads leads back from Redis');
    r = await call(adminLeadsHandler, { method: 'DELETE', headers: { cookie }, body: { cid: rcid } });
    assert(r.statusCode === 200 && !redisData.has(rcid), 'delete removes it from Redis');
  } finally {
    global.fetch = realFetch;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + (failures === 0 ? 'ALL LEAD TESTS PASSED' : failures + ' LEAD TEST(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
