"""
Email Template Renderer
Renders email templates with themes and content
"""

from jinja2 import Environment, Template, select_autoescape
from pathlib import Path
from typing import Dict, Any

class EmailRenderer:
    """Handles email template rendering"""
    
    def __init__(self):
        """Initialize Jinja2 environment"""
        self.template_dir = Path(__file__).parent
        # Use direct template content instead of file loader to avoid path issues
        self.env = Environment(autoescape=select_autoescape(['html', 'xml']))
    
    def render_verification_email(self, theme: Dict[str, Any], content: Dict[str, Any]) -> tuple:
        """Render verification email HTML and text versions"""
        
        # Get template content
        template_content = self._get_verification_template()
        template = self.env.from_string(template_content)
        
        # Merge theme and content
        template_vars = {
            'theme': theme,
            **content
        }
        
        # Render HTML version
        html_content = template.render(template_vars)
        
        # Generate text version
        text_content = self._generate_text_version(content)
        
        return html_content, text_content
    
    def render_password_reset_email(self, theme: Dict[str, Any], content: Dict[str, Any]) -> tuple:
        """Render password reset email HTML and text versions"""
        
        # Get template content (reuse verification template structure but with different content)
        template_content = self._get_verification_template()
        template = self.env.from_string(template_content)
        
        # Merge theme and content
        template_vars = {
            'theme': theme,
            **content
        }
        
        # Render HTML version
        html_content = template.render(template_vars)
        
        # Generate text version
        text_content = self._generate_password_reset_text_version(content)
        
        return html_content, text_content
    
    def _get_verification_template(self) -> str:
        """Get the verification email template content"""
        return '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ email_title }}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: {{ theme.font_family }};
            line-height: 1.6;
            color: {{ theme.text_color }};
            background-color: {{ theme.background_color }};
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: {{ theme.container_background }};
            border-radius: {{ theme.border_radius }};
            overflow: hidden;
            box-shadow: {{ theme.box_shadow }};
        }
        
        .header {
            background: {{ theme.header_background }};
            padding: {{ theme.header_padding }};
            text-align: center;
            border-bottom: {{ theme.header_border }};
        }
        
        .header h1 {
            color: {{ theme.header_text_color }};
            font-size: {{ theme.header_font_size }};
            margin: {{ theme.header_margin }};
            font-weight: {{ theme.header_font_weight }};
        }
        
        .content { padding: {{ theme.content_padding }}; }
        
        .welcome-section {
            background: {{ theme.welcome_background }};
            padding: {{ theme.welcome_padding }};
            border-radius: {{ theme.welcome_border_radius }};
            margin-bottom: {{ theme.section_margin }};
            border-left: {{ theme.welcome_accent_border }};
        }
        
        .welcome-section h2 {
            color: {{ theme.welcome_title_color }};
            font-size: {{ theme.welcome_title_size }};
            margin-bottom: {{ theme.welcome_title_margin }};
        }
        
        .welcome-section p {
            color: {{ theme.welcome_text_color }};
            font-size: {{ theme.welcome_text_size }};
            line-height: {{ theme.welcome_line_height }};
        }
        
        .action-section {
            text-align: center;
            margin: {{ theme.action_margin }};
        }
        
        .cta-button {
            display: inline-block;
            background: {{ theme.button_background }};
            color: {{ theme.button_text_color }} !important;
            padding: {{ theme.button_padding }};
            text-decoration: none;
            border-radius: {{ theme.button_border_radius }};
            font-weight: {{ theme.button_font_weight }};
            font-size: {{ theme.button_font_size }};
            border: {{ theme.button_border }};
            box-shadow: {{ theme.button_shadow }};
        }
        
        .security-note {
            background: {{ theme.security_background }};
            border: {{ theme.security_border }};
            border-left: {{ theme.security_accent_border }};
            padding: {{ theme.security_padding }};
            border-radius: {{ theme.security_border_radius }};
            margin: {{ theme.section_margin }};
        }
        
        .security-note strong { color: {{ theme.security_title_color }}; }
        .security-note p {
            color: {{ theme.security_text_color }};
            font-size: {{ theme.security_text_size }};
            margin: 0;
        }
        
        .backup-link {
            background: {{ theme.backup_background }};
            padding: {{ theme.backup_padding }};
            border-radius: {{ theme.backup_border_radius }};
            margin: {{ theme.section_margin }};
            border-top: {{ theme.backup_border }};
        }
        
        .backup-link p {
            color: {{ theme.backup_text_color }};
            font-size: {{ theme.backup_text_size }};
            margin-bottom: 10px;
        }
        
        .backup-url {
            background: {{ theme.backup_url_background }};
            padding: {{ theme.backup_url_padding }};
            border-radius: {{ theme.backup_url_border_radius }};
            word-break: break-all;
            font-family: {{ theme.monospace_font }};
            font-size: {{ theme.backup_url_size }};
            color: {{ theme.backup_url_color }};
            border: {{ theme.backup_url_border }};
        }
        
        .footer {
            background: {{ theme.footer_background }};
            padding: {{ theme.footer_padding }};
            text-align: center;
            border-top: {{ theme.footer_border }};
        }
        
        .footer p {
            color: {{ theme.footer_text_color }};
            font-size: {{ theme.footer_text_size }};
            margin: {{ theme.footer_text_margin }};
        }
        
        @media (max-width: 600px) {
            .email-container { margin: 10px; border-radius: {{ theme.mobile_border_radius }}; }
            .header h1 { font-size: {{ theme.mobile_header_size }}; }
            .cta-button { padding: {{ theme.mobile_button_padding }}; font-size: {{ theme.mobile_button_size }}; }
            .content { padding: {{ theme.mobile_content_padding }}; }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            {% if theme.show_logo and logo_url %}
            <img src="{{ logo_url }}" alt="{{ company_name }}" style="max-width: {{ theme.logo_max_width }}; height: auto;">
            {% endif %}
            <h1>{{ header_title }}</h1>
            {% if header_subtitle %}
            <p style="color: {{ theme.header_subtitle_color }}; font-size: {{ theme.header_subtitle_size }}; margin-top: 10px;">
                {{ header_subtitle }}
            </p>
            {% endif %}
        </div>
        
        <div class="content">
            <div class="welcome-section">
                <h2>{{ welcome_title }}</h2>
                <p>{{ welcome_message }}</p>
            </div>
            
            <div class="action-section">
                <a href="{{ verification_url }}" class="cta-button">
                    {{ button_text }}
                </a>
            </div>
            
            <div class="security-note">
                <p><strong>{{ security_title }}:</strong> {{ security_message }}</p>
            </div>
            
            <div class="backup-link">
                <p>{{ backup_text }}</p>
                <div class="backup-url">{{ verification_url }}</div>
            </div>
        </div>
        
        <div class="footer">
            <p>{{ footer_message }}</p>
            <p style="font-weight: bold; margin-top: 15px;">{{ company_signature }}</p>
            
            {% if social_links %}
            <div style="margin-top: 15px;">
                {% for link in social_links %}
                <a href="{{ link.url }}" style="display: inline-block; margin: 0 10px; color: {{ theme.social_link_color }}; text-decoration: none; font-size: {{ theme.social_link_size }};">{{ link.text }}</a>
                {% endfor %}
            </div>
            {% endif %}
        </div>
    </div>
</body>
</html>'''
    
    def _generate_text_version(self, content: Dict[str, Any]) -> str:
        """Generate plain text version"""
        return f'''
{content.get('header_title', 'Surge.video')}
{content.get('header_subtitle', '')}

{content.get('welcome_title', 'Welcome!')}

{content.get('welcome_message', '')}

Please verify your email by visiting this link:
{content.get('verification_url', '')}

{content.get('security_title', 'Security Note')}:
{content.get('security_message', '')}

{content.get('footer_message', '')}

{content.get('company_signature', 'The Surge.video Team')}

---
If you're having trouble with the link above, copy and paste this URL into your browser:
{content.get('verification_url', '')}

Visit us at: {content.get('verification_url', '').split('?')[0] if content.get('verification_url') else 'https://surge.video'}
'''
    
    def _generate_password_reset_text_version(self, content: Dict[str, Any]) -> str:
        """Generate plain text version for password reset"""
        return f'''
{content.get('header_title', 'Password Reset')}
{content.get('header_subtitle', 'Surge.video')}

{content.get('welcome_title', 'Hello')}

{content.get('welcome_message', 'We received a request to reset your password.')}

Reset your password by visiting this link:
{content.get('verification_url', '')}

{content.get('security_title', 'Security Information')}:
{content.get('security_message', 'This link will expire in 1 hour.')}

{content.get('footer_message', 'Keep your account secure.')}

{content.get('company_signature', 'The Surge.video Security Team')}

---
If you're having trouble with the link above, copy and paste this URL into your browser:
{content.get('verification_url', '')}

If you didn't request this password reset, you can safely ignore this email.
'''

# Global renderer instance
renderer = EmailRenderer()