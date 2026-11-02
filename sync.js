// Cross-device sync of learner progress through a secret GitHub gist. The token (classic, gist
// scope only) is kept in this browser under CONFIG_KEY and is never written into the gist.
// scripts/progress.py reads the same gist to adapt the daily lesson.

const API = 'https://api.github.com';
export const GIST_DESCRIPTION = 'english-daily progress';
export const GIST_FILE = 'english-daily-progress.json';
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

// Return the id of the progress gist, creating a secret one with `initial` content if needed.
export async function findOrCreateGist(token, initial) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await api(token, `/gists?per_page=100&page=${page}`);
    const hit = data.find((g) => g.description === GIST_DESCRIPTION && g.files?.[GIST_FILE]);
    if (hit) return hit.id;
    if (data.length < 100) break;
  }
  const { data } = await api(token, '/gists', {
    method: 'POST',
    body: { description: GIST_DESCRIPTION, public: false, files: { [GIST_FILE]: { content: JSON.stringify(initial) } } },
  });
  return data.id;
}

// Read the synced document; null when the gist has no progress file yet.
export async function read(token, id) {
  const { data } = await api(token, `/gists/${id}`);
  const file = data.files?.[GIST_FILE];
  if (!file) return null;
  let text = file.content;
  if (file.truncated) {
    const res = await fetch(file.raw_url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`讀取同步資料失敗（${res.status}）。`);
    text = await res.text();
  }
  try { return JSON.parse(text); } catch { throw new Error('同步資料格式錯誤。'); }
}

export async function write(token, id, doc) {
  await api(token, `/gists/${id}`, { method: 'PATCH', body: { files: { [GIST_FILE]: { content: JSON.stringify(doc) } } } });
}
