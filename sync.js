// Cross-device sync of learner progress through one secret GitHub gist, one file per learner
// (fileFor). The token (classic, gist scope only) is kept in this browser under CONFIG_KEY and is
// never written into the gist. scripts/gist_sync.py reads the same files to adapt daily lessons.

const API = 'https://api.github.com';
export const GIST_DESCRIPTION = 'english-daily progress';
export const fileFor = (slug) => `english-daily-progress-${slug}.json`; // as scripts/progress.py
export const feedbackFor = (slug) => `english-daily-feedback-${slug}.json`; // written only by the grading job
export const advisorFor = (slug) => `english-daily-advisor-${slug}.json`; // written only by the daily lesson job
export const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=English%20Daily%20sync';
const CONFIG_KEY = 'english-daily:sync';

export function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {}; } catch { return {}; }
}

export function saveConfig(config) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* storage blocked */ }
}

export function clearConfig() {
  try { localStorage.removeItem(CONFIG_KEY); } catch { /* storage blocked */ }
}

async function api(token, path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('連不上 GitHub，請確認網路後再試。');
  }
  if (res.status === 401) throw new Error('token 無效或已過期，請重新建立一個。');
  if (res.status === 403 || res.status === 404) throw new Error('token 沒有 gist 權限：建立時要勾選「gist」。');
  if (!res.ok) throw new Error(`GitHub 回應錯誤（${res.status}），稍後再試。`);
  return { data: await res.json(), headers: res.headers };
}

// Check the token and return the GitHub login it belongs to.
export async function whoAmI(token) {
  const { data, headers } = await api(token, '/user');
  const scopes = headers.get('X-OAuth-Scopes');
  if (scopes !== null && !scopes.split(',').map((s) => s.trim()).includes('gist')) {
    throw new Error('這個 token 沒有勾「gist」權限，請重新建立。');
  }
  return data.login;
}

// Return the id of the progress gist, creating a secret one with `initial` in `file` if needed.
export async function findOrCreateGist(token, file, initial) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await api(token, `/gists?per_page=100&page=${page}`);
    const hit = data.find((g) => g.description === GIST_DESCRIPTION);
    if (hit) return hit.id;
    if (data.length < 100) break;
  }
  const { data } = await api(token, '/gists', {
    method: 'POST',
    body: { description: GIST_DESCRIPTION, public: false, files: { [file]: { content: JSON.stringify(initial) } } },
  });
  return data.id;
}

// Read several files of the gist in one request: {file: document or null}.
export async function readMany(token, id, files) {
  const { data } = await api(token, `/gists/${id}`);
  const out = {};
  for (const file of files) {
    const entry = data.files?.[file];
    if (!entry) { out[file] = null; continue; }
    let text = entry.content;
    if (entry.truncated) {
      const res = await fetch(entry.raw_url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`讀取同步資料失敗（${res.status}）。`);
      text = await res.text();
    }
    try { out[file] = JSON.parse(text); } catch { throw new Error('同步資料格式錯誤。'); }
  }
  return out;
}

// Read one learner's synced document; null when the gist has no file for them yet.
export async function read(token, id, file) {
  return (await readMany(token, id, [file]))[file];
}

export async function write(token, id, file, doc) {
  await api(token, `/gists/${id}`, { method: 'PATCH', body: { files: { [file]: { content: JSON.stringify(doc) } } } });
}
