import sys
import os

def application(environ, start_response):
    """
    Minimal WSGI application for testing
    """
    status = '200 OK'
    headers = [('Content-type', 'application/json')]
    start_response(status, headers)
    
    response_data = {
        'status': 'minimal_wsgi_working',
        'message': 'Basic WSGI test successful',
        'python_version': sys.version,
        'cwd': os.getcwd()
    }
    
    import json
    return [json.dumps(response_data).encode('utf-8')]