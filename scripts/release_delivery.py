"""Configuration-driven desktop delivery. Historical gates and receipts are read-only."""
from pathlib import Path
import argparse
import base64
import datetime
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PS = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
PWSH = Path(r'C:\Users\ZekeNiu\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe')


def require(value, message):
    if not value:
        raise AssertionError(message)


def read(file):
    return json.loads(Path(file).read_text(encoding='utf-8-sig'))


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def write(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def child_environment():
    env = os.environ.copy()
    # Codex's inherited PowerShell module path can hide Windows PowerShell's
    # built-in Get-FileHash. Limit this correction to verification subprocesses.
    env['PSModulePath'] = str(Path(os.environ.get('WINDIR', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/Modules')
    env.pop('ELECTRON_RUN_AS_NODE', None)
    return env


class Delivery:
    def __init__(self, config):
        self.config = Path(config).resolve()
        self.c = read(self.config)
        self.version, self.desktop = self.c['version'], self.c['desktopVersion']
        self.base, self.out = Path(self.c['checkpoint']), ROOT / self.c['output']
        self.adapters_directory = self.out / 'adapters'

    def evidence(self, file):
        file = Path(file)
        return {'file': file.relative_to(ROOT).as_posix(), 'sha256': digest(file)}

    def immutable_template(self, kind):
        spec = self.c['templates'][kind]
        file = ROOT / spec['file']
        require(digest(file) == spec['sha256'], 'Historical template changed: ' + str(file))
        return file, file.read_text(encoding='utf-8')

    def adapter(self, kind):
        template, text = self.immutable_template(kind)
        if kind == 'native':
            text = text.replace('__dirname', json.dumps(str(ROOT / 'tests')))
            text = re.sub(r"require\('(\./helpers/[^']+)'\)", lambda match: 'require(' + json.dumps(str(ROOT / 'tests' / match.group(1))) + ')', text)
            text = text.replace(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261020-system-before-2.24.8', str(self.base))
            text = text.replace("mode==='baseline'?'2.24.7-desktop.1':'2.24.8-desktop.1'", 'mode===\'baseline\'?' + json.dumps(self.c['baselineDesktopVersion']) + ':' + json.dumps(self.desktop))
            # All launches, including isolated profile copies, come from Explorer.
            # The unchanged proof then checks the selected copy over CDP.
            start = text.index('  }else{\n   const env=')
            end = text.index('\n  page.on(', start)
            text = text[:start] + '''  }else{
   const launch=read(arg('--launch-receipt'));assert.equal(launch.method,'ShellWindows.FindWindowSW(8,1).Document.Application.ShellExecute');assert.equal(launch.targetPath.toLowerCase(),executable.toLowerCase());assert.equal(launch.targetSha256,result.executableSha256);
   browser=await chromium.connectOverCDP('http://127.0.0.1:'+arg('--cdp-port'));page=browser.contexts()[0].pages().find(p=>p.url().startsWith('motionbench://'));assert.ok(page);
   const data=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"Get-CimInstance Win32_Process -Filter \\\"name='MotionBench.exe'\\\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"],{encoding:'utf8'})),inventory=Array.isArray(data)?data:[data],parent=inventory.find(p=>p.CommandLine?.includes('--remote-debugging-port='+arg('--cdp-port'))&&!p.CommandLine.includes('--type='));assert.ok(parent);pid=parent.ProcessId;result.processId=pid;
   const renderer=inventory.find(p=>p.ParentProcessId===pid&&p.CommandLine?.includes('--type=renderer')),profile=renderer?.CommandLine.match(/--user-data-dir="([^"]+)"/)?.[1];assert.ok(profile);result.profilePath=profile;assert.equal(path.resolve(profile),path.join(base,'system-'+mode+'-profile'));result.launchReceiptSha256=fileHash(arg('--launch-receipt'));
  }''' + text[end:]
            text = self.native_selection_adapter(text)
        else:
            text = text.replace('2.24.7', self.version).replace('2247', self.version.replace('.', ''))
            text = text.replace("$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))", '$workspace = ' + quote(ROOT))
            text = re.sub(r"\$destination = '[^']+'", lambda _: '$destination = ' + quote(self.base), text)
            text = re.sub(r"\$checkpoint = '[^']+'", lambda _: '$checkpoint = ' + quote(self.base), text)
            text = text.replace('D:\\Application\\Strength&Conditioning\\MotionBench-backups\\20261020-system-before-' + self.version, str(self.base))
            text = text.replace('output\\implementation-' + self.version + '\\resumed', self.c['output'].replace('/', '\\'))
            text = text.replace('output/implementation-' + self.version + '/resumed', self.c['output'])
            if kind == 'prepare':
                text = text.replace('f4f4fd40338726ad426ed1b323f31f6ea619d480', self.c['baselineCommit'])
            if kind == 'install':
                old = 'verify_v' + self.version.replace('.', '') + '.py'
                text = text.replace('python scripts/' + old + ' --require-candidate', 'python ' + self.c['entry'] + ' verify --require-candidate')
                text = text.replace("(Join-Path $PSScriptRoot '" + old + "')", "(Join-Path $workspace '" + self.c['entry'] + "')")
            if kind == 'shortcut':
                text = text.replace("(Join-Path $PSScriptRoot 'invoke-from-desktop.ps1')", "(Join-Path $workspace 'scripts/invoke-from-desktop.ps1')")
                text = text.replace("$owner = $reference.library.athletes | Where-Object { $_.id -eq $reference.active.athleteId } | Select-Object -First 1", "$comparison = $null -ne $reference.active\n$ownerId = if ($comparison) { $reference.active.athleteId } else { $reference.currentSelection.athleteId }\n$owner = $reference.library.athletes | Where-Object { $_.id -eq $ownerId } | Select-Object -First 1")
                text = text.replace('$expectedDates = @($reference.active.dates)', "$expectedDates = if ($comparison) { @($reference.active.dates) } else { @($reference.currentSelection.date) }")
                text = text.replace('$expectedDates.Count -lt 2', '$expectedDates.Count -lt 1')
                text = text.replace(" -and $allText.Contains('下降') -and $allText.Contains('改善')", " -and (-not $comparison -or ($allText.Contains('下降') -and $allText.Contains('改善')))")
                text = text.replace('uia=@{athleteName=$expectedName;', 'uia=@{expectedSelectionKind=$(if($comparison){\'comparison\'}else{\'personal\'});expectedRecordId=$reference.currentSelection.recordId;athleteName=$expectedName;')
        target = self.adapters_directory / (kind + ('.cjs' if kind == 'native' else '.ps1'))
        return target, text.encode('utf-8'), template

    @staticmethod
    def native_selection_adapter(text):
        # The saved startup selection may be a personal report. Never turn a
        # user's one-record selection into a comparison just to satisfy a test.
        text = text.replace('return{library,reports,active};', "const state=App.getState();const currentSelection={kind:model?'comparison':'personal',athleteId:state.athleteId,recordId:state.recordId,date:state.athlete.date};return{library,reports,active,currentSelection};")
        text = text.replace('function protectedState(actual,reference,sample,document){', "function protectedState(actual,reference,sample,document){\n P.same(actual.currentSelection,reference.currentSelection,'Saved report shape athlete record or date changed');if(!reference.active)P.same(actual.library.longitudinalReports,reference.library.longitudinalReports,'An inactive saved comparison changed');")
        text = text.replace("await page.waitForFunction(()=>window.App?.ready,null,{timeout:60000});", "await page.waitForFunction(()=>window.App?.ready,null,{timeout:60000});assert.equal(await page.evaluate(()=>App.ready),true,'Application initialization did not finish successfully');")
        old = "const before=await snapshot(page);assert.ok(before.active,'The existing comparison must reopen normally');const sample={athleteId:before.active.athleteId,documentKey:before.active.document.key,recordIds:before.active.recordIds,dates:before.active.dates},initial=before.active.document;"
        new = """const before=await snapshot(page),anchor=before.active?.document||[...(before.library.longitudinalReports||[])].filter(d=>d.athleteId===before.currentSelection.athleteId).sort((a,b)=>String(b.updated).localeCompare(String(a.updated)))[0];assert.ok(anchor,'The preservation proof requires an existing saved comparison document');
  const owner=before.library.athletes.find(a=>a.id===anchor.athleteId),sample={athleteId:anchor.athleteId,documentKey:anchor.key,recordIds:anchor.recordIds,dates:anchor.recordIds.map(id=>owner.records.find(r=>r.recordId===id).athlete.date)},initial=anchor;result.currentSelection=before.currentSelection;result.protectionAnchorIsActive=!!before.active;"""
        require(old in text, 'Native selection template differs')
        text = text.replace(old, new)
        text = text.replace('original=reference.active.document;', 'original=reference.active?.document||P.document(reference.library,sample);')
        text = text.replace("const saved=read(path.join(base,'verification','installed','snapshot.json')).active.document,restored=P.clone(initial),launch=read(arg('--launch-receipt'));", "const savedSnapshot=read(path.join(base,'verification','installed','snapshot.json')),saved=savedSnapshot.active?.document||P.document(savedSnapshot.library,sample),restored=P.clone(initial),launch=read(arg('--launch-receipt'));")
        text = text.replace('   const ui=await page.evaluate(()=>{', '   if(before.active){\n   const ui=await page.evaluate(()=>{')
        ending = "render on original saved comparison');\n  }"
        require(ending in text, 'Native UI template differs')
        text = text.replace(ending, "render on original saved comparison');\n   }else{P.same(before.currentSelection,reference.currentSelection,'Personal report selection changed');P.same(before.library.longitudinalReports,reference.library.longitudinalReports,'Saved comparisons changed while opening a personal report');result.ui={selectionKind:'personal',recordId:before.currentSelection.recordId,athleteId:before.currentSelection.athleteId,date:before.currentSelection.date};result.checks.push('Original saved personal selection and every inactive comparison document preserved');}\n  }")
        text = text.replace('after.active.document=P.clone(latestGuard.expectedDocument);', 'if(after.active)after.active.document=P.clone(latestGuard.expectedDocument);else{assert.deepEqual(latestGuard.transitions,[]);P.same(after.library.longitudinalReports,before.library.longitudinalReports,\'No inactive comparison may change during normal personal-report close\');}')
        # An Explorer-hidden window can have MainWindowHandle=0. window.close
        # still invokes Electron's ordinary close/save handler; no force quit.
        start = text.index("  else{execFileSync('powershell.exe',")
        end = text.index('\n  result.normalClose=true;', start)
        original = text[start + len('  else{'):end]
        close = original[:original.index('await browser.close();')]
        require(close.endswith(';'), 'Native close template differs')
        text = text[:start] + "  else{if(physical){" + close + "}else{await page.evaluate(()=>{setTimeout(()=>window.close(),0);});execFileSync('powershell.exe',['-NoProfile','-Command',`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if($p -and -not $p.WaitForExit(60000)){throw 'Normal isolated close timed out'};exit 0`],{timeout:70000});}await browser.close();browser=null;}" + text[end:]
        return text

    def adapters(self):
        self.adapters_directory.mkdir(parents=True, exist_ok=True)
        result = {}
        for kind in ('prepare', 'install', 'shortcut', 'native'):
            file, content, template = self.adapter(kind)
            if file.exists():
                require(file.read_bytes() == content, 'Preserve changed generated adapter: ' + str(file))
            else:
                file.write_bytes(content)
            result[kind] = {**self.evidence(file), 'template': self.evidence(template)}
        write(self.adapters_directory / 'identity.json', {'producerSha256': digest(__file__), 'baselineCommit': self.c['baselineCommit'], 'adapters': result})
        return result

    def broker(self, file, arguments, style, receipt):
        require(not Path(receipt).exists(), 'Preserve previous launch receipt')
        command = '& ' + quote(ROOT / 'scripts/invoke-from-desktop.ps1') + ' -FilePath ' + quote(file) + ' -Arguments ' + quote(arguments) + ' -WorkingDirectory ' + quote(ROOT) + ' -WindowStyle ' + quote(style) + ' -ReceiptPath ' + quote(receipt)
        subprocess.run([str(PWSH), '-NoProfile', '-EncodedCommand', base64.b64encode(command.encode('utf-16le')).decode()], cwd=ROOT, check=True, env=child_environment())

    def checkpoint(self, bind=False):
        file = self.base / 'manifest.json'
        item = read(file)
        require(item['complete'] and item['kind'] == 'system-profile-checkpoint' and item['source']['virtualized'] is False and item['source']['parentName'] == 'explorer.exe', 'Invalid physical checkpoint')
        require(item['sourceCommit'] == self.c['baselineCommit'] and item['runnerSha256'] == self.adapters()['prepare']['sha256'], 'Checkpoint producer/baseline differs')
        require(item['source']['profile'] == self.c['actualProfile'], 'Wrong actual profile')
        for name, entries in [('system-userdata', item['files']), ('program', item['programReference']['files'])]:
            directory = (self.base / name).resolve()
            require(entries, 'Empty checkpoint')
            for entry in entries:
                saved = (directory / entry['path']).resolve()
                require(saved.is_relative_to(directory) and saved.stat().st_size == entry['bytes'] and digest(saved) == entry['sha256'], 'Checkpoint bytes differ: ' + str(saved))
        if bind:
            require(self.c.get('manifestSha256') is None, 'Preserve pinned checkpoint identity')
            receipt = read(self.out / 'checkpoint-complete.json')
            require(receipt['pass'] and receipt['manifestSha256'] == digest(file), 'No completed checkpoint receipt')
            self.c['manifestSha256'] = digest(file)
            write(self.config, self.c)
        else:
            require(self.c.get('manifestSha256') == digest(file), 'Bind the completed checkpoint first')
        return item

    def dispatch(self, kind):
        inventory = self.adapters()
        if kind != 'prepare':
            self.checkpoint()
        if kind == 'install':
            self.verify(candidate=True)
        if kind == 'shortcut':
            self.private(complete=True, shortcut=False)
        self.broker(PS, '-NoProfile -ExecutionPolicy Bypass -File "' + str(ROOT / inventory[kind]['file']) + '"', 'Hidden', self.out / (kind + '-dispatch.json'))
        completion = {'prepare': 'checkpoint-complete.json', 'install': 'system-installation.json', 'shortcut': 'shortcut-check.json'}[kind]
        return {'dispatched': kind, 'completion': str(self.out / completion)}

    @staticmethod
    def wait_json(file):
        end = time.monotonic() + 60
        while time.monotonic() < end:
            try:
                return read(file)
            except (OSError, ValueError):
                time.sleep(.25)
        raise TimeoutError(str(file))

    def stage(self, mode):
        require(mode in ('baseline', 'candidate', 'installed', 'reopened'), 'Unknown native stage')
        self.checkpoint()
        directory = self.base / 'verification' / mode
        directory.mkdir(parents=True, exist_ok=True)
        require(not (directory / 'receipt.json').exists(), 'Preserve previous private evidence')
        physical = mode in ('installed', 'reopened')
        if physical:
            require(read(self.out / 'system-installation.json')['pass'], 'No verified installation')
            before = directory / 'before-physical.json'
            self.broker(PS, '-NoProfile -ExecutionPolicy Bypass -File "' + str(ROOT / 'scripts/inspect-system-profile.ps1') + '" -Destination "' + str(before) + '"', 'Hidden', directory / 'probe-launch.json')
            probe = self.wait_json(before)
            subprocess.run([str(PWSH), '-NoProfile', '-Command', '$p=Get-Process -Id ' + str(int(probe['processId'])) + ' -ErrorAction SilentlyContinue;if($p){Wait-Process -Id $p.Id -Timeout 60 -ErrorAction Stop};exit 0'], check=True, stdout=subprocess.DEVNULL, env=child_environment())
        program = ROOT / 'dist-desktop/win-unpacked' if mode == 'candidate' else self.base / 'program' if mode == 'baseline' else Path(self.c['installation'])
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0))
            port = server.getsockname()[1]
        arguments = ['--remote-debugging-port=' + str(port)]
        if not physical:
            arguments += ['--motionbench-test', '--motionbench-data-dir=' + str(self.base / ('system-' + mode + '-profile'))]
        launch = directory / 'native-launch.json'
        self.broker(program / 'MotionBench.exe', subprocess.list2cmdline(arguments), 'Normal' if physical else 'Hidden', launch)
        end = time.monotonic() + 60
        while True:
            try:
                with urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/json/version', timeout=2) as response:
                    json.load(response)
                break
            except (OSError, ValueError):
                if time.monotonic() >= end:
                    raise TimeoutError('Native desktop attachment unavailable')
                time.sleep(.25)
        runner = ROOT / self.adapters()['native']['file']
        command = ['node', str(runner), mode, '--cdp-port', str(port), '--launch-receipt', str(launch)]
        if physical:
            command += ['--physical-before', str(before)]
        subprocess.run(command, cwd=ROOT, check=True, env=child_environment())

    def run_units(self):
        names = self.c['units']
        require(names and len(set(names)) == len(names), 'Declare focused unit suites')
        file = self.out / 'units/results.json'
        require(not file.exists(), 'Preserve previous unit evidence')
        source = digest(ROOT / 'MotionBench.html')
        before = {p.relative_to(ROOT).as_posix(): digest(p) for folder in ('src', 'desktop', 'vendor') for p in sorted((ROOT / folder).rglob('*')) if p.is_file()}
        result = {'pass': False, 'sourceHash': source, 'runnerSha256': digest(__file__), 'sourceFiles': before, 'suites': []}
        for name in names:
            test = ROOT / 'tests' / name
            identity = digest(test)
            process = subprocess.run(['node', str(test)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=child_environment())
            log = self.out / 'units' / (name + '.log')
            log.parent.mkdir(parents=True, exist_ok=True)
            log.write_bytes(process.stdout)
            result['suites'].append({'name': name, 'sha256': identity, 'exitCode': process.returncode, 'unchanged': digest(test) == identity, 'log': self.evidence(log)})
            write(file, result)
            require(process.returncode == 0 and digest(test) == identity, 'Focused unit failed/changed: ' + name)
        result['pass'] = digest(ROOT / 'MotionBench.html') == source and all(digest(ROOT / name) == checksum for name, checksum in before.items())
        write(file, result)
        require(result['pass'], 'Runtime source changed during units')
        return self.evidence(file)

    def rebuild(self):
        file = self.out / 'build-verification.json'
        require(not file.exists(), 'Preserve previous rebuild evidence')
        before = digest(ROOT / 'MotionBench.html')
        subprocess.run([sys.executable, 'scripts/build.py'], cwd=ROOT, check=True, env=child_environment())
        result = {'identical': digest(ROOT / 'MotionBench.html') == before, 'sourceHash': digest(ROOT / 'MotionBench.html'), 'bytes': (ROOT / 'MotionBench.html').stat().st_size}
        write(file, result)
        require(result['identical'], 'Generated HTML was stale before deterministic rebuild')
        return self.evidence(file)

    def inherited(self):
        baseline = self.c['baselineCommit']
        previous = ROOT / self.c['baselineAcceptance']
        require(previous.read_bytes() == git('show', baseline + ':' + self.c['baselineAcceptance']), 'Baseline acceptance changed')
        require(read(previous)['pass'] and read(previous)['privateVerified'], 'No fully accepted baseline')
        require(read(previous)['sourceHash'] == hashlib.sha256(git('show', baseline + ':MotionBench.html')).hexdigest(), 'Baseline source identity differs')
        allowed = set(self.c['changedSource'])
        changed, unchanged = [], []
        names = git('ls-tree', '-r', '--name-only', baseline, '--', 'src', 'desktop', 'vendor', 'scripts/build.py', 'body-map-front.png', 'tests/helpers').decode('utf-8').splitlines()
        for name in names:
            original, current = hashlib.sha256(git('show', baseline + ':' + name)).hexdigest(), digest(ROOT / name)
            if original != current:
                require(name in allowed, 'Expand scope for changed protected source: ' + name)
                changed.append({'file': name, 'baselineSha256': original, 'sha256': current})
            else:
                unchanged.append({'file': name, 'sha256': current})
        for folder in ('src', 'desktop', 'vendor', 'tests/helpers'):
            current = {file.relative_to(ROOT).as_posix() for file in (ROOT / folder).rglob('*') if file.is_file()}
            require(current <= set(names) | allowed, 'Unreviewed new protected file')
        for name in ('package.json', 'package-lock.json'):
            old, new = json.loads(git('show', baseline + ':' + name)), read(ROOT / name)
            old.pop('version', None)
            new.pop('version', None)
            if name == 'package-lock.json':
                old['packages'][''].pop('version', None)
                new['packages'][''].pop('version', None)
            require(old == new, 'Dependency or packaging metadata changed beyond version')
        builder = (ROOT / 'electron-builder.yml').read_bytes().replace(self.desktop.encode(), self.c['baselineDesktopVersion'].encode()).replace(self.version.encode(), self.c['baselineDesktopVersion'].split('-desktop.')[0].encode())
        require(builder == git('show', baseline + ':electron-builder.yml'), 'Packaging configuration changed beyond version')
        return {'commit': baseline, 'acceptance': self.evidence(previous), 'inheritedOnly': True, 'unchangedFiles': unchanged, 'changedFiles': changed, 'meaning': 'Earlier accepted behavior is inherited only for unchanged protected bytes, not counted as fresh executions.'}

    def focused(self, source):
        specs = self.c['focused']
        require(specs, 'Declare focused browser/native receipts before installing')
        results = []
        for spec in specs:
            file = ROOT / spec['receipt']
            item = read(file)
            identity = item.get('identity', {})
            require(item.get('pass') and not any(item.get(k) for k in ('errors', 'error', 'failure')), 'Focused receipt failed: ' + str(file))
            require(item.get('sourceHash', identity.get('runtimeHtmlSha256')) == source, 'Focused source differs')
            require(item.get('runnerSha256', identity.get('runnerSha256')) == digest(ROOT / spec['runner']), 'Focused producer changed')
            require(len(item['checks']) >= spec['minChecks'], 'Focused checks incomplete')
            if spec.get('desktop'):
                require(identity['runtimeHtmlSha256'] == source and identity['runtimeMatchesSourceHtml'] and identity == item['finalIdentity'], 'Native identity changed')
                require(identity['archiveSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/resources/app.asar'), 'Native package differs')
            for name, checksum in {**item.get('moduleHashes', {}), **item.get('sourceFiles', {})}.items():
                require(digest(ROOT / name) == checksum, 'Focused source changed: ' + name)
            if 'fixtureSha256' in item:
                require(item['fixtureSha256'] == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs'), 'Focused fixture changed')
            for artifact in item.get('artifacts', []):
                if artifact.get('file') and artifact.get('sha256'):
                    require(digest(ROOT / artifact['file']) == artifact['sha256'], 'Focused artifact changed')
            results.append({**self.evidence(file), 'checks': len(item['checks'])})
        return results

    def private(self, complete=False, shortcut=True):
        self.checkpoint()
        baseline = read(self.base / 'verification/baseline/receipt.json')
        adapter = self.adapters()['native']
        result = {}
        for mode in ('baseline', 'candidate', 'installed', 'reopened') if complete else ('baseline', 'candidate'):
            folder = self.base / 'verification' / mode
            item = read(folder / 'receipt.json')
            require(item['pass'] and item['normalClose'] and not item['errors'] and not item['guard']['blocked'] and item['cleanup']['pass'] and item['cleanup']['removed'], 'Private stage or cleanup failed: ' + mode)
            require(item['runnerSha256'] == adapter['sha256'] == item['stageEntrySha256'] and item['manifestSha256'] == self.c['manifestSha256'], 'Private producer/checkpoint differs')
            require(item['snapshotSha256'] == digest(folder / 'snapshot.json') and item['counts'] == baseline['counts'] and len(item['checks']) == (3 if mode == 'baseline' else 5), 'Private snapshot/check inventory differs')
            require(item['currentSelection'] == baseline['currentSelection'], 'Private saved report shape or selected record differs')
            require(item['guardSha256'] == self.c['guardSha256'], 'Original preservation proof changed')
            if mode != 'baseline':
                require(item['runtimeHtmlSha256'] == digest(ROOT / 'MotionBench.html') and item['archiveSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/resources/app.asar'), 'Private tested package differs')
            result[mode] = {'pass': True, 'receiptSha256': digest(folder / 'receipt.json'), 'checks': len(item['checks']), 'normalClose': True, 'guardRemoved': True}
        if complete:
            inventory = self.adapters()
            install = read(self.out / 'system-installation.json')
            require(install['pass'] and install['version'] == self.desktop and install['systemManifestSha256'] == self.c['manifestSha256'], 'Installation checkpoint/version differs')
            require(install['runnerSha256'] == inventory['install']['sha256'] and install['verifierSha256'] == digest(ROOT / self.c['entry']), 'Installation producer differs')
            require(install['installerSha256'] == digest(ROOT / ('dist-desktop/MotionBench-' + self.desktop + '-Setup-x64.exe')), 'Installed setup differs from final artifact')
            require(len(install['checks']) == 2 and all(check['matchesTestedPackage'] for check in install['checks']), 'Installed bytes differ')
            if shortcut:
                launch = read(self.out / 'shortcut-check.json')
                require(launch['pass'] and launch['normalStartup'] and launch['launchArgs'] == [] and launch['window']['visible'] and launch['uia']['found'], 'Ordinary shortcut failed')
                require(launch['runnerSha256'] == inventory['shortcut']['sha256'] and launch['sourceHash'] == digest(ROOT / 'MotionBench.html') and launch['archiveSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/resources/app.asar'), 'Ordinary launch bytes differ')
        return {'stages': result, 'counts': baseline['counts'], 'checkpointSha256': self.c['manifestSha256']}

    def verify(self, candidate=False, complete=False, record=False):
        source = digest(ROOT / 'MotionBench.html')
        require(read(ROOT / 'package.json')['version'] == self.version, 'Wrong version')
        inherited = self.inherited()
        unit_file = self.out / 'units/results.json'
        units = read(unit_file)
        require(units['pass'] and units['sourceHash'] == source and units['runnerSha256'] == digest(__file__), 'Focused units producer/source differs')
        require([suite['name'] for suite in units['suites']] == self.c['units'], 'Wrong focused unit inventory')
        for name, checksum in units['sourceFiles'].items():
            require(digest(ROOT / name) == checksum, 'Units source changed')
        for suite in units['suites']:
            require(suite['exitCode'] == 0 and suite['unchanged'] and suite['sha256'] == digest(ROOT / 'tests' / suite['name']) and suite['log']['sha256'] == digest(ROOT / suite['log']['file']), 'Focused suite failed/changed')
        focused = self.focused(source)
        rebuild = read(self.out / 'build-verification.json')
        require(rebuild['identical'] and rebuild['sourceHash'] == source and rebuild['bytes'] == (ROOT / 'MotionBench.html').stat().st_size, 'Final deterministic rebuild failed')
        package = read(ROOT / 'output/desktop-package/package-check.json')
        require(package['version'] == self.desktop and package['webVersion'] == self.version and not package['directoryOnly'] and package['updaterConfigurationPresent'], 'Final package identity differs')
        require(package['archiveSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/resources/app.asar'), 'Package inventory differs')
        proof = {'version': self.version, 'desktopVersion': self.desktop, 'sourceHash': source, 'pass': True, 'verificationStrategy': 'risk-based', 'model': self.evidence(unit_file), 'focused': focused, 'rebuild': self.evidence(self.out / 'build-verification.json'), 'inheritedBaseline': inherited, 'package': {'archiveSha256': package['archiveSha256'], 'assets': len(package['files'])}, 'privateVerified': False, 'userAccepted': False, 'scope': self.c['verificationScope']}
        if candidate or complete:
            proof['private'] = self.private(complete)
            proof['privateVerified'] = complete
        if complete:
            proof['installation'] = self.evidence(self.out / 'system-installation.json')
            proof['shortcut'] = self.evidence(self.out / 'shortcut-check.json')
        if record:
            write(ROOT / self.c['acceptanceJson'], proof)
        return proof

    def package(self):
        require(not git('status', '--porcelain').strip(), 'Commit accepted source and documents first')
        proof = self.verify(complete=True)
        require(read(ROOT / self.c['acceptanceJson']) == proof, 'Record final acceptance before packaging')
        destination = ROOT / 'output/release' / self.version
        destination.mkdir(parents=True, exist_ok=True)
        require(not (destination / 'build-provenance.json').exists(), 'Preserve staged release')
        names = ['MotionBench.html', 'dist-desktop/MotionBench-' + self.desktop + '-Setup-x64.exe', 'dist-desktop/MotionBench-' + self.desktop + '-Portable-x64.exe', 'dist-desktop/MotionBench-' + self.desktop + '-Setup-x64.exe.blockmap', 'dist-desktop/desktop.yml', 'dist-desktop/win-unpacked/resources/app.asar', self.c['acceptanceMarkdown'], self.c['acceptanceJson']]
        assets = []
        for name in names:
            source, target = ROOT / name, destination / Path(name).name
            shutil.copyfile(source, target)
            require(digest(source) == digest(target), 'Staged bytes differ')
            assets.append({'file': target.name, 'source': name, 'bytes': target.stat().st_size, 'sha256': digest(target)})
        setup = destination / ('MotionBench-' + self.desktop + '-Setup-x64.exe')
        require(base64.b64encode(hashlib.sha512(setup.read_bytes()).digest()).decode() in (destination / 'desktop.yml').read_text(), 'Updater installer hash differs')
        commit = git('rev-parse', 'HEAD').decode().strip()
        files = git('ls-files', '--', 'src', 'desktop', 'vendor', 'MotionBench.html', 'body-map-front.png', 'package.json', 'package-lock.json', 'electron-builder.yml', 'scripts', 'tests', '.github/workflows/comparison-windows.yml').decode('utf-8').splitlines()
        inputs = []
        for name in files:
            require((ROOT / name).read_bytes() == git('show', commit + ':' + name), 'Input differs from accepted commit: ' + name)
            inputs.append({'file': name, 'bytes': (ROOT / name).stat().st_size, 'sha256': digest(ROOT / name)})
        write(destination / 'build-provenance.json', {'version': self.version, 'desktopVersion': self.desktop, 'commit': commit, 'sourceHash': proof['sourceHash'], 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'assets': assets, 'sourceFiles': inputs, 'generatedAdapters': self.adapters(), 'verificationStrategy': 'risk-based', 'privateDataIncluded': False})
        asset_names = [Path(name).name for name in names] + ['build-provenance.json']
        (destination / 'SHA256SUMS.txt').write_text(''.join(digest(destination / name) + '  ' + name + '\n' for name in asset_names), encoding='ascii')
        inventory = [{'file': name, 'bytes': (destination / name).stat().st_size, 'sha256': digest(destination / name)} for name in [*asset_names, 'SHA256SUMS.txt']]
        require(len(inventory) == 10, 'Wrong public asset allowlist')
        write(self.out / 'release-assets.json', {'commit': commit, 'assets': inventory})
        return {'pass': True, 'commit': commit, 'assets': len(inventory), 'sourceHash': proof['sourceHash']}


def main(default_config=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=default_config)
    parser.add_argument('command', choices=['adapters', 'prepare', 'bind-checkpoint', 'private', 'install', 'shortcut', 'units', 'rebuild', 'verify', 'package'])
    parser.add_argument('stage', nargs='?')
    parser.add_argument('--require-candidate', action='store_true')
    parser.add_argument('--require-private', action='store_true')
    parser.add_argument('--record', action='store_true')
    args = parser.parse_args()
    require(args.config, 'Specify --config')
    delivery = Delivery(ROOT / args.config)
    if args.command == 'adapters':
        result = delivery.adapters()
    elif args.command in ('prepare', 'install', 'shortcut'):
        result = delivery.dispatch(args.command)
    elif args.command == 'bind-checkpoint':
        delivery.checkpoint(bind=True)
        result = {'pass': True, 'manifestSha256': delivery.c['manifestSha256']}
    elif args.command == 'private':
        delivery.stage(args.stage)
        result = {'completed': args.stage}
    elif args.command == 'units':
        result = delivery.run_units()
    elif args.command == 'rebuild':
        result = delivery.rebuild()
    elif args.command == 'verify':
        proof = delivery.verify(args.require_candidate, args.require_private, args.record)
        result = {key: proof[key] for key in ('pass', 'sourceHash', 'privateVerified')}
    else:
        result = delivery.package()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
