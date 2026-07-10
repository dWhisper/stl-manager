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
    thumbUrl: (id) => `${BASE}/files/${id}/thumb`,
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
      profile:    ()              => req('GET',    '/integrations/cults3d/profile'),
      library:    (p = {})        => req('GET',    `/integrations/cults3d/library?${new URLSearchParams(p)}`),
      search:     (q, p = {})     => req('GET',    `/integrations/cults3d/search?q=${encodeURIComponent(q)}&${new URLSearchParams(p)}`),
      creation:   (slug)          => req('GET',    `/integrations/cults3d/creation/${encodeURIComponent(slug)}`),
    },
    // MyMiniFactory
    mmf: {
      connect:    (body)          => req('POST',   '/integrations/myminifactory', body),
      disconnect: ()              => req('DELETE', '/integrations/myminifactory'),
      profile:    ()              => req('GET',    '/integrations/myminifactory/profile'),
      library:    (p = {})        => req('GET',    `/integrations/myminifactory/library?${new URLSearchParams(p)}`),
      search:     (q, p = {})     => req('GET',    `/integrations/myminifactory/search?q=${encodeURIComponent(q)}&${new URLSearchParams(p)}`),
      object:     (id)            => req('GET',    `/integrations/myminifactory/object/${encodeURIComponent(id)}`),
    },
  },
};
