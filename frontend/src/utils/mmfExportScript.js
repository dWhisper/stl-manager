// Pasted into the browser console on myminifactory.com. It reads the same data
// the Library page loads, in the user's own logged-in session, and downloads it
// as one file for the Purchases page to import. MMF's API has no endpoint for
// any of this, and its site blocks requests that don't come from a browser.
export const MMF_EXPORT_SCRIPT = `(async () => {
  if (!/(^|\\.)myminifactory\\.com$/.test(location.hostname)) {
    console.error('Run this on www.myminifactory.com while logged in.');
    return;
  }
  const base = location.origin;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function get(url) {
    for (let attempt = 1; ; attempt++) {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
      if (r.ok) return r.json();
      if (attempt >= 3 || (r.status < 500 && r.status !== 429)) throw new Error(r.status + ' ' + url);
      await sleep(2000 * attempt);
    }
  }

  // Every page of a list, one request at a time
  async function all(url) {
    const items = [];
    for (let page = 1; page <= 200; page++) {
      const d = await get(url + (url.includes('?') ? '&' : '?') + 'page=' + page);
      const list = Array.isArray(d.items) ? d.items : Object.values(d.items || {});
      items.push(...list);
      await sleep(300);
      if (!list.length || items.length >= (Number(d.total_count) || 0)) break;
    }
    return items;
  }

  const out = new Map();
  const add = (objects, source) => {
    for (const o of objects) if (o && o.id != null && !out.has(o.id)) out.set(o.id, { ...o, _source: source });
  };

  console.log('MMF export: purchases…');
  add(await all(base + '/data-library/purchases'), 'Purchases');

  const groups = [];
  console.log('MMF export: campaigns, tribes and shared libraries…');
  for (const c of await all(base + '/data-library/campaigns'))
    for (const g of (c.pledges && c.pledges.items) || []) groups.push({ g, source: 'Campaign: ' + c.name });
  for (const t of await all(base + '/data-library/tribes'))
    for (const g of (t.groups && t.groups.items) || []) groups.push({ g, source: 'Tribe: ' + t.name });
  for (const u of await all(base + '/data-library/shared'))
    for (const g of (u.groups && u.groups.items) || []) groups.push({ g, source: 'Shared by ' + u.name });

  // "All" entries repeat the groups beside them
  const real = groups.filter(({ g }) => !String(g.id).startsWith('all/'));
  const failures = [], empty = [];
  for (let i = 0; i < real.length; i++) {
    const { g, source } = real[i];
    const url = (g.apis && g.apis.getObjects && g.apis.getObjects.url) || base + '/data-library/group/' + encodeURIComponent(g.id);
    try {
      const objects = await all(url);
      if (!objects.length) empty.push(source + ' · ' + g.name);
      add(objects, source + ' · ' + g.name);
    } catch (e) {
      failures.push({ group: source + ' · ' + g.name, error: e.message });
    }
    if ((i + 1) % 10 === 0 || i === real.length - 1) console.log('MMF export: group ' + (i + 1) + '/' + real.length + ', ' + out.size + ' items');
  }

  const file = { total_count: out.size, items: [...out.values()], export: { at: new Date().toISOString(), groups: real.length, failures, empty } };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  a.download = 'mmf-library.json';
  a.click();
  console.log('MMF export: saved mmf-library.json with ' + out.size + ' items. ' + failures.length + ' groups failed, ' + empty.length + ' were empty.');
  if (failures.length) console.table(failures);
})();`;
