import React, { useState } from 'react';
import { 
  Container, 
  Paper, 
  TextField, 
  Button, 
  Typography, 
  Box, 
  Alert,
  Tab,
  Tabs
} from '@mui/material';
import SurgeLogo from './SurgeLogo';
import bgImage from './assets/background.jpg';

function AuthComponent({ onLogin }) {
  const [tab, setTab] = useState(0);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    email: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);

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

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    if (tab === 0) {
      // Login
      const result = await onLogin({
        username: formData.username,
        password: formData.password
      });

      if (!result.success) {
        if (result.error.includes('verify your email')) {
          setNeedsVerification(true);
          setShowResendVerification(true);
        }
        setError(result.error || 'Login failed');
      }
    } else {
      // Register - validate passwords match
      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }

      // Password strength validation
      const passwordValidation = validatePassword(formData.password);
      if (!passwordValidation.isValid) {
        setError(passwordValidation.message);
        setLoading(false);
        return;
      }

      try {
        const resp = await fetch('/api/auth/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: formData.username,
            password: formData.password,
            email: formData.email
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          setSuccessMessage(data.message);
          setTab(0); // Switch to login tab
          setFormData({ ...formData, password: '', confirmPassword: '' });
        } else {
          const errorData = await resp.json();
          setError(errorData.error || 'Registration failed');
        }
      } catch (e) {
        setError('Network error: ' + e.message);
      }
    }

    setLoading(false);
  };

  const handleResendVerification = async () => {
    setLoading(true);
    setError('');
    
    try {
      const resp = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: formData.email || formData.username  // Try email field first, then username
        })
      });

      const data = await resp.json();
      
      if (resp.ok) {
        setSuccessMessage(data.message);
        setShowResendVerification(false);
      } else {
        setError(data.error || 'Failed to resend verification email');
      }
    } catch (e) {
      setError('Network error: ' + e.message);
    }
    
    setLoading(false);
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
            padding: '2rem',
            background: 'rgba(17,17,17,0.95)', 
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.1)'
          }}
        >
          <Box textAlign="center" mb={3}>
            <SurgeLogo />
            <Typography variant="h4" style={{ color: '#fff', marginTop: '1rem' }}>
              Surge Installer
            </Typography>
            <Typography variant="body1" style={{ color: '#ccc', marginTop: '0.5rem' }}>
              Sign in to access your personalized media stack installer
            </Typography>
          </Box>

          <Tabs 
            value={tab} 
            onChange={(e, newValue) => setTab(newValue)}
            variant="fullWidth"
            sx={{
              marginBottom: 3,
              '& .MuiTab-root': { color: '#ccc' },
              '& .Mui-selected': { color: '#07938f !important' },
              '& .MuiTabs-indicator': { backgroundColor: '#07938f' }
            }}
          >
            <Tab label="Login" />
            <Tab label="Register" />
          </Tabs>

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Username"
              name="username"
              value={formData.username}
              onChange={handleInputChange}
              margin="normal"
              required
              sx={{
                '& .MuiInputLabel-root': { color: '#ccc' },
                '& .MuiOutlinedInput-root': {
                  color: '#fff',
                  height: '56px',
                  '& fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
                  '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
                  '&.Mui-focused fieldset': { borderColor: '#07938f' }
                }
              }}
            />

            {tab === 1 && (
              <TextField
                fullWidth
                label="Email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleInputChange}
                margin="normal"
                required
                sx={{
                  '& .MuiInputLabel-root': { color: '#ccc' },
                  '& .MuiOutlinedInput-root': {
                    color: '#fff',
                    height: '56px',
                    '& fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
                    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
                    '&.Mui-focused fieldset': { borderColor: '#07938f' }
                  }
                }}
              />
            )}

            <TextField
              fullWidth
              label="Password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleInputChange}
              margin="normal"
              required
              error={tab === 1 && formData.password && !validatePassword(formData.password).isValid}
              helperText={
                tab === 1 && formData.password && !validatePassword(formData.password).isValid
                  ? validatePassword(formData.password).message
                  : tab === 1
                    ? '(8+ chars, 1 uppercase, 1 number, 1 special character)'
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
                '& .MuiFormHelperText-root': { 
                  color: tab === 1 && formData.password && !validatePassword(formData.password).isValid 
                    ? '#f44336' 
                    : '#888'
                }
              }}
            />


            {tab === 1 && (
              <TextField
                fullWidth
                label="Confirm Password"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                margin="normal"
                required
                error={tab === 1 && formData.confirmPassword && formData.password !== formData.confirmPassword}
                helperText={
                  tab === 1 && formData.confirmPassword && formData.password !== formData.confirmPassword
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
            )}

            {error && (
              <Alert severity="error" sx={{ mt: 2, mb: 2 }}>
                {error}
              </Alert>
            )}

            {successMessage && (
              <Alert severity="success" sx={{ mt: 2, mb: 2 }}>
                {successMessage}
              </Alert>
            )}

            {showResendVerification && (
              <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Didn't receive the verification email?
                </Typography>
                <Button 
                  size="small" 
                  onClick={handleResendVerification}
                  disabled={loading}
                  sx={{ color: '#07938f' }}
                >
                  Resend Verification Email
                </Button>
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
              {loading ? 'Please wait...' : (tab === 0 ? 'Login' : 'Register')}
            </Button>

            <Box mt={2} textAlign="center">
              <Typography variant="body2" style={{ color: '#ccc' }}>
                {tab === 0 ? "Don't have an account? " : "Already have an account? "}
                <Button 
                  onClick={() => setTab(tab === 0 ? 1 : 0)}
                  sx={{ color: '#07938f', textTransform: 'none' }}
                >
                  {tab === 0 ? 'Register here' : 'Login here'}
                </Button>
              </Typography>
            </Box>
          </form>
        </Paper>
      </Container>
    </div>
  );
}

export default AuthComponent;