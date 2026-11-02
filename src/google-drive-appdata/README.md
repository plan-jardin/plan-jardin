# google-drive-appdata

Browser ES module that exposes a user's Google Drive **appDataFolder** as a single
JavaScript object. Any mutation (including nested objects/arrays) is automatically
saved to Drive (debounced). Designed for a single connected device: last write wins.

- **Auth:** Google Identity Services (GIS) OAuth 2.0 *token model* — Google's
  recommended flow for browser-only apps. No client secret is shipped.
- **Scope:** `https://www.googleapis.com/auth/drive.appdata` (hidden per-app folder only;
  the app cannot see the user's other files).
- **Storage:** one JSON file (default `appdata.json`) via Drive REST API v3.

## Google Cloud setup

1. In [Google Cloud Console](https://console.cloud.google.com/) create/select a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **Google Auth Platform → Branding / Audience**: configure the OAuth consent screen
   (add yourself as a test user while in *Testing*).
4. **Google Auth Platform → Data access**: add scope `.../auth/drive.appdata`.
5. **Clients → Create client** → type **Web application**. Under
   **Authorized JavaScript origins** add your app's origin(s), e.g. `http://localhost:8080`.
6. Copy the **Client ID** into [config.js](./config.js).

No API key is required: every Drive call is authorized with the user's OAuth access
token. No client secret is used or needed.

## Configuration ([config.js](./config.js))

| Key              | Required | Description                                                  |
| ---------------- | -------- | ------------------------------------------------------------ |
| `clientId`       | yes      | OAuth 2.0 Web client ID (`…apps.googleusercontent.com`).    |
| `fileName`       | no       | File name in appDataFolder. Default `appdata.json`.          |
| `saveDebounceMs` | no       | Wait after last mutation before saving. Default `1000`.      |
| `retryDelayMs`   | no       | Retry delay for network / 429 / 5xx failures. Default `5000`.|
| `defaults`       | no       | Initial data when no file exists yet.                        |

## Usage

```js
import config from './config.js';
import { connectAppData } from './src/index.js';

button.onclick = async () => {
  // Call from a user gesture the first time so the consent popup isn't blocked.
  const store = await connectAppData({ ...config, defaults: { settings: {} } });

  store.data.settings.theme = 'dark';      // auto-saved
  (store.data.items ??= []).push({ id: 1 }); // auto-saved
  delete store.data.obsolete;               // auto-saved

  store.addEventListener('saved', () => console.log('saved'));
  store.addEventListener('error', (e) => console.error(e.detail));

  await store.flush();   // force an immediate save
  await store.signOut(); // flush, stop syncing and revoke the grant
};
```

### `AppDataStore`

- `data` — the live object. Values must be JSON-serializable (plain objects,
  arrays, strings, numbers, booleans, `null`).
- `status` — `'idle' | 'pending' | 'saving' | 'error'`; `lastError`, `hasUnsavedChanges`.
- `flush()`, `close()`, `signOut()`.
- Events: `saved`, `error`.

When the page is hidden/unloaded, pending changes are sent with a `keepalive` fetch
(best effort; browsers limit keepalive bodies to ~64 KB).

Access tokens last about an hour. When one expires, a new one is requested with
`prompt: ''`. That usually needs no interaction, but the browser may still show a short popup.

## Example & tests

```sh
npm run example   # serves on http://localhost:8080 → open /example/
npm test          # unit tests (reactive proxy + save scheduling, no network)
```
