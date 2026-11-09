// The app's single instances: the Store (what the learner writes), the Library (what is built
// for them) and the Syncer between this device and the gist. Pages import these; nothing else
// holds application state at module level.

import { Store } from './store.js?v=d4943bd8ca';
import { Library } from './library.js?v=d4943bd8ca';
import { Syncer } from './sync.js?v=d4943bd8ca';

export const store = new Store();
export const library = new Library(store);
export const syncer = new Syncer(store, library);

store.onSave = () => syncer.schedule();
