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

// Purchases from a saved copy of the website's library data
// (https://www.myminifactory.com/data-library/purchases), which the API has no
// endpoint for. The format is undocumented, so fields are read defensively.
// Returns { purchases, totalCount } where totalCount is what the page says the
// whole library holds, so the caller can tell if pages are missing.
export function parseLibraryExport(data) {
  const items = Array.isArray(data) ? data
    : Array.isArray(data?.items) ? data.items
    : data?.items && typeof data.items === 'object' ? Object.values(data.items)
    : [];
  const totalCount = Number(data?.total_count) || null;
  const base = 'https://www.myminifactory.com';
  const abs = (u) => (u && u.startsWith('/') ? base + u : u || null);
  const fileName = (p) => (p ?? '').split('/').pop();

  // Campaign, tribe and creator entries are containers of groups, not items
  const isItem = (o) => o && o.id != null && o.name && !o.pledges && !o.groups && o.document_name_s !== 'campaign';
  const purchases = items.filter(isItem).map((o) => {
    const files = Array.isArray(o.files?.items) ? o.files.items : Array.isArray(o.files) ? o.files : [];
    const archives = Array.isArray(o.archives) ? o.archives : [];
    return {
      externalId:   String(o.id),
      name:         o.name,
      creator:      o.user_name || o.username || o.designer?.name || null,
      url:          abs(o.absolute_url || o.url || o.show_url) || `${base}/object/${o.id}`,
      // Items with several archives have one link each and none for the whole item
      downloadUrl:  abs(o.archive_download_url || o.download_url || (archives.length === 1 ? archives[0].download_url : null)),
      thumbnailUrl: abs(o.obj_img || o.images?.[0]?.thumbnail?.url || o.images?.[0]?.original?.url),
      fileNames:    [...files.map((f) => fileName(f.filename)), ...archives.map((a) => fileName(a.path))].filter(Boolean),
      purchasedAt:  o.purchase_date || o.purchased_at || null,
      // Where in the MMF library it came from, added by the export script
      source:       o._source ?? null,
    };
  });
  return { purchases, totalCount };
}

export async function searchObjects(query, username, apiKey, { page = 1, perPage = 24 } = {}) {
  return req(username, apiKey, '/search', {
    q: query,
    page,
    per_page: perPage,
  });
}
