import sys
import os
import json

def application(environ, start_response):
    """
    Simple WSGI application without Flask dependencies
    """
    # Get the request path
    path_info = environ.get('PATH_INFO', '/')
    
    # Simple routing
    if path_info == '/health' or path_info == '/':
        status = '200 OK'
        headers = [
            ('Content-Type', 'application/json'),
            ('Access-Control-Allow-Origin', '*')
        ]
        start_response(status, headers)
        
        response_data = {
            'status': 'pure_wsgi_working',
            'message': 'No Flask dependencies - basic WSGI test',
            'python_version': sys.version,
            'cwd': os.getcwd(),
            'path_info': path_info
        }
        
        return [json.dumps(response_data, indent=2).encode('utf-8')]
    
    elif path_info == '/debug':
        status = '200 OK'
        headers = [
            ('Content-Type', 'application/json'),
            ('Access-Control-Allow-Origin', '*')
        ]
        start_response(status, headers)
        
        response_data = {
            'python_executable': sys.executable,
            'python_version': sys.version,
            'cwd': os.getcwd(),
            'environment_vars': {k: v for k, v in os.environ.items() if 'PYTHON' in k or 'PATH' in k}
        }
        
        return [json.dumps(response_data, indent=2).encode('utf-8')]
    
    else:
        # 404 for other paths
        status = '404 Not Found'
        headers = [('Content-Type', 'text/plain')]
        start_response(status, headers)
        return [b'Not Found']