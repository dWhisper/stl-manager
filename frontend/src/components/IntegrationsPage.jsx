import { useState } from 'react';
import { CheckCircle, Loader, ExternalLink, LogOut, User, RefreshCw } from 'lucide-react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';

// ── Shared styles ─────────────────────────────────────────────────────────────

const s = {
  page:    { flex: 1, overflowY: 'auto', padding: 28, display: 'flex', flexDirection: 'column', gap: 24 },
  heading: { fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 },
  sub:     { fontSize: 13, color: 'var(--text-dim)' },
  card:    {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
    borderBottom: '1px solid var(--border)', background: 'var(--surface2)',
  },
  platformName: { fontWeight: 700, fontSize: 15, flex: 1 },
  badge: (connected) => ({
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
    background: connected ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)',
    color: connected ? '#10b981' : 'var(--text-dim)',
    border: `1px solid ${connected ? '#10b98133' : 'var(--border)'}`,
  }),
  body:  { padding: 18 },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'block' },
  input: {
    width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 'var(--radius)', padding: '8px 10px',
    fontSize: 13, outline: 'none',
  },
  btn: (variant = 'primary') => ({
    padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none',
    cursor: 'pointer', fontSize: 13, fontWeight: 500,
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: variant === 'primary' ? 'var(--accent)' : variant === 'danger' ? '#7f1d1d' : 'var(--surface2)',
    color:      variant === 'primary' ? '#fff'          : variant === 'danger' ? '#fca5a5' : 'var(--text-dim)',
    border:     variant === 'ghost'   ? '1px solid var(--border)' : 'none',
  }),
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 },
  row:   { display: 'flex', gap: 8, alignItems: 'flex-start' },
  hint:  { fontSize: 11, color: 'var(--text-dim)', marginTop: 4 },
  error: { fontSize: 12, color: '#f87171', marginTop: 6 },
  profile: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
    borderBottom: '1px solid var(--border)', marginBottom: 14,
  },
  avatar: { width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', background: 'var(--surface2)', border: '1px solid var(--border)' },
  statRow: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 },
  stat: { display: 'flex', flexDirection: 'column', gap: 2 },
  statVal: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  statLbl: { fontSize: 11, color: 'var(--text-dim)' },
};

// ── Platform logos as SVG ─────────────────────────────────────────────────────

function CultsLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="6" fill="#e94f37"/>
      <text x="5" y="23" fontSize="18" fontWeight="900" fill="white">C</text>
    </svg>
  );
}

function MmfLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="6" fill="#00b0f0"/>
      <text x="4" y="23" fontSize="14" fontWeight="900" fill="white">MMF</text>
    </svg>
  );
}

// ── Connection form ───────────────────────────────────────────────────────────

