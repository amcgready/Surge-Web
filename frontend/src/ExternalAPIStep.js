import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { serviceMeta } from './AdditionalServicesStep';
import { mediaServerMeta } from './mediaServerMeta';

// Curated Gluetun provider catalogue. The full list is bigger (qdm12's
// gluetun-wiki has ~30 providers) — these are the popular ones we
// surface as a dropdown. Picking 'custom' falls back to free-text +
// shows both transport options.
//
// `wireguard`/`openvpn` flags express which transports the provider
// supports through Gluetun specifically; not whether the provider
// itself supports the protocol. NordVPN, for example, supports
// WireGuard natively (NordLynx) but Gluetun's NordVPN integration
// only ships OpenVPN — so we mark wireguard:false here.
//
// Source: https://github.com/qdm12/gluetun-wiki/tree/main/setup/providers
export const VPN_PROVIDERS = [
  { value: '',           label: '— select provider —', wireguard: false, openvpn: false },
  { value: 'mullvad',    label: 'Mullvad',             wireguard: true,  openvpn: true  },
  { value: 'protonvpn',  label: 'ProtonVPN',           wireguard: true,  openvpn: true  },
  { value: 'nordvpn',    label: 'NordVPN',             wireguard: false, openvpn: true  },
  { value: 'airvpn',     label: 'AirVPN',              wireguard: true,  openvpn: false },
  { value: 'private internet access', label: 'PIA',    wireguard: true,  openvpn: true  },
  { value: 'surfshark',  label: 'Surfshark',           wireguard: true,  openvpn: true  },
  { value: 'windscribe', label: 'Windscribe',          wireguard: true,  openvpn: true  },
  { value: 'ivpn',       label: 'IVPN',                wireguard: true,  openvpn: true  },
  { value: 'custom',     label: 'Other (custom)',      wireguard: true,  openvpn: true  },
];

// Look up a provider's capabilities. Falls back to "both supported"
// when the provider is unknown (e.g. a value imported from an older
// settings file that named a provider we since removed).
export function getProviderCaps(value) {
  return VPN_PROVIDERS.find((p) => p.value === value)
    || { wireguard: true, openvpn: true };
}

// Compute, for each External APIs config key, the list of services that
// would consume it via fromConfig markers or ${configKey} substitutions
// in any compose.env / fetchScript.env / postDeployScript.env / files.
// Walked once at module load (the schema is static) so render is cheap.
const API_KEY_CONSUMERS = (() => {
  const out = {};
  const allMeta = { ...serviceMeta, ...mediaServerMeta };

  const walkMarker = (marker, refSet) => {
    if (!marker || typeof marker !== 'object') return;
    if (typeof marker.fromConfig === 'string') refSet.add(marker.fromConfig);
    for (const wrap of ['whenService', 'whenMediaServer']) {
      if (wrap in marker) {
        const inner = { ...marker };
        delete inner[wrap];
        walkMarker(inner, refSet);
      }
    }
  };
  const walkEnv = (env, refSet) => {
    if (!env) return;
    Object.values(env).forEach((m) => walkMarker(m, refSet));
  };

  for (const [key, meta] of Object.entries(allMeta)) {
    const c = meta.compose;
    if (!c) continue;
    const refs = new Set();
    walkEnv(c.env, refs);
    walkEnv(c.fetchScript?.env, refs);
    walkEnv(c.postDeployScript?.env, refs);
    if (c.services) {
      for (const sub of Object.values(c.services)) walkEnv(sub.env, refs);
    }
    if (c.files) {
      for (const f of Object.values(c.files)) {
        if (typeof f.content !== 'string') continue;
        const matches = f.content.matchAll(/\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g);
        for (const m of matches) refs.add(m[1]);
      }
    }
    for (const ref of refs) {
      if (!out[ref]) out[ref] = [];
      out[ref].push(meta.name || key);
    }
  }
  for (const v of Object.values(out)) v.sort();
  return out;
})();

// Small helper component rendered under each External APIs input.
function UsedByLabel({ configKey }) {
  const consumers = API_KEY_CONSUMERS[configKey] || [];
  if (consumers.length === 0) return null;
  return (
    <Typography style={{ color: 'var(--surge-accent)', fontSize: 11, marginTop: 4 }}>
      Used by: {consumers.join(', ')}
    </Typography>
  );
}

