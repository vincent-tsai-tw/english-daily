// Navigation hooks. Pages ask the app to re-render the current route through here, so no page
// module needs to import app.js (which would be a cycle).

let handler = async () => {};

export const onRoute = (fn) => { handler = fn; };
export const rerender = () => handler();
export const go = (hash) => { location.hash = hash; };
