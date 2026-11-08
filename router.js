// Hash routing as a table instead of an if/else chain. A pattern is '/'-separated segments:
// a literal must match, ':name' captures a segment, ':name?' an optional trailing one.

export const hashParts = (hash = location.hash) => hash.replace(/^#\/?/, '').split('/').filter(Boolean);

export class Router {
  constructor() { this.routes = []; }

  // `idle` marks pages with nothing half-typed: safe to re-render after a sync or reload for an update.
  add(pattern, handler, { tab = 'home', idle = false } = {}) {
    this.routes.push({ segs: pattern.split('/').filter(Boolean), handler, tab, idle });
    return this;
  }

  // The first route matching `parts`, with its captured params, or null.
  match(parts) {
    for (const r of this.routes) {
      if (parts.length > r.segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < r.segs.length && ok; i++) {
        const seg = r.segs[i];
        const part = parts[i];
        if (!seg.startsWith(':')) ok = seg === part;
        else if (part == null) ok = seg.endsWith('?');
        else params[seg.replace(/^:|\?$/g, '')] = part;
      }
      if (ok) return { handler: r.handler, tab: r.tab, idle: r.idle, params };
    }
    return null;
  }
}
