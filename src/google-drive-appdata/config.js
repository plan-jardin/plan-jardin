// Configuration for the Google Drive appData module.
// See README.md for how to obtain these values in Google Cloud Console.
export default {
  // REQUIRED: OAuth 2.0 Client ID of type "Web application".
  // Its "Authorized JavaScript origins" must include the origin serving your app
  // (e.g. http://localhost:8080 for local development).
  clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',

  // Name of the JSON file stored in the hidden appDataFolder.
  fileName: 'appdata.json',

  // Delay (ms) after the last mutation before changes are written to Drive.
  saveDebounceMs: 1000,

  // Delay (ms) before retrying a failed save (network errors, 429, 5xx).
  retryDelayMs: 5000,

  // Initial contents used when no file exists yet in the user's appDataFolder.
  defaults: {},
};
