// The app's single instances: the Store (what the learner writes), the Library (what is built
// for them) and the Syncer between this device and the gist. Pages import these; nothing else
// holds application state at module level.

import { Store } from './store.js?v=f46691462d';
import { Library } from './library.js?v=f46691462d';
import { Syncer } from './sync.js?v=f46691462d';

export const store = new Store();
export const library = new Library(store);
export const syncer = new Syncer(store, library);

store.onSave = () => syncer.schedule();
