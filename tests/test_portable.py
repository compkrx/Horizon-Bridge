import json
import zipfile

from engine.horizonbridge.browser import convert_browser, vanilla_recipe
from make_fixtures import fabric_descriptor, fixture_jar


def test_portable_recipe_export_keeps_namespace_and_reports_skipped_assets(tmp_path):
    recipe = {"type": "minecraft:crafting_shaped", "pattern": ["A", "A"],
              "key": {"A": "minecraft:oak_planks"}, "result": {"id": "minecraft:stick", "count": 4}}
    own = "data/bridge_fixture/recipe/stick.json"
    foreign = "data/minecraft/recipe/stick.json"
    jar = fixture_jar(tmp_path / "input.jar", {"fabric.mod.json": fabric_descriptor(), own: json.dumps(recipe),
                                               foreign: json.dumps(recipe), "LICENSE.txt": "Original fixture notice"})
    output = tmp_path / "output"
    result = convert_browser(jar, output, runtime="cli")
    assert result["report"]["runtime"] == "cli"
    assert result["report"]["classification"] == "partial"
    assert result["report"]["resources"]["entries"] == [{"path": own, "exported": True}, {"path": foreign, "exported": False}]
    with zipfile.ZipFile(output / "bridge_fixture.hmod") as bundle:
        assert bundle.namelist() == [own, "horizon-mod.toml"]
        assert json.loads(bundle.read(own)) == recipe
    with zipfile.ZipFile(output / "horizonbridge-source.zip") as source:
        assert source.read("notices/LICENSE.txt") == b"Original fixture notice"


def test_portable_recipe_rejects_alternatives_and_components():
    simple = {"type": "minecraft:crafting_shapeless", "ingredients": ["minecraft:stick"], "result": {"id": "minecraft:torch"}}
    assert vanilla_recipe(simple)
    assert not vanilla_recipe({**simple, "ingredients": [["minecraft:stick", "minecraft:coal"]]})
    assert not vanilla_recipe({**simple, "ingredients": ["#minecraft:planks"]})
    assert not vanilla_recipe({**simple, "result": {"id": "minecraft:torch", "components": {}}})
