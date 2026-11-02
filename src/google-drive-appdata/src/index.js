import { GoogleAuth, DRIVE_APPDATA_SCOPE } from './auth.js';
import { DriveAppDataFile, DriveError } from './drive.js';
import { createReactive } from './reactive.js';

export { GoogleAuth, DriveAppDataFile, DriveError, DRIVE_APPDATA_SCOPE, createReactive };

/**
 * Holds the app data object and keeps it in sync with a storage backend.
 * Events: 'saving', 'saved', 'error' (detail: Error).
 */
export class AppDataStore extends EventTarget {
  #raw;
  #file;
  #auth;
  #debounceMs;
  #retryDelayMs;
  #timer = null;
  #saving = null;
  #dirty = false;
  #closed = false;
  #onHide = () => {
    if (document.visibilityState === 'hidden') this.#flushOnUnload();
  };

  /** @type {object} The live data object. Mutate it freely; changes are saved automatically. */
  data;
  status = 'idle'; // 'idle' | 'pending' | 'saving' | 'error'
  lastError = null;

  constructor({ file, auth = null, initialData = {}, saveDebounceMs = 1000, retryDelayMs = 5000 }) {
    super();
    this.#file = file;
    this.#auth = auth;
    this.#raw = initialData;
    this.#debounceMs = saveDebounceMs;
    this.#retryDelayMs = retryDelayMs;
    this.data = createReactive(this.#raw, () => this.#markDirty());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.#onHide);
      globalThis.addEventListener?.('pagehide', this.#onHide);
    }
  }

  get hasUnsavedChanges() {
    return this.#dirty || this.#saving !== null;
  }

  /** Immediately writes pending changes. Resolves when everything is persisted. */
  async flush() {
    this.#clearTimer();
    while (this.#saving) await this.#saving.catch(() => {});
    if (!this.#dirty) return;
    this.#dirty = false;
    const json = JSON.stringify(this.#raw);
    this.#setStatus('saving');
    this.#saving = (async () => {
      try {
        await this.#file.write(json);
        this.lastError = null;
        this.#setStatus(this.#dirty ? 'pending' : 'idle');
        this.dispatchEvent(new Event('saved'));
      } catch (err) {
        this.#dirty = true;
        this.lastError = err;
        this.#setStatus('error');
        this.dispatchEvent(new CustomEvent('error', { detail: err }));
        if (!(err instanceof DriveError) || err.retryable) this.#schedule(this.#retryDelayMs);
        throw err;
      } finally {
        this.#saving = null;
      }
    })();
    await this.#saving;
    if (this.#dirty && !this.#timer) return this.flush();
  }

  /** Flushes pending changes and stops listening for page lifecycle events. */
  async close() {
    await this.flush();
    this.#closed = true;
    this.#clearTimer();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onHide);
      globalThis.removeEventListener?.('pagehide', this.#onHide);
    }
  }

  /** Flushes, closes and revokes the OAuth grant. */
  async signOut() {
    await this.close();
    await this.#auth?.signOut();
  }

  #markDirty() {
    this.#dirty = true;
    if (this.#closed) return;
    if (this.status !== 'saving') this.#setStatus('pending');
    this.#schedule(this.#debounceMs);
  }

  #schedule(ms) {
    if (this.#closed) return;
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.flush().catch(() => {}); // surfaced via 'error' event
    }, ms);
  }

  #clearTimer() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  // Best-effort save when the page is hidden/unloaded: keepalive fetch, no auth popups.
  #flushOnUnload() {
    if (!this.#dirty) return;
    this.#clearTimer();
    this.#dirty = false;
    this.#file.write(JSON.stringify(this.#raw), { keepalive: true }).catch(() => {
      this.#dirty = true;
      this.#schedule(this.#debounceMs);
    });
  }

  #setStatus(status) {
    this.status = status;
  }
}

/**
 * Signs the user in (Google Identity Services token flow, drive.appdata scope),
 * loads the app data file and returns an auto-saving AppDataStore.
 *
 * Call this from a user gesture (e.g. a click handler) the first time so the
 * consent popup is not blocked.
 */
export async function connectAppData({
  clientId,
  fileName = 'appdata.json',
  defaults = {},
  saveDebounceMs = 1000,
  retryDelayMs = 5000,
  loginHint,
} = {}) {
  const auth = new GoogleAuth({ clientId, loginHint });
  await auth.init();
  await auth.getToken();
  const file = new DriveAppDataFile(auth, fileName);
  const stored = await file.read();
  const initialData = stored ?? structuredClone(defaults);
  return new AppDataStore({ file, auth, initialData, saveDebounceMs, retryDelayMs });
}
