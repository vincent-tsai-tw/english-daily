// Loading the site's JSON files. A phone that has just woken up, a train in a tunnel or a
// service worker that is still starting can fail one request and answer the next, so a failed
// request is tried again a few times before the page hears about it. No DOM here: the fetch and
// the wait are parameters, so the retry rule is tested in Node (tests/net.test.mjs).

export const RETRY_DELAYS_MS = [400, 1200, 2500]; // waits before the second, third and fourth try

// The data could not be loaded although the address is right: worth trying again later.
export class LoadError extends Error {
  constructor(url, cause) {
    super('網路連線不穩，資料沒有載入。');
    this.name = 'LoadError';
    this.url = url;
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Fetch and parse one JSON file, always revalidated with the server. Tried again after a network
// failure, a server error (5xx, 429) or a body that is not JSON (a cut-off download); a missing
// file (4xx) fails at once with an ordinary Error, because asking again cannot help.
export async function getJSON(url, { fetchFn = fetch, wait = sleep, delays = RETRY_DELAYS_MS } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    let failure;
    try {
      const res = await fetchFn(url, { cache: 'no-cache' });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`讀取 ${url} 失敗（${res.status}）`), { final: true });
      failure = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err.final) throw err;
      failure = err;
    }
    if (attempt >= delays.length) throw new LoadError(url, failure);
    await wait(delays[attempt]);
  }
}
