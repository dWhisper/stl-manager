// MyMiniFactory REST API v2 — https://www.myminifactory.com/api-doc/
// Auth: HTTP Basic (username:api_key) for user-specific endpoints;
//       ?key=api_key query param also supported for public endpoints.

const BASE = 'https://www.myminifactory.com/api/v2';

function authHeader(username, apiKey) {
  return 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64');
}

async function req(username, apiKey, path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? '?' + qs : ''}`;

  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(username, apiKey),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`MMF API ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getProfile(username, apiKey) {
  // GET /user returns the authenticated user's private profile
  return req(username, apiKey, '/user');
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
