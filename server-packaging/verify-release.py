#!/usr/bin/env python3
"""Independently extract and verify a server ZIP; smoke uses only its bundled Node."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import pty
import re
import select
import signal
import socket
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

from release_contract import (ARCHIVE_BYTES, ARCHIVE_SHA256, BINARY_SHA256, CHECKS, ENTRYPOINTS, LICENSE_SHA256,
                              NODE_URL, NODE_VERSION, digest, read_checksums, read_json, require,
                              safe_name, validate_hash)


def extract_archive(archive_path, destination):
    """Reject traversal, duplicates, symlinks and special files before writing anything."""
    with zipfile.ZipFile(archive_path) as archive:
        seen = set()
        members = archive.infolist()
        require(bool(members), 'Empty server ZIP')
        require(sum(item.file_size for item in members) <= 2 * 1024 ** 3, 'Server ZIP exceeds bounded extraction size')
        for item in members:
            name = item.filename.rstrip('/') if item.is_dir() else item.filename
            safe_name(name)
            require(name.startswith('qingdan-server/') or item.is_dir() and name == 'qingdan-server',
                    f'Unexpected ZIP root: {name}')
            require(name not in seen, f'Duplicate ZIP entry: {name}')
            seen.add(name)
            mode = item.external_attr >> 16
            require(not item.flag_bits & 1, 'Encrypted ZIP entries are unsupported')
            require(stat.S_ISDIR(mode) if item.is_dir() else stat.S_ISREG(mode),
                    f'ZIP entry must be a regular file or directory: {name}')
        require(archive.testzip() is None, 'ZIP CRC integrity check failed')
        for item in members:
            target = destination / item.filename
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as source, target.open('xb') as output:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
                target.chmod((item.external_attr >> 16) & 0o777)
    return destination / 'qingdan-server'


def verify_structure(root):
    """Check the extracted payload independently of the assembly/copy workflow."""
    require(root.is_dir() and not root.is_symlink(), 'A regular extracted server directory is required')
    manifest = read_json(root / 'SERVER-MANIFEST.json')
    require(manifest.get('product') == 'qingdan-server-web', 'Unexpected server product')
    snapshot = manifest.get('application_source_snapshot_sha256')
    validate_hash(snapshot, 'application source snapshot')
    require(manifest.get('platforms') == ['linux-x64-glibc', 'darwin-arm64'], 'Missing supported platform payload')
    require(manifest.get('runtime') == f'official Node.js {NODE_VERSION}', 'Unexpected bundled runtime version')
    inventory = manifest.get('files_sha256')
    require(isinstance(inventory, dict) and bool(inventory), 'Missing server file inventory')
    actual = {}
    for path in sorted(root.rglob('*')):
        name = path.relative_to(root).as_posix()
        safe_name(name)
        require(not path.is_symlink(), f'Symlink in extracted server: {name}')
        require(not {'data', '.git'}.intersection(path.relative_to(root).parts), f'User data in release: {name}')
        require(path.is_file() or path.is_dir(), f'Special file in extracted server: {name}')
        if path.is_file() and name != 'SERVER-MANIFEST.json':
            actual[name] = digest(path)
    for name, expected in inventory.items():
        safe_name(name)
        validate_hash(expected, name)
    require(actual == inventory, 'Extracted file inventory differs from SERVER-MANIFEST.json')
    required = set(ENTRYPOINTS) | {'launcher/launch-server.mjs', '先读我.txt',
               'app/package.json', 'app/package-lock.json', 'app/RUNTIME-MANIFEST.json',
               'app/dist/client/index.html', 'app/dist/server/main.mjs', 'app/dist/server/users.mjs', 'app/dist/server/calendar-worker.mjs',
               'runtime/SHASUMS256.txt', 'runtime/NODE-RUNTIMES.json'}
    required |= {f'runtime/{arch}/{name}' for arch in ARCHIVE_SHA256 for name in ('node', 'LICENSE')}
    require(required <= set(inventory), 'Missing server launch/runtime/application payload')
    for name in ENTRYPOINTS + tuple(f'runtime/{arch}/node' for arch in ARCHIVE_SHA256):
        require((root / name).stat().st_mode & 0o111, f'Extracted executable permission missing: {name}')
    package = read_json(root / 'app/package.json')
    application = read_json(root / 'app/RUNTIME-MANIFEST.json')
    require(application.get('product') == 'qingdan-standalone', 'Unexpected application product')
    require(isinstance(manifest.get('version'), str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', manifest['version']),
            'Missing concrete server version')
    require(manifest['version'] == package.get('version') == application.get('version'), 'Extracted application version mismatch')
    require(snapshot == application.get('source_snapshot_sha256'), 'Application source snapshot mismatch')
    require(all(application.get('checks', {}).get(key) for key in CHECKS), 'Incomplete source-check evidence')
    app_inventory = application.get('files_sha256')
    require(isinstance(app_inventory, dict) and bool(app_inventory), 'Missing checked application file inventory')
    for name, expected in app_inventory.items():
        safe_name(name)
        validate_hash(expected, name)
        require(inventory.get('app/' + name) == expected, f'Checked application file mismatch: {name}')
    non_dependencies = {name[4:]: value for name, value in inventory.items()
                        if name.startswith('app/') and not name.startswith('app/node_modules/') and name != 'app/RUNTIME-MANIFEST.json'}
    require(non_dependencies == app_inventory, 'Unlisted application files in extracted server')
    require(any(re.fullmatch(r'drizzle/\d{4}_[A-Za-z0-9_-]+\.sql', name) for name in app_inventory), 'Missing database migrations')
    lock = read_json(root / 'app/package-lock.json')
    locked = lock.get('packages', {})
    require(lock.get('lockfileVersion') in (2, 3) and lock.get('version') == package['version'], 'Dependency lock version mismatch')
    require(locked.get('', {}).get('dependencies') == package.get('dependencies') and package.get('dependencies'),
            'Production dependency declarations differ from lock')
    for name in package['dependencies']:
        path = 'node_modules/' + name + '/package.json'
        safe_name(path)
        installed = read_json(root / 'app' / path)
        require(installed.get('name') == name and installed.get('version') == locked.get('node_modules/' + name, {}).get('version'),
                f'Production dependency differs from lock: {name}')
    for name, record in locked.items():
        if name and record.get('dev') is True:
            require('app/' + safe_name(name) + '/package.json' not in inventory, f'Development dependency bundled: {name}')
    require('dependency-manifest.json' in app_inventory, 'Missing checked dependency file inventory')
    dependency = read_json(root / 'app/dependency-manifest.json')
    require(dependency.get('source_snapshot_sha256') == snapshot, 'Dependency source snapshot mismatch')
    validate_hash(dependency.get('application_lock_sha256'), 'application lock provenance')
    require(dependency.get('external_imports') == application.get('external_imports') and isinstance(dependency.get('external_imports'), list),
            'Compiled external imports differ from dependency evidence')
    dependencies = dependency.get('packages')
    require(isinstance(dependencies, list) and all(isinstance(record, dict) for record in dependencies), 'Missing dependency package records')
    locations = [record.get('location') for record in dependencies]
    require(len(locations) == len(set(locations)) and set(locations) == set(locked) - {''}, 'Transitive dependency closure differs from runtime lock')
    dependency_files = {}
    for record in dependencies:
        location = safe_name(record['location'])
        require(location.startswith('node_modules/'), 'Unsafe dependency package location')
        for field in ('version', 'resolved', 'integrity', 'license'):
            require(record.get(field) == locked[location].get(field), f'Locked transitive dependency {field} mismatch: {location}')
        require(isinstance(record.get('resolved'), str) and record['resolved'].startswith('https://registry.npmjs.org/') and
                isinstance(record.get('integrity'), str) and re.fullmatch(r'sha512-[A-Za-z0-9+/]+={0,2}', record['integrity']),
                f'Missing pinned npm provenance: {location}')
        installed = read_json(root / 'app' / location / 'package.json')
        require(installed.get('name') == record.get('name') and installed.get('version') == record['version'],
                f'Installed transitive dependency metadata mismatch: {location}')
        package_files = record.get('files_sha256')
        require(isinstance(package_files, dict) and bool(package_files), 'Missing dependency file hashes')
        actual_package_files = {name[len('app/' + location + '/'):]: value for name, value in inventory.items()
                                if name.startswith('app/' + location + '/') and not name[len('app/' + location + '/'):].startswith('node_modules/')}
        require(actual_package_files == package_files, f'Dependency file inventory mismatch: {location}')
        for name, expected in package_files.items():
            safe_name(name)
            validate_hash(expected, name)
            dependency_files['app/' + location + '/' + name] = expected
    actual_dependency_files = {name: value for name, value in inventory.items()
                               if name.startswith('app/node_modules/') and name != 'app/node_modules/.package-lock.json'}
    require(actual_dependency_files == dependency_files, 'Unlisted installed dependencies in extracted server')
    read_checksums(root / 'runtime/SHASUMS256.txt')
    records = read_json(root / 'runtime/NODE-RUNTIMES.json')
    require(isinstance(records, list) and len(records) == 2 and
            all(isinstance(record, dict) for record in records) and
            {record.get('arch') for record in records} == set(ARCHIVE_SHA256), 'Invalid official Node runtime records')
    for record in records:
        arch = record['arch']
        filename = f'node-v{NODE_VERSION}-{arch}.tar.xz'
        node = root / 'runtime' / arch / 'node'
        require(record.get('filename') == filename and record.get('url') == NODE_URL + filename and
                record.get('sha256') == ARCHIVE_SHA256[arch], f'Pinned archive provenance mismatch: {arch}')
        require(type(record.get('bytes')) is int and record['bytes'] == ARCHIVE_BYTES[arch], f'Pinned official archive byte size mismatch: {arch}')
        require(inventory[f'runtime/{arch}/node'] == BINARY_SHA256[arch] == record.get('node_sha256'),
                f'Pinned official Node binary mismatch: {arch}')
        require(type(record.get('node_bytes')) is int and record['node_bytes'] == node.stat().st_size,
                f'Official Node byte size mismatch: {arch}')
        require(inventory[f'runtime/{arch}/LICENSE'] == LICENSE_SHA256, f'Pinned official Node license mismatch: {arch}')
        with node.open('rb') as stream:
            magic = stream.read(8)
        require(magic.startswith(b'\x7fELF\x02\x01') if arch == 'linux-x64' else magic.startswith(b'\xcf\xfa\xed\xfe'),
                f'Unexpected Node executable format: {arch}')
    readme = (root / '先读我.txt').read_text(encoding='utf-8')
    require(manifest['version'] in readme and snapshot in readme and '{{' not in readme, 'Stale server readme provenance')
    return manifest


class Smoke:
    def __init__(self, root, work, version):
        self.root, self.work, self.version = root, work, version
        self.checks, self.processes = [], []
        self.home = work / 'synthetic home 合成数据'
        self.home.mkdir()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            self.port = listener.getsockname()[1]
        self.origin = f'http://127.0.0.1:{self.port}'
        # Run hermetically: host NODE_OPTIONS/NODE_PATH, proxies, test overrides,
        # account credentials and other application variables never reach this fixture.
        self.env = {'PATH': os.defpath, 'HOME': str(self.home), 'TMPDIR': str(work),
                    'LANG': 'C.UTF-8', 'TZ': 'UTC', 'TERM': 'xterm'}
        self.env.update(QINGDAN_SERVER_HOME=str(self.home), QINGDAN_NO_OPEN='1', HOST='127.0.0.1',
                        PORT=str(self.port), APP_ORIGIN=self.origin)
        self.secrets = []
        self.log_path = work / 'synthetic-server.log'
        self.log = self.log_path.open('ab', buffering=0)
        # Do not honor inherited proxy variables for loopback smoke requests.
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def passed(self, name):
        self.checks.append(name)

    def call(self, path, body=None, auth=None, extra=None):
        headers = {'x-qingdan': '1', 'Connection': 'close'}
        if auth:
            if auth.get('cookie'):
                headers['Cookie'] = auth['cookie']
            headers['x-qingdan-csrf'] = auth['csrfToken']
            headers['x-qingdan-expected-account'] = auth['user']['userId']
        if extra:
            headers.update(extra)
        if body is not None:
            headers.update(Origin=self.origin)
            if not isinstance(body, bytes):
                headers['Content-Type'] = 'application/json'
                body = json.dumps(body, ensure_ascii=False).encode()
        request = urllib.request.Request(self.origin + path, data=body, headers=headers)
        try:
            response = self.http.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, {name.lower(): value for name, value in response.headers.items()}, response.read()

    def json(self, path, body=None, auth=None):
        status, headers, data = self.call(path, body, auth)
        result = json.loads(data)
        require(200 <= status < 300, f'HTTP smoke request failed: {path} ({status})')
        return result, headers

    def start(self, command=('start.sh',), extra_env=None, expected_mode='local'):
        env = {**self.env, **(extra_env or {})}
        process = subprocess.Popen([str(self.root / command[0]), *command[1:]], cwd=self.work,
                                   env=env, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log,
                                   start_new_session=True)
        self.processes.append(process)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise ValueError(f'Bundled server launcher exited before readiness ({process.returncode})')
            try:
                info, _ = self.json('/api/app-info')
                require(info == {'app': 'qingdan', 'version': self.version, 'mode': expected_mode},
                        'HTTP app/version/mode differs from extracted manifest')
                state = read_json(self.home / 'running/process.json')
                require(state.get('pid') == process.pid and state.get('launcherPath') == str(self.root / 'launcher/launch-server.mjs') and
                        state.get('mode') == expected_mode, 'HTTP readiness is not owned by this extracted launcher')
                return process
            except (OSError, urllib.error.URLError, json.JSONDecodeError):
                time.sleep(0.1)
        raise ValueError('Bundled server did not become ready within 20 seconds')

    def stop(self, process, entry='stop.sh'):
        stopper = subprocess.Popen([str(self.root / entry)], cwd=self.work, env=self.env,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True)
        self.processes.append(stopper)
        # Reap the launched server while stop inspects its PID, avoiding a parent-held zombie.
        deadline = time.monotonic() + 20
        while stopper.poll() is None and time.monotonic() < deadline:
            process.poll()
            time.sleep(0.025)
        stopper.communicate(timeout=max(0.1, deadline - time.monotonic()))
        require(stopper.returncode == 0, f'{entry} failed during smoke')
        process.wait(timeout=15)
        require(process.returncode == 0, 'Server did not exit cleanly after stop')
        require(not (self.home / 'running').exists(), 'Server lock not cleared after normal stop')

    def task(self, auth, identifier, title, revision=0):
        state, _ = self.json('/api/data', auth=auth)
        inbox = next((record for record in state['records'] if record['kind'] == 'list'), None)
        require(inbox is not None, 'Fresh data has no inbox list')
        result, _ = self.json('/api/data', {'operation': 'upsert', 'kind': 'task', 'id': identifier,
                             'expectedRevision': revision, 'clientOperationId': str(uuid.uuid4()),
                             'data': {'title': title, 'status': 'open', 'listId': inbox['id'], 'priority': 2, 'checkItems': []}}, auth)
        require(result['record']['data']['title'] == title, 'Task mutation did not persist expected title')
        return result['record']

    def init_admin(self):
        password = 'Synthetic release smoke password 2026!'
        self.secrets.append(password)
        master, slave = pty.openpty()
        process = subprocess.Popen([str(self.root / 'init-admin.sh')], cwd=self.work, env=self.env,
                                   stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        self.processes.append(process)
        prompts = [('账号邮箱：', 'admin@example.test'), ('显示姓名：', '合成管理员'),
                   ('密码（15–128 字符，不回显）：', password), ('再次输入密码（不回显）：', password)]
        transcript, next_prompt = b'', 0
        deadline = time.monotonic() + 20
        try:
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        chunk = os.read(master, 8192)
                    except OSError:
                        break
                    if not chunk:
                        break
                    transcript += chunk
                    text = transcript.decode('utf-8', errors='replace')
                    if next_prompt < len(prompts) and prompts[next_prompt][0] in text:
                        os.write(master, (prompts[next_prompt][1] + '\n').encode())
                        next_prompt += 1
                elif process.poll() is not None:
                    break
            process.wait(timeout=max(0.1, deadline - time.monotonic()))
        finally:
            os.close(master)
        text = transcript.decode('utf-8', errors='replace')
        require(next_prompt == 4 and process.returncode == 0 and '管理员已初始化。' in text,
                'Synthetic interactive first-admin initialization failed')
        require(password not in text, 'Interactive initializer echoed the synthetic password')
        self.passed('interactive first administrator with hidden synthetic password')
        return password

    def run(self):
        system = (platform.system(), platform.machine())
        arch = {('Linux', 'x86_64'): 'linux-x64', ('Darwin', 'arm64'): 'darwin-arm64'}.get(system)
        require(arch is not None, 'HTTP smoke must run natively on supported Linux x64 or macOS arm64')
        node = self.root / 'runtime' / arch / 'node'
        result = subprocess.run([str(node), '--version'], capture_output=True, text=True, timeout=10)
        require(result.returncode == 0 and result.stdout.strip() == f'v{NODE_VERSION}', 'Bundled official Node does not execute as pinned version')
        self.passed('native bundled official Node executable')
        calendar_check = self.work / 'synthetic-calendar-worker-check.mjs'
        calendar_check.write_text("""import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Synthetic release fixture//EN',
 'BEGIN:VEVENT','UID:release-fixture','DTSTART:20261009T090000Z','DTEND:20261009T100000Z',
 'SUMMARY:Synthetic release calendar','END:VEVENT','END:VCALENDAR',''].join('\\r\\n');
