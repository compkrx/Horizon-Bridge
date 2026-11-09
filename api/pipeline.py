import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from engine.horizonbridge.horizon import convert, target
from engine.horizonbridge.inspect_jar import inspect_jar
from engine.horizonbridge.translate import translate


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=True) + '\n', encoding='utf-8')
    temporary.replace(path)


def reconstruct(jar, source_dir):
    tool = os.environ.get('HB_VINEFLOWER_JAR')
    if not tool:
        return {'name': 'Java reconstruction', 'status': 'skipped', 'detail': 'Vineflower is disabled in this processor.'}
    output = source_dir / 'java-reference'
    output.mkdir()
    command = ['java', '-Xmx256m', '-XX:ActiveProcessorCount=2', '-XX:-UsePerfData',
               '-Djava.io.tmpdir=' + os.environ.get('TMPDIR', str(jar.parent)), '-jar', tool, '--silent', '--folder',
               '--skip-extra-files=1', '--thread-count=2', str(jar), str(output)]
    try:
        subprocess.run(command, check=True, timeout=45, cwd=jar.parent, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        shutil.rmtree(output)
        return {'name': 'Java reconstruction', 'status': 'failed', 'detail': 'The decompiler failed or exceeded its 45-second budget.'}
    count = sum(1 for path in output.rglob('*.java') if path.is_file() and not path.is_symlink())
    if not count:
        shutil.rmtree(output)
        return {'name': 'Java reconstruction', 'status': 'skipped', 'detail': 'No Java source was recovered.'}
    return {'name': 'Java reconstruction', 'status': 'passed', 'detail': f'Verified the presence of {count} reconstructed Java files. Review them for accuracy.'}


def contained_files(root):
    for folder, directories, files in os.walk(root):
        directories[:] = sorted(name for name in directories if not (Path(folder) / name).is_symlink())
        for name in sorted(files):
            path = Path(folder) / name
            if path.is_symlink() or not path.is_file():
                continue
            yield path, path.relative_to(root).as_posix()


def check_translated(files, source_dir, progress, validation, diagnostics):
    for name, value in files.items():
        path = source_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding='utf-8')
    if not files:
        return
    (source_dir / 'Cargo.toml').write_text(
        '[package]\nname = "horizonbridge_port"\nversion = "0.1.0"\nedition = "2021"\n'
        '\n[lib]\npath = "src/translated.rs"\n', encoding='utf-8')

    def tool(name, arguments):
        log = source_dir.parent / 'standalone-check.log'
        try:
            with log.open('wb') as stream:
                result = subprocess.run(arguments, cwd=source_dir, timeout=30, stdin=subprocess.DEVNULL,
                                        stdout=stream, stderr=subprocess.STDOUT, check=False)
            if result.returncode:
                with log.open('rb') as stream:
                    stream.seek(max(0, log.stat().st_size - 12000))
                    detail = stream.read().decode('utf-8', errors='replace')
                diagnostics.append(f'{name}: {detail.replace(str(source_dir), "<source>")}')
                return False
            return True
        except (OSError, subprocess.TimeoutExpired):
            diagnostics.append(f'{name} did not complete within its tool budget.')
            return False

    format_args = ['rustfmt', '--edition', '2021', 'src/translated.rs']
    if shutil.which('rustfmt'):
        progress('repairing')
        formatted = tool('Rust formatting', format_args) and tool('Rust format verification', [*format_args, '--check'])
        validation.append({'name': 'Rust formatting', 'status': 'passed' if formatted else 'failed',
                           'detail': 'Ran a bounded formatting pass and checked the resulting source.'})
    progress('checking')
    compiler = shutil.which('rustc')
    if compiler:
        passed = tool('Standalone Rust compilation', [compiler, '--edition=2021', '--crate-type', 'lib',
                     'src/translated.rs', '-o', str(source_dir.parent / 'standalone.rlib')])
        validation.append({'name': 'Standalone Rust compilation', 'status': 'passed' if passed else 'failed',
                           'detail': 'Compiled the lowered methods as an independent library. Horizon bindings require separate validation.'})
    else:
        validation.append({'name': 'Standalone Rust compilation', 'status': 'skipped', 'detail': 'Rust is unavailable on this processor.'})


def porting_guide(report):
    metadata = report['metadata']
    pin = report['target']
    sections = ['# Porting notes', '', f"Source project: {metadata.get('name') or metadata.get('id')}",
                f"Source version: {metadata.get('version')} ({metadata.get('loader')})",
                f"Attribution: {metadata.get('author')} · License: {metadata.get('license')}", '',
                f"Target: Minecraft {pin['minecraft']}, Horizon `{pin['horizonRevision']}`",
                f"Mixins `{pin['mixinsRevision']}` · Hook API {pin['hookApi']}", '',
                f"Classification: **{report['classification']}**", '',
                'Use `conversion-report.json` for machine-readable checks and diagnostics.',
                'Review source and upstream license obligations before installing or distributing a port.',
                'Horizon native bundles contain Rust source. The launcher builds that source into a custom client.',
                'A technical check covers only the stages shown in the report. Run game tests before claiming compatibility.',
                '', '## Reproduce the validation', '',
                'Build the pinned HorizonBridge toolchain and run the native profile in the project deployment guide.',
                'Submit the same authorized JAR with the same target to reproduce the deterministic result.',
                'When this archive contains a root `Cargo.toml`, run `cargo check --offline` to check the standalone Rust library.',
                'If this archive contains a native bundle workspace, run the official `cargo horizon-mod check` workflow',
                'with the matching Horizon and horizon-mixins revisions above. See https://playhorizon.dev/docs/make-a-mod.',
                '', '## Work remaining', '']
    for feature in report['features']:
        if feature['status'] != 'translated':
            sections.append(f"- {feature['name']} ({feature['status']}): {feature['detail']}")
    return '\n'.join(sections) + '\n'


