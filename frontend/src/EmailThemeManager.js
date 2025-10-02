import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Box,
  Button,
  Card,
  CardContent,
  CardActions,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Tabs,
  Tab,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import {
  Email,
  Palette,
  Preview,
  Send,
  Settings
} from '@mui/icons-material';

function EmailThemeManager() {
  const [themes, setThemes] = useState({});
  const [currentTheme, setCurrentTheme] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewThemeName, setPreviewThemeName] = useState('');
  const [testEmailOpen, setTestEmailOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => {
    fetchThemes();
  }, []);

  const fetchThemes = async () => {
    try {
      const response = await fetch('/api/email/themes');
      const data = await response.json();
      
      if (data.success) {
        setThemes(data.themes);
        setCurrentTheme(data.current_theme);
      }
    } catch (error) {
      setMessage('Error loading themes: ' + error.message);
    }
  };

  const changeTheme = async (themeName) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('surge-auth-token');
      const response = await fetch('/api/email/theme', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ theme_name: themeName })
      });

      const data = await response.json();
      
      if (data.success) {
        setCurrentTheme(themeName);
        setMessage(`Theme changed to ${themeName}`);
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage('Error: ' + data.error);
      }
    } catch (error) {
      setMessage('Error changing theme: ' + error.message);
    }
    setLoading(false);
  };

  const previewTheme = (themeName) => {
    setPreviewThemeName(themeName);
    setPreviewOpen(true);
  };

  const sendTestEmail = async () => {
    if (!testEmail) {
      setMessage('Please enter an email address');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/test/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          email: testEmail,
          theme: currentTheme 
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setMessage(`Test email sent to ${testEmail}!`);
        setTestEmailOpen(false);
        setTestEmail('');
      } else {
        setMessage('Error: ' + data.error);
      }
    } catch (error) {
      setMessage('Error sending test email: ' + error.message);
    }
    setLoading(false);
  };

  const getThemeColor = (themeName) => {
    const colors = {
      'professional_blue': '#667eea',
      'modern_dark': '#238636',
      'minimalist': '#333333',
      'gradient_surge': '#07938f'
    };
    return colors[themeName] || '#666';
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          <Email sx={{ mr: 2, verticalAlign: 'middle' }} />
          Email Theme Manager
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Customize the appearance of your email confirmations and notifications
        </Typography>
      </Box>

      {message && (
        <Alert 
          severity={message.includes('Error') ? 'error' : 'success'} 
          sx={{ mb: 3 }}
          onClose={() => setMessage('')}
        >
          {message}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={selectedTab} onChange={(e, v) => setSelectedTab(v)}>
          <Tab label="Theme Gallery" />
          <Tab label="Current Settings" />
        </Tabs>
      </Box>

      {selectedTab === 0 && (
        <>
          <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Available Themes</Typography>
            <Button
              variant="outlined"
              startIcon={<Send />}
              onClick={() => setTestEmailOpen(true)}
              disabled={!currentTheme}
            >
              Send Test Email
            </Button>
          </Box>

          <Grid container spacing={3}>
            {Object.entries(themes).map(([key, theme]) => (
              <Grid item xs={12} md={6} key={key}>
                <Card 
                  sx={{ 
                    height: '100%',
                    border: currentTheme === key ? 2 : 1,
                    borderColor: currentTheme === key ? getThemeColor(key) : 'divider'
                  }}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Box 
                        sx={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          backgroundColor: getThemeColor(key),
                          mr: 1
                        }}
                      />
                      <Typography variant="h6">
                        {theme.name}
                      </Typography>
                      {currentTheme === key && (
                        <Chip 
                          label="Current" 
                          size="small" 
                          color="primary" 
                          sx={{ ml: 1 }}
                        />
                      )}
                    </Box>
                    
                    <Typography variant="body2" color="text.secondary" paragraph>
                      {theme.description}
                    </Typography>
                    
                    <Typography variant="caption" color="text.secondary">
                      <strong>Best for:</strong> {theme.best_for}
                    </Typography>
                  </CardContent>
                  
                  <CardActions>
                    <Button
                      size="small"
                      startIcon={<Preview />}
                      onClick={() => previewTheme(key)}
                    >
                      Preview
                    </Button>
                    
                    {currentTheme !== key && (
                      <Button
                        size="small"
                        startIcon={<Palette />}
                        onClick={() => changeTheme(key)}
                        disabled={loading}
                        color="primary"
                      >
                        Use Theme
                      </Button>
                    )}
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}

      {selectedTab === 1 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            <Settings sx={{ mr: 1, verticalAlign: 'middle' }} />
            Current Configuration
          </Typography>
          
          {currentTheme && themes[currentTheme] && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Box 
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    backgroundColor: getThemeColor(currentTheme),
                    mr: 2
                  }}
                />
                <Box>
                  <Typography variant="h6">
                    {themes[currentTheme].name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {themes[currentTheme].description}
                  </Typography>
                </Box>
              </Box>
              
              <Grid container spacing={2} sx={{ mt: 2 }}>
                <Grid item xs={12} sm={6}>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<Preview />}
                    onClick={() => previewTheme(currentTheme)}
                  >
                    Preview Current Theme
                  </Button>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<Send />}
                    onClick={() => setTestEmailOpen(true)}
                  >
                    Send Test Email
                  </Button>
                </Grid>
              </Grid>
            </Box>
          )}
        </Paper>
      )}

      {/* Preview Dialog */}
      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Email Preview: {previewThemeName && themes[previewThemeName]?.name}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ height: 400, border: 1, borderColor: 'divider' }}>
            <iframe
              src={`/api/email/preview/${previewThemeName}`}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                borderRadius: '4px'
              }}
              title="Email Preview"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewOpen(false)}>Close</Button>
          {previewThemeName !== currentTheme && (
            <Button
              variant="contained"
              onClick={() => {
                changeTheme(previewThemeName);
                setPreviewOpen(false);
              }}
              disabled={loading}
            >
              Use This Theme
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Test Email Dialog */}
      <Dialog
        open={testEmailOpen}
        onClose={() => setTestEmailOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Send Test Email</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" paragraph>
            Send a test verification email to see how it looks with the current theme.
          </Typography>
          <TextField
            fullWidth
            label="Email Address"
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="test@example.com"
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestEmailOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={sendTestEmail}
            disabled={loading || !testEmail}
          >
            Send Test Email
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default EmailThemeManager;