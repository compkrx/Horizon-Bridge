"""Package tests using Horizon's real tools when their isolated profile is enabled."""

import json
import os
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from engine.horizonrelay.horizon import HOOK_API, HORIZON, MIXINS, convert
from engine.horizonrelay.inspect_jar import inspect_jar
from engine.horizonrelay.translate import translate
from make_fixtures import build, fabric_descriptor, fixture_jar


class HorizonPackagingTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)

    def convert(self, path):
        inspection = inspect_jar(path)
        return convert(path, inspection, translate(inspection), self.root / "source", self.root / "packages", lambda _: None)

    @unittest.skipUnless(os.environ.get("HORIZONBRIDGE_ENABLE_ASSETS") == "1", "Isolated content toolchain required")
    def test_official_content_package_and_recipe(self):
        recipe_path = "data/bridge_fixture/recipe/simple.json"
        fixture = fixture_jar(self.root / "recipe.jar", {
            "fabric.mod.json": fabric_descriptor(depends={"minecraft": "26.3"}),
            recipe_path: json.dumps({
                "type": "minecraft:crafting_shapeless", "ingredients": ["minecraft:stick"],
                "result": {"id": "minecraft:oak_planks", "count": 1},
            }),
        })
        result = self.convert(fixture)
        self.assertEqual([item["kind"] for item in result["artifacts"]], ["hmod"], result)
        self.assertEqual(result["features"][0]["status"], "translated", result)
        with zipfile.ZipFile(self.root / "packages" / result["artifacts"][0]["name"]) as archive:
            self.assertIn("horizon-mod.toml", archive.namelist())
            self.assertIn(recipe_path, archive.namelist())
            self.assertTrue(all(not name.endswith((".rs", ".class")) for name in archive.namelist()))

    @unittest.skipUnless(os.environ.get("HORIZONBRIDGE_ENABLE_NATIVE") == "1" and shutil.which("javac"),
                         "Isolated native toolchain and javac required")
    def test_official_native_source_archive(self):
        build(self.root)
        result = self.convert(self.root / "startup.jar")
        self.assertEqual([item["kind"] for item in result["artifacts"]], ["hnmod"], result)
        self.assertEqual(result["validation"][-1]["status"], "skipped", result)
        with zipfile.ZipFile(self.root / "packages" / result["artifacts"][0]["name"]) as archive:
            manifest = json.loads(archive.read("horizon-native.json"))
            self.assertEqual(manifest, {
                "game": "26.3", "hooks": HOOK_API, "horizon": HORIZON, "id": "bridge_fixture",
                "mixins": MIXINS, "schema": 1, "version": "1.0.0",
            })
            self.assertEqual(set(archive.namelist()), {
                "horizon-native.json", "mixins/bridge_fixture/horizon-mixin.toml",
                "mixins/bridge_fixture/client_start.rs", "mixins/bridge_fixture/list.rs", "mixins/bridge_fixture/LICENSE",
            })
            self.assertIn(b"Hello from HorizonRelay's fixture. \\u{1f680}", archive.read("mixins/bridge_fixture/client_start.rs"))


if __name__ == "__main__":
    unittest.main()
