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
    stlUrl: (id) => `${BASE}/files/${id}/stl`,
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
};
