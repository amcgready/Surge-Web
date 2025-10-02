import React, { useState, useEffect } from 'react';
import { 
  Container, 
  Paper, 
  Typography, 
  Box, 
  Alert,
  Button,
  CircularProgress
} from '@mui/material';
import { CheckCircle, Error } from '@mui/icons-material';
import SurgeLogo from './SurgeLogo';
import bgImage from './assets/background.jpg';

function EmailVerification({ onVerificationComplete }) {
  const [status, setStatus] = useState('verifying'); // 'verifying', 'success', 'error'
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
      setStatus('error');
      setMessage('Invalid verification link. No token provided.');
      return;
    }

    // Verify the email token
    verifyEmail(token);
  }, []);

  const verifyEmail = async (token) => {
    try {
      const resp = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token })
      });

      const data = await resp.json();

      if (resp.ok) {
        setStatus('success');
        setMessage(data.message);
        setUsername(data.username);
      } else {
        setStatus('error');
        setMessage(data.error || 'Verification failed');
      }
    } catch (e) {
      setStatus('error');
      setMessage('Network error: ' + e.message);
    }
  };

  const handleContinue = () => {
    if (onVerificationComplete) {
      onVerificationComplete();
    } else {
      // Redirect to main app
      window.location.href = '/';
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      minWidth: '100vw',
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundImage: `url(${bgImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
      zIndex: -1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <Container maxWidth="sm">
        <Paper 
          elevation={0}
          style={{ 
            padding: '3rem',
            background: 'rgba(17,17,17,0.95)', 
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.1)',
            textAlign: 'center'
          }}
        >
          <Box mb={3}>
            <SurgeLogo />
            <Typography variant="h4" style={{ color: '#fff', marginTop: '1rem' }}>
              Email Verification
            </Typography>
          </Box>

          {status === 'verifying' && (
            <Box>
              <CircularProgress 
                size={60} 
                sx={{ color: '#07938f', mb: 3 }} 
              />
              <Typography variant="h6" style={{ color: '#ccc' }}>
                Verifying your email address...
              </Typography>
            </Box>
          )}

          {status === 'success' && (
            <Box>
              <CheckCircle 
                sx={{ 
                  fontSize: 80, 
                  color: '#4caf50', 
                  mb: 2 
                }} 
              />
              <Typography variant="h5" style={{ color: '#4caf50', marginBottom: '1rem' }}>
                Email Verified Successfully!
              </Typography>
              {username && (
                <Typography variant="body1" style={{ color: '#ccc', marginBottom: '1rem' }}>
                  Welcome {username}! Your account is now active.
                </Typography>
              )}
              <Alert severity="success" sx={{ mb: 3, textAlign: 'left' }}>
                {message}
              </Alert>
              <Button
                variant="contained"
                onClick={handleContinue}
                sx={{
                  backgroundColor: '#07938f',
                  '&:hover': { backgroundColor: '#065a57' },
                  px: 4,
                  py: 1.5
                }}
              >
                Continue to Surge Installer
              </Button>
            </Box>
          )}

          {status === 'error' && (
            <Box>
              <Error 
                sx={{ 
                  fontSize: 80, 
                  color: '#f44336', 
                  mb: 2 
                }} 
              />
              <Typography variant="h5" style={{ color: '#f44336', marginBottom: '1rem' }}>
                Verification Failed
              </Typography>
              <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
                {message}
              </Alert>
              <Box>
                <Button
                  variant="outlined"
                  onClick={handleContinue}
                  sx={{
                    borderColor: '#07938f',
                    color: '#07938f',
                    '&:hover': { 
                      borderColor: '#065a57',
                      backgroundColor: 'rgba(7, 147, 143, 0.1)'
                    },
                    mr: 2
                  }}
                >
                  Return to Login
                </Button>
                <Button
                  variant="contained"
                  onClick={() => {
                    // Redirect to support or contact page
                    window.location.href = '/';
                  }}
                  sx={{
                    backgroundColor: '#07938f',
                    '&:hover': { backgroundColor: '#065a57' }
                  }}
                >
                  Get Help
                </Button>
              </Box>
            </Box>
          )}
        </Paper>
      </Container>
    </div>
  );
}

export default EmailVerification;