def run(workspace):
    workspace = workspace.resolve()
    jar_path = workspace / 'input.jar'
    source_dir = workspace / 'source'
    artifacts = workspace / 'artifacts'
    source_dir.mkdir()
    artifacts.mkdir()
    stage_history = []

    def progress(stage, metadata=None):
        stage_history.append({'stage': stage, 'metadata': metadata})
        write_json(workspace / 'progress.json', stage_history)

    progress('permissions')
    # Only affirmative API requests are enqueued. Inspect without executing the uploaded mod.
    progress('bytecode')
    try:
        inspection = inspect_jar(jar_path)
    except ValueError as exc:
        write_json(workspace / 'outcome.json', {'error': 'Invalid JAR: ' + str(exc)[:350]})
        return
    progress('bytecode', inspection['metadata'])
    validation = [{'name': 'Archive and bytecode inspection', 'status': 'passed',
                   'detail': 'Parsed archive structure and bounded class metadata without executing the Java mod.'}]
    progress('reconstructing')
    validation.append(reconstruct(jar_path, source_dir))
    progress('mapping')
    progress('translating')
    translation = translate(inspection)
    diagnostics = []
    check_translated(translation.get('files', {}), source_dir, progress, validation, diagnostics)
    if translation.get('ir'):
        write_json(source_dir / 'bytecode-ir.json', translation['ir'])
    result = convert(jar_path, inspection, translation, source_dir, artifacts, progress)
    validation += result.get('validation', [])
    if not any(item['name'] == 'Game behavior' for item in validation):
        validation.append({'name': 'Game behavior', 'status': 'skipped',
                           'detail': 'The service does not launch the game or execute uploaded mod code.'})
    features = inspection.get('features', []) + translation.get('features', []) + result.get('features', [])
    packages = result.get('artifacts', [])
    work_done = (packages or translation.get('files') or (source_dir / 'content/horizon-mod.toml').is_file()
                 or any(item['status'] == 'translated' for item in features))
    complete = (packages and all(item['status'] == 'translated' for item in features)
                and not inspection.get('missingDependencies') and all(item['status'] != 'failed' for item in validation))
    report = {'classification': 'verified' if complete else 'partial' if work_done else 'unsupported',
              'metadata': inspection['metadata'], 'target': target(), 'inputBytes': jar_path.stat().st_size,
              'features': features, 'validation': validation, 'diagnostics': diagnostics + result.get('diagnostics', []),
              'inspection': {key: inspection[key] for key in ('javaVersion', 'javaMajor', 'classCount', 'methodCount',
                             'resourceCount', 'expandedSize', 'skippedMethods', 'mixins', 'embeddedJars') if key in inspection},
              'missingDependencies': inspection.get('missingDependencies', []),
              'warnings': list(dict.fromkeys(inspection.get('warnings', []) + result.get('warnings', []) +
                 ['Native Rust mods run with your player account permissions. Review source before installing.']))}
    write_json(source_dir / 'conversion-report.json', report)
    (source_dir / 'PORTING.md').write_text(porting_guide(report), encoding='utf-8')
    shutil.copyfile(source_dir / 'conversion-report.json', artifacts / 'conversion-report.json')
    files = list(contained_files(source_dir))
    if len(files) > 12000 or sum(path.stat().st_size for path, _ in files) > 120 * 1024 * 1024:
        raise ValueError('Generated source exceeded its size budget.')
    with zipfile.ZipFile(artifacts / 'horizonbridge-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path, name in files:
            archive.write(path, name)
    downloads = [*packages, {'name': 'horizonbridge-source.zip', 'kind': 'source'},
                 {'name': 'conversion-report.json', 'kind': 'report'}]
    for item in downloads:
        item['size'] = (artifacts / item['name']).stat().st_size
    viewable = {'.rs', '.java', '.json', '.toml', '.md', '.txt', '.ron', '.properties'}
    files.sort(key=lambda item: (item[1].startswith('java-reference/'), item[1].count('/'), item[1]))
    preview = [{'path': name, 'size': path.stat().st_size} for path, name in files
               if path.suffix.lower() in viewable and path.stat().st_size <= 256 * 1024][:400]
    write_json(workspace / 'outcome.json', {'report': report, 'artifacts': downloads, 'files': preview})


def main():
    workspace = Path(sys.argv[1]).resolve()
    if os.environ.get('HB_REQUIRE_SANDBOX') == '1':
        from .sandbox import restrict
        restrict(workspace)
    run(workspace)


if __name__ == '__main__':
    main()
