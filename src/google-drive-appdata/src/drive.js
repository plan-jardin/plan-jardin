// Minimal Drive REST v3 client for a single JSON file in the hidden appDataFolder.

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

export class DriveError extends Error {
  constructor(status, body) {
    super(`Drive API request failed (${status}): ${body}`);
    this.name = 'DriveError';
    this.status = status;
  }

  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

export class DriveAppDataFile {
  #auth;
  #fileName;
  #fileId = null;

  constructor(auth, fileName) {
    this.#auth = auth;
    this.#fileName = fileName;
  }

  /** Reads and parses the file. Returns undefined if it does not exist yet. */
  async read() {
    const id = await this.#findFileId();
    if (!id) return undefined;
    const res = await this.#fetch(`${FILES_URL}/${id}?alt=media`);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  /**
   * Writes a JSON string. With `keepalive`, only a cached token is used (no popup)
   * so the request can outlive the page during unload.
   */
  async write(json, { keepalive = false } = {}) {
    if (this.#fileId === null) await this.#findFileId();
    if (this.#fileId) {
      await this.#fetch(
        `${UPLOAD_URL}/${this.#fileId}?uploadType=media&fields=id`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json, keepalive },
        { keepalive },
      );
      return;
    }
    const boundary = `appdata-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name: this.#fileName, parents: ['appDataFolder'], mimeType: 'application/json' });
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const res = await this.#fetch(
      `${UPLOAD_URL}?uploadType=multipart&fields=id`,
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body, keepalive },
      { keepalive },
    );
    this.#fileId = (await res.json()).id;
  }

  async #findFileId() {
    const name = this.#fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name = '${name}' and 'appDataFolder' in parents and trashed = false`,
      fields: 'files(id)',
      orderBy: 'modifiedTime desc',
      pageSize: '1',
    });
    const res = await this.#fetch(`${FILES_URL}?${params}`);
    const { files } = await res.json();
    this.#fileId = files?.[0]?.id ?? '';
    return this.#fileId;
  }

  async #fetch(url, init = {}, { keepalive = false, retryAuth = true } = {}) {
    const token = keepalive ? this.#auth.peekToken() : await this.#auth.getToken();
    if (!token) throw new Error('No valid access token available for background save');
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401 && retryAuth && !keepalive) {
      this.#auth.invalidate();
      return this.#fetch(url, init, { keepalive, retryAuth: false });
    }
    if (!res.ok) throw new DriveError(res.status, await res.text().catch(() => ''));
    return res;
  }
}
