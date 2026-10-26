import { Router } from 'express';
import fs from 'fs';
import { KINDS, getGroups, getDecisions, setDecision, clearDecision, summary } from '../services/dedupeStore.js';
import { planActions, buildScript } from '../services/dedupeScript.js';

const router = Router();

const STL_ROOT = process.env.STL_ROOT || '/nas';
const HOST_ROOT = process.env.DEDUPE_HOST_ROOT || '/volume1/3D Files';
const MAX_LIMIT = 100;

function findGroup(signature) {
  const g = getGroups();
  for (const k of KINDS) {
    const hit = g[k].find(x => x.signature === signature);
    if (hit) return hit;
  }
  return null;
}

// Positive integer from a query string, or the fallback
function intParam(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

router.get('/summary', (req, res) => {
  res.json(summary());
});

router.get('/groups', (req, res) => {
  const { kind, decided = 'undecided' } = req.query;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` });
  if (!['undecided', 'decided', 'all'].includes(decided)) return res.status(400).json({ error: 'decided must be undecided, decided or all' });
  const page = intParam(req.query.page, 1);
  const limit = Math.min(intParam(req.query.limit, 25), MAX_LIMIT);

  const decisions = getDecisions();
  const all = getGroups()[kind]
    .map(g => ({ ...g, decision: decisions.get(g.signature) ?? null }))
    .filter(g => decided === 'all' || (decided === 'decided') === (g.decision !== null));
  res.json({ groups: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit });
});

router.put('/decisions/:signature', (req, res) => {
  const { action, keeper_path } = req.body ?? {};
  if (action !== 'keep' && action !== 'not_duplicate') return res.status(400).json({ error: "action must be 'keep' or 'not_duplicate'" });
  const group = findGroup(req.params.signature);
  if (!group) return res.status(400).json({ error: 'Unknown group' });
  const members = group.members.map(m => m.path);
  if (action === 'keep' && !members.includes(keeper_path)) return res.status(400).json({ error: 'keeper_path must be a member of the group' });
  setDecision(group.signature, {
    kind: group.kind, action, keeper_path: action === 'keep' ? keeper_path : null, members,
  });
  res.json({ ok: true });
});

router.delete('/decisions/:signature', (req, res) => {
  clearDecision(req.params.signature);
  res.json({ ok: true });
});

router.get('/script', (req, res) => {
  const mode = req.query.mode ?? 'mv';
  if (mode !== 'mv' && mode !== 'rm') return res.status(400).json({ error: "mode must be 'mv' or 'rm'" });
  const g = getGroups();
  const zipSize = (real) => {
    try { return fs.statSync(real).size; } catch { return null; }
  };
  const plan = planActions(KINDS.flatMap(k => g[k]), getDecisions(), { stlRoot: STL_ROOT, hostRoot: HOST_ROOT, zipSize });
  const script = buildScript(plan, { mode, hostRoot: HOST_ROOT });
  res.set({
    'Content-Type': 'text/x-shellscript; charset=utf-8',
    'Content-Disposition': `attachment; filename="dedupe-${mode}.sh"`,
  });
  res.send(script);
});

export default router;
