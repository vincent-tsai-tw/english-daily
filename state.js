// The app's single instances: the Store (what the learner writes), the Library (what is built
// for them) and the Syncer between this device and the gist. Pages import these; nothing else
// holds application state at module level.

import { Store } from './store.js?v=ec537f59b3';
import { Library } from './library.js?v=ec537f59b3';
import { Syncer } from './sync.js?v=ec537f59b3';

export const store = new Store();
export const library = new Library(store);
export const syncer = new Syncer(store, library);

store.onSave = () => syncer.schedule();
