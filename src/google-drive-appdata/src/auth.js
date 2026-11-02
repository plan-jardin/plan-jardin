// OAuth 2.0 via Google Identity Services (GIS) token model — Google's recommended
// flow for browser-only apps calling Google APIs. No client secret is used.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// Refresh the token slightly before it actually expires.
const EXPIRY_MARGIN_MS = 60_000;

let gisPromise;

export function loadGoogleIdentityServices() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisPromise = undefined;
      reject(new Error('Failed to load Google Identity Services'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

export class GoogleAuth {
  #clientId;
  #scope;
  #loginHint;
  #client = null;
  #token = null;
  #expiresAt = 0;
  #pending = null;
  #inflight = null;

  constructor({ clientId, scope = DRIVE_APPDATA_SCOPE, loginHint } = {}) {
    if (!clientId || clientId.startsWith('YOUR_CLIENT_ID')) {
      throw new Error('A Google OAuth clientId must be configured (see config.js).');
    }
    this.#clientId = clientId;
    this.#scope = scope;
    this.#loginHint = loginHint;
  }

  async init() {
    if (this.#client) return;
    await loadGoogleIdentityServices();
    this.#client = google.accounts.oauth2.initTokenClient({
      client_id: this.#clientId,
      scope: this.#scope,
      callback: (resp) => this.#onToken(resp),
      error_callback: (err) => this.#settle(null, new Error(`OAuth error: ${err?.type ?? 'unknown'}`)),
    });
  }

  /** Returns a valid access token, prompting the user only when necessary. */
  async getToken() {
    if (this.peekToken()) return this.#token;
    await this.init();
    // First grant shows the consent popup; later calls reuse the existing grant.
    return this.#request(this.#token === null ? 'consent' : '');
  }

  /** Cached token if still valid, otherwise null. Never prompts. */
  peekToken() {
    return this.#token && Date.now() < this.#expiresAt - EXPIRY_MARGIN_MS ? this.#token : null;
  }

  /** Mark the current token as unusable (e.g. after a 401). */
  invalidate() {
    this.#expiresAt = 0;
  }

  async signOut() {
    const token = this.#token;
    this.#token = null;
    this.#expiresAt = 0;
    if (token && globalThis.google?.accounts?.oauth2) {
      await new Promise((resolve) => google.accounts.oauth2.revoke(token, resolve));
    }
  }

  #request(prompt) {
    this.#inflight ??= new Promise((resolve, reject) => {
      this.#pending = { resolve, reject };
      this.#client.requestAccessToken({ prompt, login_hint: this.#loginHint });
    }).finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  #onToken(resp) {
    if (resp.error) {
      this.#settle(null, new Error(`OAuth error: ${resp.error} ${resp.error_description ?? ''}`.trim()));
      return;
    }
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, this.#scope)) {
      this.#settle(null, new Error(`The user did not grant the required scope: ${this.#scope}`));
      return;
    }
    this.#token = resp.access_token;
    this.#expiresAt = Date.now() + Number(resp.expires_in) * 1000;
    this.#settle(this.#token, null);
  }

  #settle(token, error) {
    const pending = this.#pending;
    this.#pending = null;
    if (!pending) return;
    if (error) pending.reject(error);
    else pending.resolve(token);
  }
}
