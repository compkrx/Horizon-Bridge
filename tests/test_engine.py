import json
import os
import shutil
import stat
import struct
import subprocess
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

from engine.horizonbridge.archive import open_jar
from engine.horizonbridge.inspect_jar import inspect_jar
from engine.horizonbridge.translate import _lower_method, translate

from make_fixtures import build, fabric_descriptor, fixture_jar


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.jar = Path(scratch.name) / "upload.jar"

    def test_invalid_or_truncated_upload(self):
        self.jar.write_bytes(b"PK\x03\x04truncated")
        with self.assertRaises(ValueError):
            inspect_jar(self.jar)

    def test_traversal_and_ambiguous_paths(self):
        for names in (
            ("../outside.class",),
            ("/absolute",),
            ("folder\\file",),
            ("C:escape",),
            ("Dir/example", "dir/other"),
            ("parent", "parent/child"),
            ("CON.txt",),
            ("trailing.",),
        ):
            with self.subTest(names=names):
                fixture_jar(self.jar, {name: "data" for name in names})
                with self.assertRaises(ValueError):
                    inspect_jar(self.jar)

    def test_unrecognized_zip(self):
        fixture_jar(self.jar, {"notes.txt": "valid zip, no mod"})
        with self.assertRaisesRegex(ValueError, "No Minecraft mod"):
            inspect_jar(self.jar)

    def test_zip_symlink_and_ratio(self):
        with zipfile.ZipFile(self.jar, "w") as archive:
            link = zipfile.ZipInfo("linked")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(link, "../outside")
        with self.assertRaisesRegex(ValueError, "link or special"):
            inspect_jar(self.jar)
        fixture_jar(self.jar, {"fabric.mod.json": fabric_descriptor(), "huge": b"x" * (1024 * 1024 + 1)})
        with self.assertRaisesRegex(ValueError, "compression safety"):
            inspect_jar(self.jar)

    def test_bad_crc_even_on_unused_member(self):
        with zipfile.ZipFile(self.jar, "w", zipfile.ZIP_STORED) as archive:
            archive.writestr("fabric.mod.json", fabric_descriptor())
            archive.writestr("unused.txt", "crc test marker")
        self.jar.write_bytes(self.jar.read_bytes().replace(b"crc test marker", b"crc test broken"))
        with self.assertRaisesRegex(ValueError, "integrity"):
            inspect_jar(self.jar)

    def test_deflate_expansion_can_not_hide_behind_forged_size(self):
        fixture_jar(self.jar, {"fabric.mod.json": fabric_descriptor(), "payload": b"A" * 4096})
        with zipfile.ZipFile(self.jar) as archive:
            local_offset = archive.getinfo("payload").header_offset
        raw = bytearray(self.jar.read_bytes())
        central_offset = raw.index(b"PK\x01\x02", raw.index(b"PK\x01\x02") + 4)
        fake_crc = zlib.crc32(b"A")
        struct.pack_into("<I", raw, local_offset + 14, fake_crc)
        struct.pack_into("<I", raw, local_offset + 22, 1)
        struct.pack_into("<I", raw, central_offset + 16, fake_crc)
        struct.pack_into("<I", raw, central_offset + 24, 1)
        self.jar.write_bytes(raw)
        with zipfile.ZipFile(self.jar) as archive:
            self.assertEqual(archive.read("payload"), b"A")
        with self.assertRaisesRegex(ValueError, "exceeds its declared size"):
            inspect_jar(self.jar)

    def test_malformed_class_remains_inspectable(self):
        fixture_jar(self.jar, {"fabric.mod.json": fabric_descriptor(), "bad.class": b"\xca\xfe\xba\xbe"})
        inspection = inspect_jar(self.jar)
        self.assertEqual(inspection["classCount"], 1)
        self.assertIn("Truncated class-file", inspection["classIssues"][0])
        self.assertFalse(translate(inspection)["files"])


