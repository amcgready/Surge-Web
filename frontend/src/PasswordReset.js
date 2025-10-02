import React, { useState, useEffect } from 'react';
import { 
  Container, 
  Paper, 
  TextField, 
  Button, 
  Typography, 
  Box, 
  Alert 
} from '@mui/material';
import SurgeLogo from './SurgeLogo';
import bgImage from './assets/background.jpg';

function PasswordReset({ token, onComplete }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Password validation function
  const validatePassword = (password) => {
    if (password.length < 8) {
      return {
        isValid: false,
        message: 'Password must be at least 8 characters long'
      };
    }

    if (!/[A-Z]/.test(password)) {
      return {
        isValid: false,
        message: 'Password must contain at least one uppercase letter'
      };
    }

    if (!/[0-9]/.test(password)) {
      return {
        isValid: false,
        message: 'Password must contain at least one number'
      };
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return {
        isValid: false,
        message: 'Password must contain at least one special character (!@#$%^&*()_+-=[]{};\'"\\|,.<>/?)'
      };
    }

    return {
      isValid: true,
      message: 'Password meets all requirements'
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setError(passwordValidation.message);
      setLoading(false);
      return;
    }

    try {
      const resp = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: token,
          password: password
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        setSuccess(true);
        setTimeout(() => {
          onComplete(true);
        }, 2000);
      } else {
        const errorData = await resp.json();
        setError(errorData.error || 'Password reset failed');
      }
    } catch (e) {
      setError('Network error: ' + e.message);
    }

    setLoading(false);
  };

  if (success) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.6)), url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Container component="main" maxWidth="sm">
          <Paper 
            elevation={10}
            sx={{
              marginTop: 8,
              marginBottom: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: 4,
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(10px)',
              borderRadius: 3,
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            }}
          >
            <SurgeLogo size={100} />
            
            <Typography 
              component="h1" 
              variant="h4" 
              sx={{ 
                mt: 2, 
                mb: 3, 
                color: '#fff',
                textAlign: 'center',
                fontWeight: 'bold'
              }}
            >
              Password Reset Successful!
            </Typography>

            <Alert severity="success" sx={{ mb: 3, width: '100%' }}>
              Your password has been reset successfully. You will be redirected to the login page shortly.
            </Alert>
          </Paper>
        </Container>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.6)), url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Container component="main" maxWidth="sm">
        <Paper 
          elevation={10}
          sx={{
            marginTop: 8,
            marginBottom: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: 4,
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(10px)',
            borderRadius: 3,
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          }}
        >
          <SurgeLogo size={100} />
          
          <Typography 
            component="h1" 
            variant="h4" 
            sx={{ 
              mt: 2, 
              mb: 1, 
              color: '#fff',
              textAlign: 'center',
              fontWeight: 'bold'
            }}
          >
            Reset Your Password
          </Typography>

          <Typography 
            variant="body1" 
            sx={{ 
              mb: 3, 
              color: '#ccc',
              textAlign: 'center'
            }}
          >
            Enter your new password below
          </Typography>

          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            <TextField
              fullWidth
              label="New Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
              error={password && !validatePassword(password).isValid}
              helperText={
                password && !validatePassword(password).isValid
                  ? validatePassword(password).message
                  : '(8+ chars, 1 uppercase, 1 number, 1 special character)'
              }
              sx={{
                '& .MuiInputLabel-root': { color: '#ccc' },
                '& .MuiOutlinedInput-root': {
                  color: '#fff',
                  height: '56px',
                  '& fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
                  '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
                  '&.Mui-focused fieldset': { borderColor: '#07938f' }
                },
                '& .MuiFormHelperText-root': { 
                  color: password && !validatePassword(password).isValid 
                    ? '#f44336' 
                    : '#888'
                }
              }}
            />

            <TextField
              fullWidth
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              margin="normal"
              required
              error={confirmPassword && password !== confirmPassword}
              helperText={
                confirmPassword && password !== confirmPassword
                  ? 'Passwords do not match'
                  : ''
              }
              sx={{
                '& .MuiInputLabel-root': { color: '#ccc' },
                '& .MuiOutlinedInput-root': {
                  color: '#fff',
                  height: '56px',
                  '& fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
                  '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
                  '&.Mui-focused fieldset': { borderColor: '#07938f' }
                },
                '& .MuiFormHelperText-root': { color: '#f44336' }
              }}
            />

            {error && (
              <Alert severity="error" sx={{ mt: 2, mb: 2 }}>
                {error}
              </Alert>
            )}

            <Button
              type="submit"
              fullWidth
              variant="contained"
              disabled={loading}
              sx={{
                mt: 3,
                mb: 2,
                backgroundColor: '#07938f',
                '&:hover': { backgroundColor: '#065a57' },
                '&:disabled': { backgroundColor: 'rgba(255,255,255,0.1)' }
              }}
            >
              {loading ? 'Updating Password...' : 'Reset Password'}
            </Button>
          </form>
        </Paper>
      </Container>
    </Box>
  );
}

export default PasswordReset;