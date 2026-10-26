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

// The `release` field of /api/data-library/objectPreviews says how an object
// reached the library. Tribe releases are key:value pairs, e.g.
//   type:tribes-tier;owner:739175;tribe:41;tier:137;yearmonth:202610
//   type:welcome-pack;owner:758116;tribe:47;tierIds:[1086,1427,163]
// Other sources use a bare group id ("112697") or null, which give null here.
export function parseRelease(release) {
  if (typeof release !== 'string' || !release.includes(':')) return null;
  const out = {};
  for (const part of release.split(';')) {
    const [key, value = ''] = part.split(/:(.*)/s);
    if (value.startsWith('[')) out[key] = value.replace(/[[\]]/g, '').split(',').filter(Boolean).map(Number);
    else out[key] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return out;
}

// Download and purchase entries have no `release` key at all
const isPreview = (o) => o && o.originalId != null && 'libraryAddedAt' in o;

// The tribe release an object came from, out of all its preview entries (one
// per way it reached the library). A monthly tier drop names the tier; prefer it.
function tribeRelease(previews) {
  const tribes = previews.map((p) => parseRelease(p.release)).filter((r) => r?.tribe);
  return tribes.find((t) => t.tier) ?? tribes[0] ?? null;
}

const tribeIds = (r) => ({ tribeId: r?.tribe ?? null, tierId: r?.tier ?? r?.tierIds?.[0] ?? null });

// Purchases from a saved copy of the website's library data
// (https://www.myminifactory.com/data-library/purchases), which the API has no
// endpoint for. The format is undocumented, so fields are read defensively.
// Also takes /api/data-library/objectPreviews, saved alone or attached by the
// export script as `previews`: it lists every object with its tribe, but no
// files or links, so objects only found there come back with `partial` set.
// Returns { purchases, totalCount } where totalCount is what the page says the
// whole library holds, so the caller can tell if pages are missing.
export function parseLibraryExport(data) {
  const list = Array.isArray(data) ? data
    : Array.isArray(data?.items) ? data.items
    : data?.items && typeof data.items === 'object' ? Object.values(data.items)
    : [];
  const items = list.filter((o) => !isPreview(o));
  const previewsById = new Map();
  for (const p of [...list.filter(isPreview), ...(Array.isArray(data?.previews) ? data.previews : [])]) {
    const id = String(p.originalId);
    if (!previewsById.has(id)) previewsById.set(id, []);
    previewsById.get(id).push(p);
  }
  const totalCount = Math.max(Number(data?.total_count) || 0, previewsById.size) || null;
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
      ...tribeIds(tribeRelease(previewsById.get(String(o.id)) ?? [])),
    };
  });

  const have = new Set(purchases.map((p) => p.externalId));
  const months = (ym) => (ym ? ` · ${String(ym).slice(0, 4)}-${String(ym).slice(4)}` : '');
  for (const [id, previews] of previewsById) {
    if (have.has(id)) continue;
    const p = previews[0];
    const tribe = tribeRelease(previews);
    purchases.push({
      externalId:   id,
      name:         p.name,
      creator:      p.creatorName || p.creatorUsername || null,
      url:          `${base}/object/${id}`,
      downloadUrl:  null,
      thumbnailUrl: null,
      fileNames:    [],
      purchasedAt:  p.libraryAddedAt || null,
      source:       tribe ? `Tribe: ${p.creatorName}${months(tribe.yearmonth)}` : null,
      ...tribeIds(tribe),
      partial:      true,
    });
  }
  return { purchases, totalCount };
}

export async function searchObjects(query, username, apiKey, { page = 1, perPage = 24 } = {}) {
  return req(username, apiKey, '/search', {
    q: query,
    page,
    per_page: perPage,
  });
}
