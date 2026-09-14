/**
 * Where the extension points and how it authenticates.
 *
 * The access token is stored in `chrome.storage.local` rather than synced
 * storage: it is a credential, and it should not travel between the user's
 * machines through the browser vendor.
 */
export const DEFAULTS = {
  baseUrl: 'http://localhost:3000',
};

export async function loadConfig() {
  const stored = await chrome.storage.local.get(['baseUrl', 'accessToken']);
  return {
    baseUrl: (stored.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ''),
    accessToken: stored.accessToken || null,
  };
}

export async function saveConfig(patch) {
  await chrome.storage.local.set(patch);
}

/** One place that knows the API shape, used by both the popup and the menu. */
export async function callApi(path, { method = 'POST', body } = {}) {
  const { baseUrl, accessToken } = await loadConfig();
  if (!accessToken) {
    throw new Error('Add your Cortex access token in the extension options first.');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-cortex-client': 'cortex-extension',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Cortex returned HTTP ${response.status}`);
  }
  return payload.data;
}
