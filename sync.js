// Cross-device sync of the learner's progress: pull their document from the gist, merge it with
// this device's copy (core.mergeDocs: every entry carries a timestamp, the newer one wins) and
// push the result. The same pass picks up the teacher's essay feedback and the advisor's reports,
// which only the Mac writes. gist.js is the GitHub API client; the token stays on each device.

import * as core from './core.js?v=d4943bd8ca';
import * as gist from './gist.js?v=d4943bd8ca';

const SYNC_DELAY_MS = 4000;
export const PULL_EVERY_MS = 60000;

export class Syncer {
  constructor(store, library) {
    this.store = store;
    this.library = library;
    this.timer = null;
    this.running = null; // the in-flight sync, so concurrent callers share it
    this.onFeedback = () => {}; // set by the app: new teacher feedback arrived
    this.onError = (err) => {}; // set by the app: a manual sync failed
  }

  get config() { return gist.loadConfig(); }
  get connected() { const c = this.config; return Boolean(c.token && c.gistId); }

  // Push soon after a change, coalescing bursts of answers.
  schedule() {
    if (!this.config.gistId) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.now(), SYNC_DELAY_MS);
  }

  // Pull, merge and push. Resolves true when the merge changed this device's data.
  now({ manual = false } = {}) {
    const cfg = this.config;
    const { store, library } = this;
    if (!cfg.token || !cfg.gistId || !store.me) return Promise.resolve(false);
    if (this.running) return this.running;
    const slug = store.slug;
    const file = gist.fileFor(slug);
    clearTimeout(this.timer);
    this.running = (async () => {
      try {
        const before = core.syncDoc(store.state);
        const files = await gist.readMany(cfg.token, cfg.gistId, [file, gist.feedbackFor(slug), gist.advisorFor(slug)]);
        if (store.slug !== slug) return false; // the profile was switched meanwhile
        const fb = files[gist.feedbackFor(slug)];
        if (fb && typeof fb === 'object' && !core.sameDoc(fb, library.feedback)) {
          library.setFeedback(slug, fb);
          this.onFeedback();
        }
        const adv = files[gist.advisorFor(slug)];
        if (adv && typeof adv === 'object' && !core.sameDoc(adv, library.advisor)) library.setAdvisor(slug, adv);
        const raw = files[file];
        const remote = raw ? core.syncDoc(core.migrateState(raw)) : null;
        // Merge again with the live state: answers given while the request was in flight must not be lost.
        const merged = core.mergeDocs(remote ? core.mergeDocs(before, remote) : before, core.syncDoc(store.state));
        store.merge(merged);
        if (!remote || !core.sameDoc(merged, remote)) await gist.write(cfg.token, cfg.gistId, file, merged);
        store.dirty = false;
        gist.saveConfig({ ...gist.loadConfig(), last: Date.now(), error: '' });
        return !core.sameDoc(merged, before);
      } catch (err) {
        if (gist.loadConfig().token) gist.saveConfig({ ...gist.loadConfig(), error: err.message });
        if (manual) this.onError(err);
        return false;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  // Push unsynced changes if there are any (before switching profiles or when the page hides).
  flush() { return this.store.dirty ? this.now() : Promise.resolve(false); }

  // Check the token, find or create the progress gist, and do a first sync.
  async connect(token) {
    const login = await gist.whoAmI(token);
    const gistId = await gist.findOrCreateGist(token, gist.fileFor(this.store.slug), core.syncDoc(this.store.state));
    gist.saveConfig({ token, gistId, login });
    await this.now({ manual: true });
  }

  disconnect() { gist.clearConfig(); }
}
