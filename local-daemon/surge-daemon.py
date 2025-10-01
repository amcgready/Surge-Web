#!/usr/bin/env python3
"""
Surge Local Daemon
Connects to the Surge web installer and executes commands locally on the user's machine.
"""

import asyncio
import websockets
import json
import subprocess
import os
import sys
import docker
import git
from pathlib import Path
import logging
import hashlib
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SurgeDaemon:
    def __init__(self, server_url="wss://surge.video/socket.io/", auth_token=None):
        self.server_url = server_url
        self.auth_token = auth_token
        self.docker_client = None
        self.websocket = None
        self.user_id = None
        
        # Initialize Docker client
        try:
            self.docker_client = docker.from_env()
            logger.info("Docker client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Docker client: {e}")
            
    async def connect(self):
        """Connect to the Surge web service"""
        try:
            headers = {}
            if self.auth_token:
                headers['Authorization'] = f'Bearer {self.auth_token}'
                
            self.websocket = await websockets.connect(
                self.server_url, 
                extra_headers=headers
            )
            
            logger.info(f"Connected to Surge server at {self.server_url}")
            
            # Send initial handshake
            await self.send_message({
                'type': 'handshake',
                'client_info': {
                    'platform': sys.platform,
                    'docker_available': self.docker_client is not None,
                    'git_available': self.check_git_available()
                }
            })
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            return False
    
    def check_git_available(self):
        """Check if git is available on the system"""
        try:
            subprocess.run(['git', '--version'], capture_output=True, check=True)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False
    
    async def send_message(self, message):
        """Send message to web service"""
        if self.websocket:
            await self.websocket.send(json.dumps(message))
    
    async def handle_docker_command(self, command_data):
        """Execute Docker commands"""
        try:
            cmd_type = command_data.get('cmd_type')
            
            if cmd_type == 'compose_up':
                return await self.docker_compose_up(command_data)
            elif cmd_type == 'compose_down':
                return await self.docker_compose_down(command_data)
            elif cmd_type == 'pull_image':
                return await self.docker_pull_image(command_data)
            else:
                return {'success': False, 'error': f'Unknown docker command: {cmd_type}'}
                
        except Exception as e:
            logger.error(f"Docker command failed: {e}")
            return {'success': False, 'error': str(e)}
    
    async def docker_compose_up(self, command_data):
        """Run docker-compose up"""
        compose_file = command_data.get('compose_file')
        env_vars = command_data.get('env_vars', {})
        working_dir = command_data.get('working_dir', '/tmp/surge-deploy')
        
        # Create working directory
        os.makedirs(working_dir, exist_ok=True)
        
        # Write compose file
        compose_path = os.path.join(working_dir, 'docker-compose.yml')
        with open(compose_path, 'w') as f:
            f.write(compose_file)
        
        # Write .env file if provided
        if env_vars:
            env_path = os.path.join(working_dir, '.env')
            with open(env_path, 'w') as f:
                for key, value in env_vars.items():
                    f.write(f"{key}={value}\n")
        
        # Execute docker-compose up
        cmd = ['docker-compose', '-f', compose_path, 'up', '-d']
        
        await self.send_message({
            'type': 'progress',
            'message': f'Running: {" ".join(cmd)}'
        })
        
        process = subprocess.Popen(
            cmd, 
            cwd=working_dir,
            stdout=subprocess.PIPE, 
            stderr=subprocess.STDOUT,
            universal_newlines=True
        )
        
        output_lines = []
        while True:
            output = process.stdout.readline()
            if output == '' and process.poll() is not None:
                break
            if output:
                line = output.strip()
                output_lines.append(line)
                await self.send_message({
                    'type': 'progress',
                    'message': line
                })
        
        return_code = process.poll()
        
        return {
            'success': return_code == 0,
            'output': '\n'.join(output_lines),
            'return_code': return_code
        }
    
    async def docker_compose_down(self, command_data):
        """Run docker-compose down"""
        working_dir = command_data.get('working_dir', '/tmp/surge-deploy')
        compose_path = os.path.join(working_dir, 'docker-compose.yml')
        
        cmd = ['docker-compose', '-f', compose_path, 'down']
        
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=working_dir)
        
        return {
            'success': result.returncode == 0,
            'output': result.stdout + result.stderr,
            'return_code': result.returncode
        }
    
    async def docker_pull_image(self, command_data):
        """Pull a Docker image"""
        image = command_data.get('image')
        
        try:
            await self.send_message({
                'type': 'progress',
                'message': f'Pulling image: {image}'
            })
            
            self.docker_client.images.pull(image)
            
            return {
                'success': True,
                'message': f'Successfully pulled {image}'
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'Failed to pull {image}: {str(e)}'
            }
    
    async def handle_git_command(self, command_data):
        """Execute Git commands"""
        try:
            cmd_type = command_data.get('cmd_type')
            
            if cmd_type == 'clone':
                return await self.git_clone(command_data)
            elif cmd_type == 'pull':
                return await self.git_pull(command_data)
            else:
                return {'success': False, 'error': f'Unknown git command: {cmd_type}'}
                
        except Exception as e:
            logger.error(f"Git command failed: {e}")
            return {'success': False, 'error': str(e)}
    
    async def git_clone(self, command_data):
        """Clone a git repository"""
        repo_url = command_data.get('repo_url')
        dest_path = command_data.get('dest_path')
        branch = command_data.get('branch', 'main')
        
        await self.send_message({
            'type': 'progress',
            'message': f'Cloning {repo_url} to {dest_path}'
        })
        
        try:
            # Use GitPython for better progress reporting
            def progress_callback(op_code, cur_count, max_count=None, message=''):
                if max_count:
                    percent = (cur_count / max_count) * 100
                    asyncio.create_task(self.send_message({
                        'type': 'progress',
                        'message': f'Clone progress: {percent:.1f}% - {message}'
                    }))
            
            repo = git.Repo.clone_from(
                repo_url, 
                dest_path, 
                branch=branch,
                progress=progress_callback
            )
            
            return {
                'success': True,
                'message': f'Successfully cloned {repo_url}',
                'commit_hash': str(repo.head.commit)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'Failed to clone {repo_url}: {str(e)}'
            }
    
    async def git_pull(self, command_data):
        """Pull updates for a git repository"""
        repo_path = command_data.get('repo_path')
        
        try:
            repo = git.Repo(repo_path)
            origin = repo.remotes.origin
            origin.pull()
            
            return {
                'success': True,
                'message': f'Successfully updated {repo_path}',
                'commit_hash': str(repo.head.commit)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'Failed to pull {repo_path}: {str(e)}'
            }
    
    async def handle_file_command(self, command_data):
        """Handle file operations"""
        try:
            cmd_type = command_data.get('cmd_type')
            
            if cmd_type == 'write_file':
                return await self.write_file(command_data)
            elif cmd_type == 'create_dir':
                return await self.create_directory(command_data)
            else:
                return {'success': False, 'error': f'Unknown file command: {cmd_type}'}
                
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    async def write_file(self, command_data):
        """Write content to a file"""
        file_path = command_data.get('file_path')
        content = command_data.get('content')
        
        try:
            # Create directories if needed
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            
            with open(file_path, 'w') as f:
                f.write(content)
            
            return {
                'success': True,
                'message': f'Successfully wrote file: {file_path}'
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'Failed to write file {file_path}: {str(e)}'
            }
    
    async def create_directory(self, command_data):
        """Create a directory"""
        dir_path = command_data.get('dir_path')
        
        try:
            os.makedirs(dir_path, exist_ok=True)
            
            return {
                'success': True,
                'message': f'Successfully created directory: {dir_path}'
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'Failed to create directory {dir_path}: {str(e)}'
            }
    
    async def listen(self):
        """Listen for commands from the web service"""
        try:
            async for message in self.websocket:
                try:
                    data = json.loads(message)
                    command_type = data.get('type')
                    
                    logger.info(f"Received command: {command_type}")
                    
                    if command_type == 'docker':
                        result = await self.handle_docker_command(data)
                    elif command_type == 'git':
                        result = await self.handle_git_command(data)
                    elif command_type == 'file':
                        result = await self.handle_file_command(data)
                    elif command_type == 'ping':
                        result = {'success': True, 'message': 'pong'}
                    else:
                        result = {'success': False, 'error': f'Unknown command type: {command_type}'}
                    
                    # Send result back to web service
                    await self.send_message({
                        'type': 'result',
                        'command_id': data.get('command_id'),
                        'result': result
                    })
                    
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON received: {e}")
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info("Connection to server closed")
        except Exception as e:
            logger.error(f"Error in listen loop: {e}")
    
    async def run(self):
        """Main run loop"""
        while True:
            if await self.connect():
                try:
                    await self.listen()
                except Exception as e:
                    logger.error(f"Connection error: {e}")
            
            logger.info("Reconnecting in 5 seconds...")
            await asyncio.sleep(5)

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Surge Local Daemon')
    parser.add_argument('--server', default='wss://surge.video/socket.io/', 
                       help='WebSocket server URL')
    parser.add_argument('--token', help='Authentication token')
    
    args = parser.parse_args()
    
    daemon = SurgeDaemon(server_url=args.server, auth_token=args.token)
    
    try:
        asyncio.run(daemon.run())
    except KeyboardInterrupt:
        logger.info("Daemon stopped by user")

if __name__ == '__main__':
    main()