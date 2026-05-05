import React from 'react';
import {
  Box,
  Typography,
  Switch,
  TextField,
  FormControlLabel,
} from '@mui/material';
import unraidLogo from './assets/unraid.png';
import dockerLogo from './assets/docker.png';

// Platform options for storage configuration. Each platform will drive
// downstream path defaults (Unraid uses /mnt/user, /mnt/cache; plain
// Docker uses whatever the user configures).
const platforms = [
  { key: 'unraid', name: 'Unraid', logo: unraidLogo, desc: 'Deploy to an Unraid server' },
  { key: 'docker', name: 'Docker', logo: dockerLogo, desc: 'Deploy to a generic Docker host' },
];

// Default Unraid path conventions. Users can override per-deploy.
const UNRAID_DEFAULTS = {
  useCacheDrive: true,
  cachePath: '/mnt/cache',
};

// Default Docker root. The user provides a single host directory and
// every Surge service is rooted underneath it (configs, downloads,
// media — all derived from this).
const DOCKER_DEFAULTS = {
  rootPath: '/opt/surge',
};

const inputSx = {
  '& .MuiOutlinedInput-root': {
    color: 'var(--surge-text-primary)',
    background: 'var(--surge-input-bg)',
    '& fieldset': { borderColor: 'var(--surge-border)' },
    '&:hover fieldset': { borderColor: '#07938f' },
    '&.Mui-focused fieldset': { borderColor: '#07938f' },
  },
  '& .MuiInputLabel-root': { color: 'var(--surge-text-muted)' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#07938f' },
};

// Compute the resolved host paths Surge will use given the wizard
// config. Mirrors orchestrator/surge_orchestrator.py's PathResolver
// — keep in sync if either changes.
function resolvePaths(config) {
  const platform = config.platform || '';
  if (platform === 'unraid') {
    const cachePath   = config.unraid?.cachePath   || '/mnt/cache';
    const appdataPath = config.unraid?.appdataPath || '/mnt/user/appdata';
    const useCache    = !!config.unraid?.useCacheDrive;
    return {
      mediaRoot:      useCache ? cachePath : '/mnt/user',
      configRoot:     useCache ? appdataPath : '/mnt/user/appdata',
      userSharesRoot: '/mnt/user',
    };
  }
  if (platform === 'docker') {
    const rootPath = config.docker?.rootPath || '/opt/surge';
    return {
      mediaRoot:      rootPath,
      configRoot:     rootPath,
      userSharesRoot: rootPath,
    };
  }
  return null;
}

const StorageConfigStep = ({ config, setConfig }) => {
  const selected = config.platform;
  const resolved = resolvePaths(config);
  const unraid = config.unraid || UNRAID_DEFAULTS;
  const docker = config.docker || DOCKER_DEFAULTS;

  const choose = (key) => {
    setConfig((prev) => ({
      ...prev,
      platform: key,
      // Seed defaults on first selection so the form has values.
      unraid: key === 'unraid' ? { ...UNRAID_DEFAULTS, ...prev.unraid } : prev.unraid,
      docker: key === 'docker' ? { ...DOCKER_DEFAULTS, ...prev.docker } : prev.docker,
    }));
  };

  const updateUnraid = (patch) => {
    setConfig((prev) => ({
      ...prev,
      unraid: { ...UNRAID_DEFAULTS, ...prev.unraid, ...patch },
    }));
  };

  const updateDocker = (patch) => {
    setConfig((prev) => ({
      ...prev,
      docker: { ...DOCKER_DEFAULTS, ...prev.docker, ...patch },
    }));
  };

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h6" align="center" style={{ color: 'var(--surge-text-primary)', marginBottom: 16 }}>
        Storage Config
      </Typography>
      <Typography align="center" style={{ color: 'var(--surge-text-muted)', fontSize: 14, marginBottom: 24 }}>
        Where will Surge deploy your stack?
      </Typography>

      <Box display="flex" justifyContent="center" gap={3} flexWrap="wrap" mb={3}>
        {platforms.map((p) => {
          const active = selected === p.key;
          return (
            <Box
              key={p.key}
              onClick={() => choose(p.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  choose(p.key);
                }
              }}
              sx={{
                cursor: 'pointer',
                width: 180,
                height: 200,
                borderRadius: 2,
                background: 'var(--surge-panel-bg)',
                border: active ? '2px solid #07938f' : '2px solid transparent',
                transition: 'border-color 0.15s, transform 0.15s',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                p: 2,
                opacity: active || !selected ? 1 : 0.55,
                filter: active || !selected ? 'none' : 'grayscale(60%)',
                '&:hover': {
                  borderColor: active ? '#07938f' : 'rgba(7,147,143,0.6)',
                  transform: 'translateY(-2px)',
                },
                outline: 'none',
                '&:focus-visible': { borderColor: '#07938f' },
              }}
            >
              <img
                src={p.logo}
                alt={p.name}
                style={{
                  width: 96,
                  height: 96,
                  objectFit: 'contain',
                  marginBottom: 12,
                }}
              />
              <Typography style={{ color: 'var(--surge-text-primary)', fontSize: 18, fontWeight: 600 }}>
                {p.name}
              </Typography>
              <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                {p.desc}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {selected === 'unraid' && (
        <Box
          sx={{
            maxWidth: 520,
            margin: '0 auto',
            mt: 2,
            p: 3,
            borderRadius: 2,
            background: '#1d1d1d',
            border: '1px solid var(--surge-border-subtle)',
          }}
        >
          <Typography style={{ color: 'var(--surge-text-primary)', fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Unraid setup
          </Typography>

          <Box
            sx={{
              p: 1.5,
              mb: 2,
              borderRadius: 1.5,
              background: 'rgba(7,147,143,0.08)',
              border: '1px solid rgba(7,147,143,0.4)',
            }}
          >
            <Typography
              style={{ color: 'var(--surge-accent)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}
            >
              Heads up
            </Typography>
            <Typography style={{ color: 'var(--surge-text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
              Surge clones each selected service into{' '}
              <code style={{ background: '#0a0a0a', padding: '1px 6px', borderRadius: 3, color: 'var(--surge-accent)' }}>
                /mnt/user/appdata/&lt;service&gt;
              </code>
              , which is already Unraid's default under Settings → Docker → "Default
              appdata storage location". You shouldn't need to override this
              unless you're doing an advanced install.
            </Typography>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={!!unraid.useCacheDrive}
                onChange={(e) => updateUnraid({ useCacheDrive: e.target.checked })}
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': { color: '#07938f' },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#07938f' },
                }}
              />
            }
            label={
              <Typography style={{ color: 'var(--surge-text-primary)' }}>
                I use a cache drive
              </Typography>
            }
          />
          <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginLeft: 1, marginBottom: 16 }}>
            Surge will route active downloads to the cache so the array isn't hit on every write.
          </Typography>

          {unraid.useCacheDrive && (
            <TextField
              fullWidth
              label="Cache mount path"
              value={unraid.cachePath || ''}
              onChange={(e) => updateUnraid({ cachePath: e.target.value })}
              placeholder="/mnt/cache"
              sx={inputSx}
              InputLabelProps={{ shrink: true }}
            />
          )}
        </Box>
      )}

      {selected === 'docker' && (
        <Box
          sx={{
            maxWidth: 520,
            margin: '0 auto',
            mt: 2,
            p: 3,
            borderRadius: 2,
            background: '#1d1d1d',
            border: '1px solid var(--surge-border-subtle)',
          }}
        >
          <Typography style={{ color: 'var(--surge-text-primary)', fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Docker setup
          </Typography>

          <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
            Pick one host directory and Surge will root every service under it —
            configs, downloads, and media all live below this path.
          </Typography>

          <TextField
            fullWidth
            label="Root path"
            value={docker.rootPath || ''}
            onChange={(e) => updateDocker({ rootPath: e.target.value })}
            placeholder="/opt/surge"
            sx={inputSx}
            InputLabelProps={{ shrink: true }}
            helperText={
              <span style={{ color: 'var(--surge-text-dim)' }}>
                Example layout: <code style={{ color: 'var(--surge-accent)' }}>{(docker.rootPath || '/opt/surge')}/configs</code>,{' '}
                <code style={{ color: 'var(--surge-accent)' }}>{(docker.rootPath || '/opt/surge')}/downloads</code>,{' '}
                <code style={{ color: 'var(--surge-accent)' }}>{(docker.rootPath || '/opt/surge')}/media</code>
              </span>
            }
          />
        </Box>
      )}

      {/* Resolved-path preview — confirms the path tokens used
          throughout the schema (mediaRoot, configRoot, userSharesRoot)
          will land on the host paths the user expects. Stays hidden
          until the user picks a platform. */}
      {selected && resolved && (
        <Box sx={{
          mt: 4, p: 2,
          background: '#0d1f1e',
          border: '1px solid #07938f',
          borderRadius: 1,
        }}>
          <Typography style={{
            color: 'var(--surge-text-primary)', fontSize: 14, fontWeight: 600,
            letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 4,
          }}>
            Resolved host paths
          </Typography>
          <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 12 }}>
            Surge's path tokens will resolve to these directories on
            your deploy target. Every service's config lives under
            <code style={{ color: 'var(--surge-accent)', margin: '0 4px' }}>configRoot</code>;
            its media + downloads under
            <code style={{ color: 'var(--surge-accent)', margin: '0 4px' }}>mediaRoot</code>.
          </Typography>
          <Box component="ul" sx={{
            m: 0, pl: 2, color: 'var(--surge-text-secondary)', fontSize: 13, lineHeight: 1.8,
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
            listStyle: 'none',
          }}>
            <li>
              <span style={{ color: '#07938f', display: 'inline-block', minWidth: 130 }}>mediaRoot</span>
              <span>→ {resolved.mediaRoot}/media</span>
              <span style={{ color: 'var(--surge-text-dim)', marginLeft: 8, fontSize: 11 }}>
                {' '}(libraries, downloads, intake)
              </span>
            </li>
            <li>
              <span style={{ color: '#07938f', display: 'inline-block', minWidth: 130 }}>configRoot</span>
              <span>→ {resolved.configRoot}/&lt;service&gt;</span>
              <span style={{ color: 'var(--surge-text-dim)', marginLeft: 8, fontSize: 11 }}>
                {' '}(per-service config dirs)
              </span>
            </li>
            <li>
              <span style={{ color: '#07938f', display: 'inline-block', minWidth: 130 }}>userSharesRoot</span>
              <span>→ {resolved.userSharesRoot}</span>
              <span style={{ color: 'var(--surge-text-dim)', marginLeft: 8, fontSize: 11 }}>
                {' '}(Unraid shares root, occasionally referenced)
              </span>
            </li>
          </Box>
          {selected === 'unraid' && !config.unraid?.useCacheDrive && (
            <Typography style={{ color: 'var(--surge-warning)', fontSize: 12, marginTop: 8 }}>
              ⓘ Cache drive disabled — both media and config will live on{' '}
              <code style={{ color: 'var(--surge-accent)' }}>/mnt/user</code> (slower, no cache).
            </Typography>
          )}
        </Box>
      )}

      {/* User / Group / Umask — flows into PUID/PGID/UMASK env on every
          container. Defaults match Unraid's nobody:users (99:100); Docker
          hosts often want the deploying user's UID (`id -u` on Linux) and
          GID instead so written files are owned correctly. */}
      <Box sx={{ mt: 4, p: 2, background: 'var(--surge-panel-bg)', border: '1px solid var(--surge-border-subtle)', borderRadius: 1 }}>
        <Typography style={{
          color: 'var(--surge-text-primary)', fontSize: 14, fontWeight: 600,
          letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 4,
        }}>
          File ownership (PUID / PGID)
        </Typography>
        <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 12 }}>
          Containers run as this UID:GID. Defaults are <code style={{ color: 'var(--surge-accent)' }}>99:100</code>{' '}
          (Unraid's nobody:users). On a Docker host, run <code style={{ color: 'var(--surge-accent)' }}>id -u</code>{' '}
          and <code style={{ color: 'var(--surge-accent)' }}>id -g</code> to find the right values for the user
          who owns your media folder.
        </Typography>
        <Box display="flex" gap={2} flexWrap="wrap">
          <TextField
            size="medium"
            label="PUID"
            value={config.userId ?? ''}
            onChange={(e) => setConfig((p) => ({ ...p, userId: e.target.value.replace(/[^0-9]/g, '') }))}
            placeholder="99"
            sx={{ ...inputSx, width: 120 }}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="medium"
            label="PGID"
            value={config.groupId ?? ''}
            onChange={(e) => setConfig((p) => ({ ...p, groupId: e.target.value.replace(/[^0-9]/g, '') }))}
            placeholder="100"
            sx={{ ...inputSx, width: 120 }}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="medium"
            label="UMASK"
            value={config.umask ?? ''}
            onChange={(e) => setConfig((p) => ({ ...p, umask: e.target.value.replace(/[^0-7]/g, '') }))}
            placeholder="022"
            sx={{ ...inputSx, width: 120 }}
            InputLabelProps={{ shrink: true }}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default StorageConfigStep;
