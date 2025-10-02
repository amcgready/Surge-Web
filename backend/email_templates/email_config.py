"""
Email Configuration and Template Manager
Handles email themes, content, and customization for Surge Web Installer
"""

import os
from typing import Dict, Any
from pathlib import Path

# Import themes
from .themes.professional_blue import professional_blue
from .themes.modern_dark import modern_dark
from .themes.minimalist import minimalist
from .themes.gradient_surge import gradient_surge

class EmailConfig:
    """Manages email configuration and templates"""
    
    # Available themes
    THEMES = {
        'professional_blue': professional_blue,
        'modern_dark': modern_dark,
        'minimalist': minimalist,
        'gradient_surge': gradient_surge,
    }
    
    def __init__(self, theme_name='gradient_surge'):
        """Initialize with specified theme"""
        self.theme_name = theme_name
        self.theme = self.THEMES.get(theme_name, gradient_surge)
        self.template_dir = Path(__file__).parent
    
    def get_verification_email_config(self, username: str, verification_url: str) -> Dict[str, Any]:
        """Get configuration for verification email"""
        
        # Default content that can be customized
        content = {
            # Email metadata
            'email_title': 'Confirm Your Surge.video Account',
            'subject': 'Confirm Your Surge.video Account 🚀',
            
            # Header content
            'header_title': 'Welcome to Surge!',
            'header_subtitle': 'Your Media Server Journey Starts Here',
            
            # Welcome section
            'welcome_title': f'Hi {username}! 👋',
            'welcome_message': '''Thank you for joining Surge.video! We're excited to help you build the ultimate media server stack. 
            
            To get started with your personalized installer and begin deploying your services, please verify your email address by clicking the button below.''',
            
            # Call to action
            'button_text': '✨ Verify My Email',
            'verification_url': verification_url,
            
            # Security section
            'security_title': '🔒 Security Note',
            'security_message': '''This verification link will expire in 24 hours for your security. 
            If you didn't create a Surge.video account, you can safely ignore this email.''',
            
            # Backup link section
            'backup_text': '''If the button above doesn't work, copy and paste this link into your browser:''',
            
            # Footer content
            'footer_message': '''Questions? Check out our documentation or reach out to our support team. 
            We're here to help you build an amazing media server experience!''',
            'company_signature': 'The Surge.video Team',
            'company_name': 'Surge.video',
            
            # Optional elements
            'logo_url': self._get_logo_url(),
            'social_links': self._get_social_links(),
            'show_unsubscribe': False,
            'unsubscribe_url': '',
        }
        
        return {
            'theme': self.theme,
            'content': content
        }
    
    def get_welcome_email_config(self, username: str) -> Dict[str, Any]:
        """Get configuration for welcome email after verification"""
        content = {
            'email_title': 'Welcome to Surge.video!',
            'subject': f'🎉 Welcome to Surge, {username}!',
            
            'header_title': 'Account Verified!',
            'header_subtitle': 'You\'re Ready to Build Your Media Stack',
            
            'welcome_title': f'🎉 Welcome aboard, {username}!',
            'welcome_message': '''Your email has been verified and your account is now active! 
            
            You can now access the full Surge installer to deploy and configure your complete media server stack with just a few clicks.''',
            
            'button_text': '🚀 Start Building',
            'verification_url': f'{self._get_base_url()}/',
            
            'security_title': '💡 Next Steps',
            'security_message': '''1. Download the Surge daemon on your server
            2. Configure your media services
            3. Deploy with one click
            4. Enjoy your automated media stack!''',
            
            'backup_text': 'Visit your dashboard:',
            'footer_message': 'Ready to transform your media experience? Let\'s build something amazing together!',
            'company_signature': 'The Surge.video Team',
            'company_name': 'Surge.video',
            
            'logo_url': self._get_logo_url(),
            'social_links': self._get_social_links(),
            'show_unsubscribe': True,
            'unsubscribe_url': f'{self._get_base_url()}/unsubscribe',
        }
        
        return {
            'theme': self.theme,
            'content': content
        }
    
    def get_password_reset_config(self, username: str, reset_url: str) -> Dict[str, Any]:
        """Get configuration for password reset email"""
        content = {
            'email_title': 'Reset Your Surge.video Password',
            'subject': '🔑 Reset Your Surge.video Password',
            
            'header_title': 'Password Reset',
            'header_subtitle': 'Secure Your Account',
            
            'welcome_title': f'Hello {username}',
            'welcome_message': '''We received a request to reset your Surge.video password. 
            
            If you made this request, click the button below to set a new password. If you didn't request this, you can safely ignore this email.''',
            
            'button_text': '🔑 Reset Password',
            'verification_url': reset_url,
            
            'security_title': '🔒 Security Information',
            'security_message': '''This password reset link will expire in 1 hour for security reasons. 
            If you continue to have trouble, please contact our support team.''',
            
            'backup_text': 'If the button doesn\'t work, use this link:',
            'footer_message': 'Keep your account secure and never share your login credentials.',
            'company_signature': 'The Surge.video Security Team',
            'company_name': 'Surge.video',
            
            'logo_url': self._get_logo_url(),
            'social_links': self._get_social_links(),
            'show_unsubscribe': False,
            'unsubscribe_url': '',
        }
        
        return {
            'theme': self.theme,
            'content': content
        }
    
    def _get_base_url(self) -> str:
        """Get base URL based on environment"""
        if os.environ.get('FLASK_ENV') == 'production':
            return 'https://surge.video'
        return 'http://localhost:3100'
    
    def _get_logo_url(self) -> str:
        """Get logo URL"""
        base_url = self._get_base_url()
        return f'{base_url}/assets/Surge.png'
    
    def _get_social_links(self) -> list:
        """Get social media links"""
        return [
            {'text': 'Documentation', 'url': 'https://docs.surge.video'},
            {'text': 'GitHub', 'url': 'https://github.com/amcgready/Surge-Web'},
            {'text': 'Support', 'url': 'https://support.surge.video'},
        ]
    
    def get_text_version(self, content: Dict[str, Any]) -> str:
        """Generate plain text version of email"""
        return f'''
{content['header_title']}
{content.get('header_subtitle', '')}

{content['welcome_title']}

{content['welcome_message']}

Verify your email: {content['verification_url']}

{content['security_title']}
{content['security_message']}

{content['footer_message']}

{content['company_signature']}

---
If the link above doesn't work, copy and paste this URL into your browser:
{content['verification_url']}

{content['company_name']} | {self._get_base_url()}
'''

# Global email configuration
email_config = EmailConfig()

def set_email_theme(theme_name: str):
    """Change the global email theme"""
    global email_config
    if theme_name in EmailConfig.THEMES:
        email_config = EmailConfig(theme_name)
        return True
    return False

def get_available_themes():
    """Get list of available themes with descriptions"""
    return {
        'professional_blue': {
            'name': 'Professional Blue',
            'description': 'Clean, corporate design with blue gradients',
            'best_for': 'Business, professional services'
        },
        'modern_dark': {
            'name': 'Modern Dark', 
            'description': 'Sleek dark theme with green accents',
            'best_for': 'Tech-savvy users, developers'
        },
        'minimalist': {
            'name': 'Minimalist',
            'description': 'Clean, simple design with minimal styling',
            'best_for': 'Simple, distraction-free emails'
        },
        'gradient_surge': {
            'name': 'Gradient Surge (Default)',
            'description': 'Surge-branded theme with teal/blue gradients',
            'best_for': 'Surge.video branding, engaging design'
        }
    }