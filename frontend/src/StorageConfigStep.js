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
    color: '#fff',
    background: '#222',
    '& fieldset': { borderColor: '#444' },
    '&:hover fieldset': { borderColor: '#07938f' },
    '&.Mui-focused fieldset': { borderColor: '#07938f' },
  },
  '& .MuiInputLabel-root': { color: '#aaa' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#07938f' },
};

const StorageConfigStep = ({ config, setConfig }) => {
  const selected = config.platform;
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
      <Typography variant="h6" align="center" style={{ color: '#fff', marginBottom: 8 }}>
        Storage Config
      </Typography>
      <Typography align="center" style={{ color: '#aaa', fontSize: 14, marginBottom: 24 }}>
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
                background: '#181818',
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
              <Typography style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>
                {p.name}
              </Typography>
              <Typography style={{ color: '#aaa', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
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
            border: '1px solid #2a2a2a',
          }}
        >
          <Typography style={{ color: '#fff', fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
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
              style={{ color: '#79eaff', fontWeight: 600, fontSize: 13, marginBottom: 4 }}
            >
              Heads up
            </Typography>
            <Typography style={{ color: '#cfd8dc', fontSize: 13, lineHeight: 1.5 }}>
              Surge clones each selected service into{' '}
              <code style={{ background: '#0a0a0a', padding: '1px 6px', borderRadius: 3, color: '#79eaff' }}>
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
              <Typography style={{ color: '#fff' }}>
                I use a cache drive
              </Typography>
            }
          />
          <Typography style={{ color: '#888', fontSize: 12, marginLeft: 1, marginBottom: 16 }}>
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
            border: '1px solid #2a2a2a',
          }}
        >
          <Typography style={{ color: '#fff', fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Docker setup
          </Typography>

          <Typography style={{ color: '#aaa', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
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
              <span style={{ color: '#888' }}>
                Example layout: <code style={{ color: '#79eaff' }}>{(docker.rootPath || '/opt/surge')}/configs</code>,{' '}
                <code style={{ color: '#79eaff' }}>{(docker.rootPath || '/opt/surge')}/downloads</code>,{' '}
                <code style={{ color: '#79eaff' }}>{(docker.rootPath || '/opt/surge')}/media</code>
              </span>
            }
          />
        </Box>
      )}
    </Box>
  );
};

export default StorageConfigStep;