function ConnectForm({ platform, onConnected }) {
  const [username, setUsername] = useState('');
  const [apiKey,   setApiKey]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const connect = api.integrations[platform === 'cults3d' ? 'cults' : 'mmf'].connect;
  const docsUrl = platform === 'cults3d'
    ? 'https://cults3d.com/en/api/keys'
    : 'https://www.myminifactory.com/settings/profile';

  async function submit(e) {
    e.preventDefault();
    if (!username.trim() || !apiKey.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await connect({ username: username.trim(), apiKey: apiKey.trim() });
      onConnected(res.profile);
    } catch (err) {
      setError(err.message.includes('401') || err.message.includes('errors')
        ? 'Invalid credentials — check your username and API key.'
        : err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={s.body}>
      <div style={s.field}>
        <label style={s.label}>Username</label>
        <input style={s.input} value={username} onChange={e => setUsername(e.target.value)} placeholder="your_username" autoComplete="off" />
      </div>
      <div style={s.field}>
        <label style={s.label}>API Key</label>
        <input style={s.input} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="••••••••••••••••" autoComplete="off" />
        <span style={s.hint}>
          Generate your API key at{' '}
          <a href={docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
            {docsUrl.replace('https://', '')} <ExternalLink size={10} style={{ display: 'inline' }} />
          </a>
        </span>
      </div>
      {error && <div style={s.error}>{error}</div>}
      <button type="submit" style={s.btn('primary')} disabled={loading}>
        {loading ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={13} />}
        {loading ? 'Connecting…' : 'Connect'}
      </button>
    </form>
  );
}

// ── Connected profile panel ───────────────────────────────────────────────────

function ProfilePanel({ platform, info, onDisconnect }) {
  const [refreshing, setRefreshing] = useState(false);
  const [profileData, setProfileData] = useState(info.profile);

  const isCults = platform === 'cults3d';
  const pfetch  = isCults ? api.integrations.cults.profile : api.integrations.mmf.profile;
  const pdel    = isCults ? api.integrations.cults.disconnect : api.integrations.mmf.disconnect;

  async function refresh() {
    setRefreshing(true);
    try { setProfileData(await pfetch()); } catch {} finally { setRefreshing(false); }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${platform === 'cults3d' ? 'Cults 3D' : 'MyMiniFactory'}?`)) return;
    await pdel();
    onDisconnect();
  }

  const name    = isCults ? profileData?.nick    : profileData?.name ?? profileData?.username;
  const avatar  = isCults ? profileData?.thumbnailUrl : profileData?.avatar?.thumbnail_url;
  const url     = isCults
    ? `https://cults3d.com/${profileData?.nick}`
    : `https://www.myminifactory.com/users/${info.username}`;

  return (
    <div style={s.body}>
      <div style={s.profile}>
        {avatar
          ? <img src={avatar} alt="" style={s.avatar} />
          : <div style={{ ...s.avatar, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={20} color="var(--text-dim)" /></div>}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{name ?? info.username}</div>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
            View profile <ExternalLink size={10} />
          </a>
        </div>
        <button style={s.btn('ghost')} onClick={refresh} disabled={refreshing} title="Refresh profile">
          <RefreshCw size={13} style={refreshing ? { animation: 'spin 1s linear infinite' } : {}} />
        </button>
      </div>

      {isCults && profileData && (
        <div style={s.statRow}>
          {profileData.viewsCount    != null && <div style={s.stat}><span style={s.statVal}>{profileData.viewsCount.toLocaleString()}</span><span style={s.statLbl}>Views</span></div>}
          {profileData.likesCount    != null && <div style={s.stat}><span style={s.statVal}>{profileData.likesCount.toLocaleString()}</span><span style={s.statLbl}>Likes</span></div>}
          {profileData.followersCount!= null && <div style={s.stat}><span style={s.statVal}>{profileData.followersCount.toLocaleString()}</span><span style={s.statLbl}>Followers</span></div>}
        </div>
      )}
      {!isCults && profileData && (
        <div style={s.statRow}>
          {profileData.things_collected != null && <div style={s.stat}><span style={s.statVal}>{profileData.things_collected}</span><span style={s.statLbl}>Collected</span></div>}
          {profileData.followers_count  != null && <div style={s.stat}><span style={s.statVal}>{profileData.followers_count}</span><span style={s.statLbl}>Followers</span></div>}
          {profileData.following_count  != null && <div style={s.stat}><span style={s.statVal}>{profileData.following_count}</span><span style={s.statLbl}>Following</span></div>}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button style={s.btn('danger')} onClick={disconnect}>
          <LogOut size={13} /> Disconnect
        </button>
      </div>
    </div>
  );
}

// ── Platform card ─────────────────────────────────────────────────────────────

function PlatformCard({ platformKey, label, Logo, info, refresh }) {
  const connected = info?.connected;
  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <Logo />
        <span style={s.platformName}>{label}</span>
        <span style={s.badge(connected)}>{connected ? 'Connected' : 'Not connected'}</span>
      </div>
      {connected
        ? <ProfilePanel platform={platformKey} info={info} onDisconnect={refresh} />
        : <ConnectForm  platform={platformKey} onConnected={refresh} />}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { data, refresh } = useApi(() => api.integrations.status());

  return (
    <div style={s.page}>
      <div>
        <div style={s.heading}>Platform Integrations</div>
        <div style={s.sub}>
          Connect your accounts to browse your library, search for models, and link local files to their source.
          All credentials are stored locally on your NAS and never leave your network.
        </div>
      </div>

      <PlatformCard
        platformKey="cults3d"
        label="Cults 3D"
        Logo={CultsLogo}
        info={data?.cults3d}
        refresh={refresh}
      />
      <PlatformCard
        platformKey="myminifactory"
        label="MyMiniFactory"
        Logo={MmfLogo}
        info={data?.myminifactory}
        refresh={refresh}
      />

      <div style={{ fontSize: 12, color: 'var(--text-dim)', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <strong>Note:</strong> Internet access is required for platform API calls. API keys are stored in plaintext
        in the local SQLite database. The Cults 3D API allows ~500 requests/day — library data is cached between visits.
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
