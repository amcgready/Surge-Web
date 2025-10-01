import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Alert, 
  Button, 
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  IconButton,
  Collapse,
  List,
  ListItem,
  ListItemText,
  CircularProgress
} from '@mui/material';
import { 
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  ContentCopy as ContentCopyIcon
} from '@mui/icons-material';

function DaemonStatus({ 
  connected, 
  onRefresh, 
  daemonToken, 
  onGenerateToken, 
  user,
  deploymentProgress = [],
  currentDeploymentId 
}) {
  const [showInstructions, setShowInstructions] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const getDaemonCommand = () => {
    const token = daemonToken || 'YOUR_TOKEN';
    return `curl -sSL https://surge.video/install-daemon.sh | bash && ~/.surge-daemon/start.sh --server wss://surge.video/socket.io/ --token ${token}`;
  };

  useEffect(() => {
    if (deploymentProgress.length > 0) {
      setShowProgress(true);
    }
  }, [deploymentProgress]);

  return (
    <>
      <Box 
        sx={{ 
          mb: 2, 
          p: 2, 
          backgroundColor: 'rgba(255,255,255,0.05)', 
          borderRadius: 2,
          border: '1px solid rgba(255,255,255,0.1)'
        }}
      >
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" style={{ color: '#fff' }}>
            Local Machine Connection
          </Typography>
          
          <Box display="flex" alignItems="center" gap={1}>
            <Chip
              icon={connected ? <CheckCircleIcon /> : <ErrorIcon />}
              label={connected ? 'Connected' : 'Disconnected'}
              color={connected ? 'success' : 'error'}
              variant="outlined"
              sx={{ 
                color: connected ? '#4caf50' : '#f44336',
                borderColor: connected ? '#4caf50' : '#f44336'
              }}
            />
            
            <IconButton 
              onClick={onRefresh}
              sx={{ color: '#fff' }}
              size="small"
            >
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>

        {!connected && (
          <Box mt={2}>
            <Alert 
              severity="warning" 
              sx={{ 
                backgroundColor: 'rgba(255, 193, 7, 0.1)',
                color: '#ffb300',
                '& .MuiAlert-icon': { color: '#ffb300' }
              }}
              action={
                <Button 
                  color="inherit" 
                  size="small" 
                  onClick={() => setShowInstructions(true)}
                >
                  Setup Instructions
                </Button>
              }
            >
              Your local machine is not connected. Install and run the Surge daemon to begin deployment.
            </Alert>
          </Box>
        )}

        {connected && (
          <Box mt={2}>
            <Alert 
              severity="success"
              sx={{ 
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                color: '#4caf50',
                '& .MuiAlert-icon': { color: '#4caf50' }
              }}
            >
              Ready to deploy! Your local machine is connected and waiting for commands.
            </Alert>
          </Box>
        )}

        {/* Deployment Progress */}
        {deploymentProgress.length > 0 && (
          <Box mt={2}>
            <Button
              onClick={() => setShowProgress(!showProgress)}
              startIcon={showProgress ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ color: '#fff', mb: 1 }}
            >
              Deployment Progress ({deploymentProgress.length} events)
            </Button>
            
            <Collapse in={showProgress}>
              <Box 
                sx={{ 
                  maxHeight: 200, 
                  overflowY: 'auto',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  borderRadius: 1,
                  p: 1
                }}
              >
                <List dense>
                  {deploymentProgress.map((event, index) => (
                    <ListItem key={index} sx={{ py: 0.5 }}>
                      <ListItemText
                        primary={
                          <Typography 
                            variant="body2" 
                            sx={{ 
                              color: event.type === 'error' ? '#f44336' : 
                                     event.type === 'success' ? '#4caf50' : '#fff',
                              fontFamily: 'monospace'
                            }}
                          >
                            {new Date(event.timestamp).toLocaleTimeString()}: {event.message}
                          </Typography>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            </Collapse>
          </Box>
        )}

        {/* Active deployment indicator */}
        {currentDeploymentId && (
          <Box mt={2} display="flex" alignItems="center" gap={1}>
            <CircularProgress size={16} sx={{ color: '#07938f' }} />
            <Typography variant="body2" sx={{ color: '#07938f' }}>
              Deployment in progress...
            </Typography>
          </Box>
        )}
      </Box>

      {/* Setup Instructions Dialog */}
      <Dialog 
        open={showInstructions} 
        onClose={() => setShowInstructions(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(17,17,17,0.95)',
            color: '#fff'
          }
        }}
      >
        <DialogTitle sx={{ color: '#fff' }}>
          Connect Your Local Machine
        </DialogTitle>
        
        <DialogContent>
          <Typography variant="body1" paragraph sx={{ color: '#ccc' }}>
            To deploy services to your local machine, you need to install and run the Surge daemon.
          </Typography>

          <Typography variant="h6" sx={{ color: '#fff', mt: 3, mb: 1 }}>
            Step 1: Generate Connection Token
          </Typography>
          
          <Box mb={2}>
            {!daemonToken ? (
              <Button 
                variant="contained" 
                onClick={onGenerateToken}
                sx={{ 
                  backgroundColor: '#07938f',
                  '&:hover': { backgroundColor: '#065a57' }
                }}
              >
                Generate Token
              </Button>
            ) : (
              <Alert 
                severity="success"
                sx={{ 
                  backgroundColor: 'rgba(76, 175, 80, 0.1)',
                  color: '#4caf50'
                }}
              >
                ✅ Token generated successfully!
              </Alert>
            )}
          </Box>

          <Typography variant="h6" sx={{ color: '#fff', mt: 3, mb: 1 }}>
            Step 2: Install and Run Daemon
          </Typography>
          
          <Typography variant="body2" sx={{ color: '#ccc', mb: 2 }}>
            Run this command on your local machine (Linux/macOS):
          </Typography>

          <Box 
            sx={{ 
              backgroundColor: '#000',
              padding: 2,
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              color: '#0f0',
              position: 'relative',
              overflowX: 'auto'
            }}
          >
            <IconButton
              onClick={() => copyToClipboard(getDaemonCommand())}
              sx={{ 
                position: 'absolute',
                top: 8,
                right: 8,
                color: copied ? '#4caf50' : '#ccc'
              }}
              size="small"
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
            
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {getDaemonCommand()}
            </pre>
          </Box>

          {copied && (
            <Typography variant="body2" sx={{ color: '#4caf50', mt: 1 }}>
              ✅ Copied to clipboard!
            </Typography>
          )}

          <Typography variant="h6" sx={{ color: '#fff', mt: 3, mb: 1 }}>
            Step 3: Verify Connection
          </Typography>
          
          <Typography variant="body2" sx={{ color: '#ccc' }}>
            Once the daemon is running, you'll see "Connected" status above. You can then proceed with deployment.
          </Typography>

          <Box mt={3} p={2} sx={{ backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: 1 }}>
            <Typography variant="body2" sx={{ color: '#ffb300' }}>
              <WarningIcon sx={{ fontSize: 16, mr: 1, verticalAlign: 'text-bottom' }} />
              <strong>Security Note:</strong> The daemon only connects to this installer and executes the commands you approve through this interface. 
              All communication is encrypted and authenticated.
            </Typography>
          </Box>
        </DialogContent>
        
        <DialogActions>
          <Button 
            onClick={() => setShowInstructions(false)}
            sx={{ color: '#07938f' }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default DaemonStatus;