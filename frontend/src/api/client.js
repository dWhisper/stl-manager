const BASE = '/api';

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  files: {
    list: (params) => req('GET', `/files?${new URLSearchParams(params)}`),
    get: (id) => req('GET', `/files/${id}`),
    patch: (id, body) => req('PATCH', `/files/${id}`, body),
    addTag: (id, tagId) => req('POST', `/files/${id}/tags`, { tagId }),
    removeTag: (id, tagId) => req('DELETE', `/files/${id}/tags/${tagId}`),
    stlUrl:   (id) => `${BASE}/files/${id}/stl`,
    // version busts the browser cache when a thumbnail is regenerated
    thumbUrl: (id, version) => `${BASE}/files/${id}/thumb${version ? `?v=${encodeURIComponent(version)}` : ''}`,
    generateThumbs: () => req('POST', '/files/thumbs/generate'),
  },
  tags: {
    list: () => req('GET', '/tags'),
    create: (body) => req('POST', '/tags', body),
    update: (id, body) => req('PATCH', `/tags/${id}`, body),
    delete: (id) => req('DELETE', `/tags/${id}`),
  },
  collections: {
    list: () => req('GET', '/collections'),
    create: (body) => req('POST', '/collections', body),
    update: (id, body) => req('PATCH', `/collections/${id}`, body),
    delete: (id) => req('DELETE', `/collections/${id}`),
    addFile: (id, fileId) => req('POST', `/collections/${id}/files`, { fileId }),
    removeFile: (id, fileId) => req('DELETE', `/collections/${id}/files/${fileId}`),
  },
  library: {
    folder: (path, params = {}) => req('GET', `/library/folder?${new URLSearchParams({ path, ...params })}`),
    model:  (path)              => req('GET', `/library/model?${new URLSearchParams({ path })}`),
    tree:   (path)              => req('GET', `/library/tree?${new URLSearchParams({ path })}`),
    find:   (q)                 => req('GET', `/library/find?${new URLSearchParams({ q })}`),
  },
  // Where a library folder or model came from
  links: {
    list:   (path)              => req('GET', `/links?${new URLSearchParams({ path })}`),
    create: (body)              => req('POST', '/links', body),
    update: (id, body)          => req('PATCH', `/links/${id}`, body),
    delete: (id)                => req('DELETE', `/links/${id}`),
  },
  // Purchases on a platform matched against the library
  reconcile: {
    get:     (platform)                   => req('GET',    `/reconcile/${platform}`),
    sync:    (platform)                   => req('POST',   `/reconcile/${platform}/sync`),
    import:  (platform, files)            => req('POST',   `/reconcile/${platform}/import`, { files }),
    link:    (platform, externalId, path) => req('POST',   `/reconcile/${platform}/${encodeURIComponent(externalId)}/link`, { path }),
    unlink:  (platform, externalId)       => req('DELETE', `/reconcile/${platform}/${encodeURIComponent(externalId)}/link`),
    reject:  (platform, externalId, path) => req('POST',   `/reconcile/${platform}/${encodeURIComponent(externalId)}/reject`, { path }),
    ignore:  (platform, externalId, ignored) => req('POST', `/reconcile/${platform}/${encodeURIComponent(externalId)}/ignore`, { ignored }),
  },
  // Duplicate groups, the user's decisions on them, and the cleanup script
  dedupe: {
    summary:   ()                => req('GET',    '/dedupe/summary'),
    groups:    (params)          => req('GET',    `/dedupe/groups?${new URLSearchParams(params)}`),
    decide:    (signature, body) => req('PUT',    `/dedupe/decisions/${encodeURIComponent(signature)}`, body),
    undecide:  (signature)       => req('DELETE', `/dedupe/decisions/${encodeURIComponent(signature)}`),
    scriptUrl: (mode)            => `${BASE}/dedupe/script?mode=${encodeURIComponent(mode)}`,
  },
  search: {
    query: (q) => req('GET', `/search?q=${encodeURIComponent(q)}`),
  },
  watcher: {
    status: () => req('GET', '/status'),
    reconcile: () => req('POST', '/reconcile'),
  },
  origins: {
    sources: () => req('GET', '/origins/sources'),
    create: (body) => req('POST', '/origins', body),
    update: (id, body) => req('PATCH', `/origins/${id}`, body),
    delete: (id) => req('DELETE', `/origins/${id}`),
  },
  integrations: {
    status: ()                    => req('GET',    '/integrations'),
    // Cults 3D
    cults: {
      connect:    (body)          => req('POST',   '/integrations/cults3d', body),
      disconnect: ()              => req('DELETE', '/integrations/cults3d'),
      forget:     ()              => req('DELETE', '/integrations/cults3d?forget=1'),
      profile:    ()              => req('GET',    '/integrations/cults3d/profile'),
      library:    (p = {})        => req('GET',    `/integrations/cults3d/library?${new URLSearchParams(p)}`),
      search:     (q, p = {})     => req('GET',    `/integrations/cults3d/search?q=${encodeURIComponent(q)}&${new URLSearchParams(p)}`),
      creation:   (slug)          => req('GET',    `/integrations/cults3d/creation/${encodeURIComponent(slug)}`),
    },
    // MyMiniFactory
    mmf: {
      connect:    (body)          => req('POST',   '/integrations/myminifactory', body),
      disconnect: ()              => req('DELETE', '/integrations/myminifactory'),
      forget:     ()              => req('DELETE', '/integrations/myminifactory?forget=1'),
      profile:    ()              => req('GET',    '/integrations/myminifactory/profile'),
      library:    (p = {})        => req('GET',    `/integrations/myminifactory/library?${new URLSearchParams(p)}`),
      search:     (q, p = {})     => req('GET',    `/integrations/myminifactory/search?q=${encodeURIComponent(q)}&${new URLSearchParams(p)}`),
      object:     (id)            => req('GET',    `/integrations/myminifactory/object/${encodeURIComponent(id)}`),
    },
  },
};
