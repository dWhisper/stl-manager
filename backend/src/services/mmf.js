// MyMiniFactory REST API v2 — https://www.myminifactory.com/api-doc/
// Auth: ?key=api_key query param. The private endpoints (e.g. GET /user) need an
//       OAuth2 access token instead, so only key-capable endpoints are used here.

const BASE = 'https://www.myminifactory.com/api/v2';

async function req(username, apiKey, path, params = {}) {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
  const url = `${BASE}${path}?${qs}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    // Pass auth failures through as 401 so they aren't reported as a 502
    const status = res.status === 401 || res.status === 403 ? 401 : undefined;
    throw Object.assign(new Error(`MMF API ${res.status}: ${text}`), { status });
  }

  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getProfile(username, apiKey) {
  // GET /user needs OAuth2; the public profile accepts an API key and also verifies it
  return req(username, apiKey, `/users/${encodeURIComponent(username)}`);
}

export async function getUserObjects(username, apiKey, { page = 1, perPage = 24 } = {}) {
  // GET /users/{username}/objects — the user's own published objects
  return req(username, apiKey, `/users/${encodeURIComponent(username)}/objects`, {
    page,
    per_page: perPage,
  });
}

export async function getObject(objectId, username, apiKey) {
  return req(username, apiKey, `/objects/${encodeURIComponent(objectId)}`);
}

export async function searchObjects(query, username, apiKey, { page = 1, perPage = 24 } = {}) {
  return req(username, apiKey, '/search', {
    q: query,
    page,
    per_page: perPage,
  });
}
