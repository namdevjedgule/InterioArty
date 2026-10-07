// Lead storage. Upstash Redis (REST) in production, a JSON file for local
// development. No npm dependencies: Redis is reached with plain fetch.
//
// Production: add the Upstash Redis integration from the Vercel Marketplace
// (it sets UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or the older
// KV_REST_API_URL and KV_REST_API_TOKEN, which are read too).
const fs = require('fs');
const path = require('path');

const HASH_KEY = 'interioarty:leads';

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

function filePath() {
  return process.env.LEADS_FILE || path.join(__dirname, '..', '..', '.data', 'leads.json');
}

// 'redis' | 'file' | 'none'. A serverless filesystem is ephemeral, so the file
// store is refused on Vercel unless LEADS_FILE is set explicitly.
function mode() {
  if (redisConfig()) return 'redis';
  if (process.env.VERCEL && !process.env.LEADS_FILE) return 'none';
  return 'file';
}

async function redis(command) {
  const cfg = redisConfig();
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || 'redis http ' + res.status);
  return data.result;
}

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeFile(map) {
  const fp = filePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(map, null, 2));
}

function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getLead(id) {
  const m = mode();
  if (m === 'redis') {
    const raw = await redis(['HGET', HASH_KEY, id]);
    return raw ? parse(raw) : null;
  }
  if (m === 'file') return readFile()[id] || null;
  throw new Error('storage_not_configured');
}

async function putLead(id, record) {
  const m = mode();
  if (m === 'redis') {
    await redis(['HSET', HASH_KEY, id, JSON.stringify(record)]);
    return;
  }
  if (m === 'file') {
    const map = readFile();
    map[id] = record;
    writeFile(map);
    return;
  }
  throw new Error('storage_not_configured');
}

async function listLeads() {
  const m = mode();
  let records = [];
  if (m === 'redis') {
    const flat = (await redis(['HGETALL', HASH_KEY])) || [];
    for (let i = 1; i < flat.length; i += 2) {
      const rec = parse(flat[i]);
      if (rec) records.push(rec);
    }
  } else if (m === 'file') {
    records = Object.values(readFile());
  } else {
    throw new Error('storage_not_configured');
  }
  return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function deleteLead(id) {
  const m = mode();
  if (m === 'redis') {
    await redis(['HDEL', HASH_KEY, id]);
    return;
  }
  if (m === 'file') {
    const map = readFile();
    delete map[id];
    writeFile(map);
    return;
  }
  throw new Error('storage_not_configured');
}

module.exports = { mode, getLead, putLead, listLeads, deleteLead };
