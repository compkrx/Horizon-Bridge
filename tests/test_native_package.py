import hashlib
import json
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from engine.horizonrelay.native_package import inspect_native_package


REVISION = 'a' * 40


def bundle(path, mixin_revision=REVISION, **entries):
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('horizon-native.json', json.dumps({
            'schema': 1, 'id': 'example', 'version': '1.2.3', 'game': '26.3',
            'horizon': REVISION, 'mixins': 'b' * 40, 'hooks': 411,
        }))
        archive.writestr('mixins/example/horizon-mixin.toml', f'''
[mod]
id = "example"
version = "1.2.3"
[compatibility]
horizon_revision = "{mixin_revision}"
[[module]]
id = "hooks"
[[injection]]
id = "startup"
kind = "HEAD"
hook = "client_start"
hook_version = 1
cancellable = true
''')
        archive.writestr('mixins/example/hooks.rs', 'fn start() {}')
        archive.writestr('mixins/example/LICENSE', 'Example')
        for name, data in entries.items():
            archive.writestr(name, data)


def test_reads_declared_revisions_hooks_and_notices(tmp_path):
    path = tmp_path / 'example.hnmod'
    bundle(path)
    report = inspect_native_package(path)
    assert report['scope'] == 'static-inspection'
    assert report['horizonRevision'] == REVISION
    assert report['mixinsRevision'] == 'b' * 40
    assert report['hookApi'] == 411
    assert report['rustFiles'] == report['modules'] == report['injections'] == 1
    assert report['declaredInjections'][0]['id'] == 'startup'
    assert report['declaredInjections'][0]['hook'] == 'client_start'
    assert report['declaredInjections'][0]['hookVersion'] == 1
    assert report['declaredInjections'][0]['cancellable']
    assert report['noticeFiles'] == ['mixins/example/LICENSE']
    assert report['sha256'] == hashlib.sha256(path.read_bytes()).hexdigest()


def test_rejects_mismatched_manifest_and_unsafe_member(tmp_path):
    path = tmp_path / 'example.hnmod'
    bundle(path, mixin_revision='c' * 40)
    with pytest.raises(ValueError, match='manifests disagree'):
        inspect_native_package(path)
    bundle(path, **{'../escape.rs': 'unsafe'})
    with pytest.raises(ValueError, match='unsafe member path'):
        inspect_native_package(path)