const range={from:'2026-10-01T00:00:00Z',through:'2026-10-31T00:00:00Z',timeZone:'UTC'};
const worker=new Worker(pathToFileURL(process.argv[2]),{workerData:{text,range},resourceLimits:{maxOldGenerationSizeMb:64}});
let timer;
try{
 const result=await new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(Error('Synthetic calendar worker timeout')),5000);
  worker.once('message',resolve);worker.once('error',reject);
  worker.once('exit',()=>reject(Error('Synthetic calendar worker exited before result')));
 });
 assert(!result.error);assert.equal(result.events.length,1);
 assert.equal(result.events[0].title,'Synthetic release calendar');
 assert.equal(result.events[0].start,'2026-10-09T09:00:00.000Z');assert.equal(result.events[0].readOnly,true);
 console.log('synthetic bundled calendar worker passed');
}finally{clearTimeout(timer);await worker.terminate();}
""", encoding='utf-8')
        calendar = subprocess.run([str(node), str(calendar_check), str(self.root / 'app/dist/server/calendar-worker.mjs')],
                                  cwd=self.root / 'app', env=self.env, capture_output=True, text=True, timeout=12)
        require(calendar.returncode == 0 and 'synthetic bundled calendar worker passed' in calendar.stdout,
                'Bundled calendar worker or locked transitive dependencies failed synthetic execution')
        self.passed('synthetic bundled calendar worker and locked transitive dependency execution')
        process = self.start()  # no arguments: exercises the preserved default-start fix
        self.passed('no-argument start.sh with owned launcher readiness')
        status, headers, html = self.call('/')
        require(status == 200 and b'<html' in html.lower() and "script-src 'self'" in headers.get('content-security-policy', ''),
                'Compiled web entrypoint or CSP missing')
        assets = re.findall(r'(?:src|href)=["\'](/(?:assets|offline-assets)/[^"\']+)["\']', html.decode('utf-8'))
        require(bool(assets), 'Compiled web entrypoint has no bundled asset references')
        for asset in assets:
            require(self.call(asset)[0] == 200, f'Missing compiled web asset: {asset}')
        self.passed('compiled web HTML, asset serving and same-origin CSP')
        require(self.call('/api/app-info', extra={'Forwarded': 'for=127.0.0.1'})[0] == 403, 'Local mode accepted proxy forwarding headers')
        self.passed('local mode proxy rejection')
        duplicate = subprocess.run([str(self.root / 'start.sh')], cwd=self.work, env=self.env,
                                   stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
        require(duplicate.returncode != 0 and process.poll() is None, 'Duplicate start did not preserve owned server')
        self.passed('duplicate start rejected without disturbing owned server')
        local, _ = self.json('/api/auth/me')
        require(local['mode'] == 'local' and local['user']['userId'].startswith('local:') and local['csrfToken'], 'Local session principal invalid')
        self.passed('password-free local identity and CSRF')
        created = self.task(local, 'release-smoke-local', '合成发行任务')
        self.task(local, 'release-smoke-local', '合成发行任务 已修改', created['revision'])
        self.passed('synthetic local task creation and revision update')
        content = b'Qingdan synthetic release attachment\n'
        boundary = 'qingdan-release-' + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="recordId"\r\n\r\nrelease-smoke-local\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="operationId"\r\n\r\nrelease-smoke-upload\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.txt"\r\nContent-Type: text/plain\r\n\r\n').encode()
        body += content + f'\r\n--{boundary}--\r\n'.encode()
        status, _, data = self.call('/api/attachments', body, local, {'Content-Type': 'multipart/form-data; boundary=' + boundary})
        require(200 <= status < 300, 'Synthetic attachment upload failed')
        attachment = json.loads(data)['attachment']['id']
        self.passed('synthetic HTTP attachment upload')
        self.stop(process)
        self.passed('stop.sh clean shutdown and instance lock cleanup')
        process = self.start(('start.sh', 'start'))
        refreshed, _ = self.json('/api/auth/me')
        require(refreshed['user']['userId'] == local['user']['userId'], 'Local principal changed after restart')
        state, _ = self.json('/api/data', auth=refreshed)
        require(next(record for record in state['records'] if record['id'] == 'release-smoke-local')['data']['title'] == '合成发行任务 已修改',
                'Task data not persistent across restart')
        status, _, restored = self.call('/api/attachments?id=' + urllib.parse.quote(attachment))
        require(status == 200 and restored == content, 'Attachment bytes not persistent across restart')
        self.passed('explicit start, principal/task/file persistence across restart')
        self.stop(process, 'stop.command')
        self.passed('stop.command clean shutdown (native current platform only)')
        # A mode override must fail closed, never adopt the existing local data directory.
        isolation_env = {**self.env, 'QINGDAN_DATA_DIR': str(self.home / 'data/local')}
        incompatible = subprocess.run([str(self.root / 'start.sh'), 'start', '--accounts'], cwd=self.work,
                                      env=isolation_env, stdin=subprocess.DEVNULL, capture_output=True, timeout=15)
        require(incompatible.returncode != 0 and not (self.home / 'running').exists(), 'Accounts mode adopted local data or left a lock')
        self.passed('local data directory cannot be adopted by accounts mode')
        noninteractive = subprocess.run([str(self.root / 'init-admin.sh')], cwd=self.work, env=self.env,
                                        stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
        require(noninteractive.returncode != 0, 'Admin initialization accepted non-interactive password input')
        self.passed('non-interactive administrator initialization rejected')
        password = self.init_admin()
        process = self.start(('start-accounts.sh',), expected_mode='accounts')
        empty, _ = self.json('/api/auth/me')
        require(empty['user'] is None and empty['mode'] == 'accounts', 'Accounts mode granted an unauthenticated identity')
        status, _, _ = self.call('/api/data')
        require(status == 401, 'Accounts data accessible without login')
        self.passed('accounts startup and anonymous data rejection')
        admin, headers = self.json('/api/auth/login', {'email': 'admin@example.test', 'password': password})
        cookie = headers.get('set-cookie', '').split(';')[0]
        require(cookie.startswith('qingdan_session=') and admin['user']['role'] == 'admin', 'Synthetic first administrator login failed')
        admin['cookie'] = cookie
        self.secrets.append(cookie)
        state, _ = self.json('/api/data', auth=admin)
        require(not any(record['id'] == 'release-smoke-local' for record in state['records']), 'Local tasks leaked into accounts mode')
        self.task(admin, 'release-smoke-account', '合成账号任务')
        self.passed('synthetic administrator login and local/accounts data isolation')
        self.json('/api/auth/logout', {}, admin)
        status, _, data = self.call('/api/auth/me', extra={'Cookie': cookie})
        require(status == 200 and json.loads(data)['user'] is None, 'Logout did not invalidate synthetic session')
        self.passed('accounts logout invalidates session')
        self.stop(process)
        process = self.start(('start.command',))
        local_after, _ = self.json('/api/auth/me')
        require(local_after['user']['userId'] == local['user']['userId'], 'Local mode lost principal after accounts mode run')
        self.stop(process)
        self.passed('start.command returns to persistent isolated local mode (native current platform only)')
        return {'status': 'passed', 'native_platform': arch, 'checks': self.checks,
                'synthetic_data_only': True, 'data_removed_after_run': True,
                'macos_native_execution': arch == 'darwin-arm64',
                'boundaries': ['No real accounts, domains, credentials, certificates or external deployment tested.',
                               'Execution on one platform does not establish native execution on the other platform.']}

    def cleanup(self):
        for process in self.processes:
            if process.poll() is None:
                # Only our own process groups are signaled; never reuse artifact PID state here.
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=12)
                except (OSError, subprocess.TimeoutExpired):
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
        self.log.close()

    def failure_log(self):
        text = self.log_path.read_text(encoding='utf-8', errors='replace')[-6000:]
        for secret in self.secrets:
            text = text.replace(secret, '[synthetic secret redacted]')
        return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--zip', dest='archive')
    inputs.add_argument('--directory', help='A separately extracted server directory')
    parser.add_argument('--report', help='Fresh external JSON report file')
    parser.add_argument('--structural-only', action='store_true', help='Skip native execution; report smoke as not run')
    args = parser.parse_args()
    report = {'product': 'qingdan-server-web', 'checked_at': datetime.now(timezone.utc).isoformat(), 'status': 'failed'}
    exit_code = 1
    try:
        if args.report:
            require(not Path(args.report).exists(), 'Report output must be a fresh file')
        with tempfile.TemporaryDirectory(prefix='青单 extracted release ') as scratch:
            work = Path(scratch)
            if args.archive:
                archive = Path(args.archive).resolve()
                report['archive'] = {'name': archive.name, 'sha256': digest(archive), 'bytes': archive.stat().st_size}
                root = extract_archive(archive, work / '中文 path with spaces')
                report['fresh_extraction_with_unicode_and_spaces'] = True
            else:
                root = Path(args.directory).resolve()
                report['fresh_extraction_with_unicode_and_spaces'] = False
            if args.report:
                require(not Path(args.report).resolve().is_relative_to(root), 'Report output must be outside the server payload')
            manifest = verify_structure(root)
            report.update(version=manifest['version'], source_snapshot_sha256=manifest['application_source_snapshot_sha256'],
                          structural={'status': 'passed', 'files': len(manifest['files_sha256']) + 1,
                                      'official_node_payloads': list(ARCHIVE_SHA256), 'pinned_binary_license_provenance': True})
            if args.structural_only:
                report['smoke'] = {'status': 'not_run', 'reason': '--structural-only requested', 'macos_native_execution': False}
            else:
                smoke = Smoke(root, work, manifest['version'])
                try:
                    report['smoke'] = smoke.run()
                except Exception:
                    report['smoke'] = {'status': 'failed', 'checks_passed': smoke.checks, 'log_tail': smoke.failure_log()}
                    raise
                finally:
                    smoke.cleanup()
                # Startup and synthetic data must never mutate any shipped payload file.
                verify_structure(root)
            report['status'] = 'passed'
            exit_code = 0
    except Exception as error:
        report['error'] = str(error)
    if args.report:
        path = Path(args.report)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('x', encoding='utf-8') as stream:
                stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        except OSError as error:
            report['status'] = 'failed'
            report['report_error'] = str(error)
            exit_code = 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(exit_code)


if __name__ == '__main__':
    main()