@unittest.skipUnless(shutil.which("javac"), "Java compiler is required for the original fixtures")
class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(directory.cleanup)
        cls.fixtures = Path(directory.name)
        build(cls.fixtures)

    def inspect(self, name):
        return inspect_jar(self.fixtures / f"{name}.jar")

    def test_loader_matrix(self):
        for source, loader in (
            ("forge", "Forge"), ("neoforge", "NeoForge"), ("quilt", "Quilt"), ("legacy", "Legacy Java"),
            ("logic", "Fabric"),
        ):
            with self.subTest(source=source):
                self.assertEqual(self.inspect(source)["metadata"]["loader"], loader)
        self.assertEqual(self.inspect("forge")["metadata"]["version"], "2.0.0")
        self.assertEqual(self.inspect("neoforge")["missingDependencies"], ["needed_library"])
        self.assertEqual(self.inspect("quilt")["metadata"]["author"], "Fixture author")
        self.assertEqual(self.inspect("legacy")["metadata"]["minecraft"], "1.12.2")

    def test_capabilities_and_data_evidence(self):
        result = self.inspect("capabilities")
        self.assertEqual(result["missingDependencies"], ["absent_library"])
        self.assertEqual(result["mixins"], ["fixture.mixins.json"])
        self.assertIn("config/fixture.properties", result["configurationFiles"])
        self.assertTrue({
            "HUD and client UI", "Keybindings and input", "Configuration APIs", "Commands",
            "Rendering", "Events and callbacks", "Networking"
        }.issubset({feature["name"] for feature in result["features"]}))
        self.assertEqual(self.inspect("data")["resourceCount"], 2)

    def test_future_class_version_is_reported_without_translation(self):
        result = self.inspect("future")
        self.assertEqual(result["javaMajor"], 100)
        self.assertFalse(translate(result)["files"])
        self.assertIn("Java class-file compatibility", [feature["name"] for feature in result["features"]])

    def test_partial_translation_and_ir(self):
        translated = translate(self.inspect("logic"))
        self.assertEqual(len(translated["methodMap"]), 7)
        self.assertIsNone(translated["native"])
        self.assertIn("Unsupported JVM instruction 0x6c", translated["features"][-1]["detail"])
        self.assertEqual(translated["ir"]["classCount"], 1)
        self.assertEqual(json.loads(json.dumps(translated["ir"])), translated["ir"])

    def test_exact_client_hook_and_blocked_variants(self):
        result = translate(self.inspect("startup"))
        self.assertEqual(result["native"]["startupMessage"], "Hello from HorizonBridge's fixture. 🚀")
        with open_jar(self.fixtures / "startup.jar") as source:
            original = source.read("fixture/Startup.class")
        for edits in (
            {"environment": "server"},
            {"entrypoints": {"main": ["fixture.Startup"]}},
            {"entrypoints": {"client": [{"adapter": "anything", "value": "fixture.Startup"}]}},
            {"depends": {"external": "*"}},
            {"mixins": ["mixins.json"]},
        ):
            with self.subTest(edits=edits):
                path = fixture_jar(self.fixtures / "changed.jar", {
                    "fabric.mod.json": fabric_descriptor(
                        **{"environment": "client", "entrypoints": {"client": ["fixture.Startup"]}, **edits}
                    ),
                    "fixture/Startup.class": original,
                })
                self.assertIsNone(translate(inspect_jar(path))["native"])

    def test_rust_numeric_and_branch_semantics(self):
        rustc = os.environ.get("HB_RUSTC") or shutil.which("rustc")
        if not rustc:
            self.skipTest("Rust compiler is unavailable")
        translated = translate(self.inspect("logic"))
        mapping = {entry["java"].split(".")[-1].split("(")[0]: entry["rust"] for entry in translated["methodMap"]}
        checks = {
            "add": ("i32::MAX, 1", "i32::MIN"),
            "branches": ("-7", "7"),
            "sum": ("9", "36"),
            "unsignedShift": ("-1, 33", "i32::MAX"),
            "minAbs": ("i32::MIN, 0", "i32::MIN"),
            "narrow": ("65535", "-1"),
            "less": ("3, 4", "true"),
        }
        code = translated["files"]["src/translated.rs"] + "\nfn main() {\n"
        for method, (args, expected) in checks.items():
            code += f"    assert_eq!({mapping[method]}({args}), {expected});\n"
        code += f"    assert_eq!({mapping['branches']}(7), 18);\n}}\n"
        source = self.fixtures / "probe.rs"
        source.write_text(code, encoding="utf-8")
        executable = self.fixtures / ("probe.exe" if os.name == "nt" else "probe")
        subprocess.run([rustc, "--edition=2021", str(source), "-o", str(executable)], check=True, timeout=60)
        subprocess.run([str(executable)], check=True, timeout=10)

    def test_invalid_control_flow_refused(self):
        frame = {"name": "bad", "descriptor": "()I", "params": "", "returns": "I", "locals": 1, "stack": 1}
        with self.assertRaisesRegex(ValueError, "before assignment"):
            _lower_method("fixture/Invalid", {**frame, "instructions": [[0, "load", 0], [1, "return"]]})
        with self.assertRaisesRegex(ValueError, "instruction boundary"):
            _lower_method("fixture/Invalid", {**frame, "instructions": [[0, "goto", 100], [1, "return"]]})
        with self.assertRaisesRegex(ValueError, "underflow"):
            _lower_method("fixture/Invalid", {**frame, "instructions": [[0, "return"]]})