// Inline TMDB key tester — TMDB's API allows browser CORS, so we can
// hit /3/configuration with the user's key directly from here. The
// other API keys (RD/AD/Premiumize/Fanart/TVDB/MDBList) all reject
// browser CORS so they're validated at deploy time by the orchestrator
// instead.
function TmdbKeyTester({ apiKey }) {
  const [status, setStatus] = React.useState(null); // null | 'testing' | 'ok' | 'fail'
  const [message, setMessage] = React.useState('');
  const handleTest = async () => {
    if (!apiKey) {
      setStatus('fail');
      setMessage('Enter a key first.');
      return;
    }
    setStatus('testing');
    setMessage('');
    try {
      const url = `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        if (body && body.images) {
          setStatus('ok');
          setMessage('Key works — TMDB responded with config data.');
          return;
        }
      }
      // 401 / 403 / odd response — surface what we can.
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.status_message) detail = body.status_message;
      } catch (_) { /* ignore */ }
      setStatus('fail');
      setMessage(`Rejected: ${detail}`);
    } catch (err) {
      setStatus('fail');
      setMessage(`Network error: ${err.message}`);
    }
  };
  return (
    <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
      <Button
        size="small"
        onClick={handleTest}
        disabled={status === 'testing'}
        sx={{
          color: '#07938f',
          borderColor: '#07938f',
          textTransform: 'none',
          fontSize: 12,
        }}
        variant="outlined"
      >
        {status === 'testing' ? 'Testing…' : 'Test key'}
      </Button>
      {status === 'ok' && (
        <Typography style={{ color: 'var(--surge-success)', fontSize: 12 }}>
          ✓ {message}
        </Typography>
      )}
      {status === 'fail' && (
        <Typography style={{ color: 'var(--surge-error)', fontSize: 12 }}>
          ✗ {message}
        </Typography>
      )}
    </Box>
  );
}

// Capability-aware Gluetun config block. The provider dropdown drives:
//   - which transports (wireguard / openvpn) are even offered
//   - which credential subblock renders (private-key + addresses, or
//     username + password)
//   - whether the Type dropdown is shown (hidden when only one
//     transport is available, since there's nothing to choose)
//
// We intentionally do NOT clear the user's stored credentials when
// they switch providers — the orchestrator only consumes the fields
// matching the currently-selected `vpnType`, and keeping the stored
// values means a user can flip back without re-pasting.
function GluetunFields({ config, setConfig }) {
  const provider = config.vpnProvider || '';
  const caps = getProviderCaps(provider);
  // If the chosen type isn't supported by this provider, snap to the
  // one that is. (Effect over JSX so React doesn't re-render mid-render.)
  React.useEffect(() => {
    const type = config.vpnType || 'wireguard';
    if (provider && !caps[type]) {
      const fallback = caps.wireguard ? 'wireguard' : caps.openvpn ? 'openvpn' : '';
      if (fallback && fallback !== type) {
        setConfig((prev) => ({ ...prev, vpnType: fallback }));
      }
    }
  }, [provider, config.vpnType, caps, setConfig]);

  const showTypePicker = caps.wireguard && caps.openvpn;
  const effectiveType = caps.wireguard && caps.openvpn
    ? (config.vpnType || 'wireguard')
    : caps.wireguard ? 'wireguard'
    : caps.openvpn   ? 'openvpn'
    : (config.vpnType || 'wireguard');

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Box display="flex" gap={2}>
        <Box flex={1}>
          <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
            VPN Provider
          </Typography>
          <select
            name="vpnProvider"
            aria-label="VPN provider"
            value={provider}
            onChange={(e) => setConfig((prev) => ({ ...prev, vpnProvider: e.target.value }))}
            style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
          >
            {VPN_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
            See <a href="https://github.com/qdm12/gluetun-wiki" target="_blank" rel="noopener noreferrer"
                   style={{ color: 'var(--surge-brand)' }}>gluetun-wiki</a> for
            provider-specific setup notes.
          </Typography>
        </Box>
        {showTypePicker && (
          <Box style={{ minWidth: 180 }}>
            <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
              Type
            </Typography>
            <select
              name="vpnType"
              aria-label="VPN tunnel type"
              value={config.vpnType || 'wireguard'}
              onChange={(e) => setConfig((prev) => ({ ...prev, vpnType: e.target.value }))}
              style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
            >
              <option value="wireguard">wireguard</option>
              <option value="openvpn">openvpn</option>
            </select>
          </Box>
        )}
      </Box>

      {provider === 'custom' && (
        <Typography style={{ color: 'var(--surge-warning)', fontSize: 12 }}>
          Custom provider — Surge can't pre-fill the right env vars.
          You'll need to drop additional VPN_SERVICE_PROVIDER /
          OPENVPN_CUSTOM_CONFIG / etc. into compose.yaml after Surge
          generates it. See the gluetun-wiki for the field set this
          provider needs.
        </Typography>
      )}

      {provider && effectiveType === 'wireguard' && (
        <>
          <Box>
            <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
              WireGuard Private Key
            </Typography>
            <input
              name="vpnWireguardPrivateKey"
              aria-label="WireGuard private key"
              type="password"
              value={config.vpnWireguardPrivateKey || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, vpnWireguardPrivateKey: e.target.value }))}
              placeholder="From your provider's WireGuard config download"
              style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
            />
          </Box>
          <Box>
            <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
              WireGuard Addresses
            </Typography>
            <input
              name="vpnWireguardAddresses"
              aria-label="WireGuard interface addresses"
              value={config.vpnWireguardAddresses || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, vpnWireguardAddresses: e.target.value }))}
              placeholder="10.64.x.x/32"
              style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
            />
          </Box>
        </>
      )}

      {provider && effectiveType === 'openvpn' && (
        <Box display="flex" gap={2}>
          <Box flex={1}>
            <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
              OpenVPN Username
            </Typography>
            <input
              name="vpnOpenvpnUser"
              aria-label="OpenVPN username"
              value={config.vpnOpenvpnUser || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, vpnOpenvpnUser: e.target.value }))}
              style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
            />
          </Box>
          <Box flex={1}>
            <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
              OpenVPN Password
            </Typography>
            <input
              name="vpnOpenvpnPassword"
              aria-label="OpenVPN password"
              type="password"
              value={config.vpnOpenvpnPassword || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, vpnOpenvpnPassword: e.target.value }))}
              style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
            />
          </Box>
        </Box>
      )}

      {provider && (
        <Box display="flex" gap={2}>
          <Box flex={1}>
            <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
              Server Countries (optional)
            </Typography>
            <input
              name="vpnServerCountries"
              aria-label="VPN server countries"
              value={config.vpnServerCountries || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, vpnServerCountries: e.target.value }))}
              placeholder="Switzerland,Sweden"
              style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
            />
          </Box>
          <Box flex={1}>
            <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
              Server Cities (optional)
            </Typography>
            <input
              name="vpnServerCities"
              aria-label="VPN server cities"
              value={config.vpnServerCities || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, vpnServerCities: e.target.value }))}
              placeholder="Zurich,Stockholm"
              style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
            />
          </Box>
        </Box>
      )}

      <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12 }}>
        Pick which services route through the VPN in step 4 — each
        eligible service tile gets a "🛡 Route through VPN" toggle
        once Gluetun is enabled.
      </Typography>
    </Box>
  );
}


const ExternalAPIStep = ({ config, setConfig }) => {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h6" align="center" style={{ color: 'var(--surge-text-primary)', marginBottom: 16 }}>External API Configuration</Typography>
      <Typography style={{ color: 'var(--surge-text-muted)', marginBottom: 24, fontSize: 14 }}>
        Configure external API keys to enhance your media server with metadata, artwork, and additional features. 
        These APIs improve the functionality of various services but are optional.
      </Typography>

      <Box display="grid" gridTemplateColumns="1fr" gap={3}>
        {/* Essential APIs */}
        <Box sx={{ border: '1px solid #07938f', borderRadius: 2, p: 3, background: 'var(--surge-surface-muted)' }}>
          <Typography style={{ color: '#07938f', fontWeight: 'bold', marginBottom: 12, fontSize: 16 }}>
            🎬 Essential APIs (Recommended)
          </Typography>
          <Box display="flex" flexDirection="column" gap={2}>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                TMDB API Key <span style={{ color: '#07938f' }}>*Recommended</span>
              </Typography>
              <input
                name="tmdbApiKey"
                aria-label="TMDB API key"
                value={config.tmdbApiKey || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, tmdbApiKey: e.target.value }))}
                placeholder="Enter your TMDB API key"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
                Get your free API key from <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" style={{ color: '#07938f' }}>TMDB</a>.
              </Typography>
              <UsedByLabel configKey="tmdbApiKey" />
              <TmdbKeyTester apiKey={config.tmdbApiKey || ''} />
            </Box>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                Real-Debrid API Token
              </Typography>
              <input
                name="rdApiToken"
                aria-label="Real-Debrid API token"
                value={config.rdApiToken || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, rdApiToken: e.target.value }))}
                placeholder="Enter your Real-Debrid API token"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
                Get from <a href="https://real-debrid.com/apitoken" target="_blank" rel="noopener noreferrer" style={{ color: '#07938f' }}>Real-Debrid</a>.
              </Typography>
              <UsedByLabel configKey="rdApiToken" />
            </Box>
          </Box>
        </Box>
        {/* Enhanced Features APIs */}
        <Box sx={{ border: '1px solid var(--surge-border)', borderRadius: 2, p: 3, background: 'var(--surge-card-bg)' }}>
          <Typography style={{ color: 'var(--surge-text-primary)', fontWeight: 'bold', marginBottom: 12, fontSize: 16 }}>
            🎨 Enhanced Features (Optional)
          </Typography>
          <Box display="flex" flexDirection="column" gap={2}>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                FanArt.tv API Key
              </Typography>
              <input
                name="fanartApiKey"
                aria-label="FanArt.tv API key"
                value={config.fanartApiKey || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, fanartApiKey: e.target.value }))}
                placeholder="Enter your FanArt.tv API key (optional)"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
                Get from <a href="https://fanart.tv/get-an-api-key/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--surge-text-dim)' }}>FanArt.tv</a>.
              </Typography>
              <UsedByLabel configKey="fanartApiKey" />
            </Box>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                TVDB API Key
              </Typography>
              <input
                name="tvdbApiKey"
                aria-label="TVDB API key"
                value={config.tvdbApiKey || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, tvdbApiKey: e.target.value }))}
                placeholder="Enter your TVDB API key (optional)"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
                Enhanced TV show metadata. Register at <a href="https://thetvdb.com/api-information" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--surge-text-dim)' }}>TVDB</a>.
              </Typography>
              <UsedByLabel configKey="tvdbApiKey" />
            </Box>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                MDBList API Key
              </Typography>
              <input
                name="mdblistApiKey"
                aria-label="MDBList API key"
                value={config.mdblistApiKey || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, mdblistApiKey: e.target.value }))}
                placeholder="Enter your MDBList API key (optional)"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
                Get from <a href="https://mdblist.com/preferences/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--surge-text-dim)' }}>MDBList</a>.
              </Typography>
              <UsedByLabel configKey="mdblistApiKey" />
            </Box>
          </Box>
        </Box>
        {/* Alternative Debrid Services */}
        <Box sx={{ border: '1px solid var(--surge-border-muted)', borderRadius: 2, p: 3, background: '#151515' }}>
          <Typography style={{ color: 'var(--surge-text-primary)', fontWeight: 'bold', marginBottom: 12, fontSize: 16 }}>
            🔄 Alternative Debrid Services (Optional)
          </Typography>
          <Box display="flex" flexDirection="column" gap={2}>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                AllDebrid API Token
              </Typography>
              <input
                name="adApiToken"
                aria-label="AllDebrid API token"
                value={config.adApiToken || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, adApiToken: e.target.value }))}
                placeholder="Enter your AllDebrid API token (optional)"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
                Alternative to Real-Debrid. Get from <a href="https://alldebrid.com/account/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--surge-text-dim)' }}>AllDebrid</a>.
              </Typography>
              <UsedByLabel configKey="adApiToken" />
            </Box>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                Premiumize API Token
              </Typography>
              <input
                name="premiumizeApiToken"
                aria-label="Premiumize API token"
                value={config.premiumizeApiToken || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, premiumizeApiToken: e.target.value }))}
                placeholder="Enter your Premiumize API token (optional)"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
                Alternative debrid service. Get from <a href="https://www.premiumize.me/account" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--surge-text-dim)' }}>Premiumize</a>.
              </Typography>
              <UsedByLabel configKey="premiumizeApiToken" />
            </Box>
    {/* Discord Webhook */}
    <Box sx={{ border: '1px solid #222', borderRadius: 2, p: 3, background: '#181828', mt: 3 }}>
      <Typography style={{ color: 'var(--surge-text-primary)', fontWeight: 'bold', marginBottom: 12, fontSize: 16 }}>
        🛎️ Notifications (Optional)
      </Typography>
      <Box display="flex" flexDirection="column" gap={2}>
        <Box>
          <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
            Discord Webhook URL
          </Typography>
          <input
            name="discordWebhook"
            aria-label="Discord webhook URL"
            value={config.discordWebhook || ''}
            onChange={(e) => setConfig(prev => ({ ...prev, discordWebhook: e.target.value }))}
            placeholder="Enter your Discord webhook URL (optional)"
            style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
          />
          <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
            Get from <a href="https://discord.com/developers/docs/resources/webhook" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--surge-text-dim)' }}>Discord</a>. Used for service notifications.
          </Typography>
          <UsedByLabel configKey="discordWebhook" />
        </Box>
      </Box>
    </Box>
          </Box>
        </Box>

        {/* Networking add-ons — Pangolin and Gluetun. Both are off
            unless the corresponding service tile is enabled in step
            4; these inputs collect the runtime config that gets
            consumed at compose-render time. */}
        <Box sx={{ border: '1px solid var(--surge-border-muted)', borderRadius: 2, p: 3, background: 'var(--surge-card-bg)' }}>
          <Typography style={{ color: 'var(--surge-text-primary)', fontWeight: 'bold', marginBottom: 12, fontSize: 16 }}>
            🌐 Networking (Pangolin · Gluetun)
          </Typography>
          <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 16 }}>
            Both are optional. <strong>Pangolin</strong> exposes your
            services publicly via a tunneled reverse proxy you run on
            a separate VPS — no port forwarding needed. <strong>Gluetun</strong>{' '}
            routes specific containers' outbound traffic through a VPN
            (Mullvad / ProtonVPN / etc.). Enable each in step 4
            (Networking & VPN) before filling these in.
          </Typography>

          {/* Pangolin / Newt */}
          <Typography style={{ color: 'var(--surge-text-secondary)', fontWeight: 'bold', fontSize: 14, marginBottom: 8 }}>
            Pangolin tunnel
          </Typography>
          <Box display="flex" flexDirection="column" gap={2} mb={3}>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                Pangolin Endpoint
              </Typography>
              <input
                name="pangolinEndpoint"
                aria-label="Pangolin endpoint URL"
                value={config.pangolinEndpoint || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, pangolinEndpoint: e.target.value }))}
                placeholder="https://pangolin.example.com"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
                Public URL of your Pangolin control plane. From your{' '}
                <a href="https://docs.pangolin.net" target="_blank" rel="noopener noreferrer"
                   style={{ color: 'var(--surge-brand)' }}>Pangolin instance</a>.
              </Typography>
            </Box>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                Newt ID
              </Typography>
              <input
                name="newtId"
                aria-label="Newt ID"
                value={config.newtId || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, newtId: e.target.value }))}
                placeholder="From Pangolin's Add Site flow"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
            </Box>
            <Box>
              <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}>
                Newt Secret
              </Typography>
              <input
                name="newtSecret"
                aria-label="Newt secret"
                type="password"
                value={config.newtSecret || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, newtSecret: e.target.value }))}
                placeholder="From Pangolin's Add Site flow"
                style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
              />
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 4 }}>
                One-time secret issued when you add this site to Pangolin.
                Routes (which Surge service maps to which subdomain) are
                managed inside Pangolin, not here.
              </Typography>
            </Box>
          </Box>

          {/* Gluetun VPN */}
          <Typography style={{ color: 'var(--surge-text-secondary)', fontWeight: 'bold', fontSize: 14, marginBottom: 8 }}>
            Gluetun VPN
          </Typography>
          <GluetunFields config={config} setConfig={setConfig} />
        </Box>
      </Box>
      <Box mt={3} p={2} sx={{ background: 'var(--surge-surface-warning)', border: '1px solid #1a4a5a', borderRadius: 2 }}>
        <Typography style={{ color: 'var(--surge-accent)', fontWeight: 'bold', marginBottom: 8, fontSize: 14 }}>
          💡 Pro Tips:
        </Typography>
        <ul style={{ color: 'var(--surge-text-muted)', fontSize: 12, margin: 0, paddingLeft: 16 }}>
          <li>TMDB API is free and greatly improves metadata quality</li>
          <li>Real-Debrid enables premium streaming and fast downloads</li>
          <li>TMDB has a "Test key" button above; the other API keys can't be tested from your browser (they don't allow cross-origin requests) — they're validated when the orchestrator runs on your deploy target</li>
          <li>All API keys are stored locally in your browser and only leave it via the deploy bundle download</li>
          <li>You can add or change API keys later by editing the bundled config.json</li>
        </ul>
      </Box>
    </Box>
  );
};

export default ExternalAPIStep;
