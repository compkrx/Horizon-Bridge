"""Build original fixture classes locally. No dependencies or game launch."""

import argparse
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

FIXTURE_SOURCE = Path(__file__).parent / "fixtures"


def fixture_jar(path: Path, members: dict[str, str | bytes]) -> Path:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(members.items()):
            archive.writestr(name, data)
    return path


def fabric_descriptor(**fields) -> str:
    return json.dumps({
        "schemaVersion": 1, "id": "bridge_fixture", "name": "Bridge Fixture",
        "version": "1.0.0", "license": "CC0-1.0", "depends": {"minecraft": "~1.21.11"},
        **fields,
    })


def build(output: Path) -> None:
    javac = shutil.which("javac")
    if not javac:
        raise RuntimeError("javac is required to compile the fixture classes.")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run([
            javac, "-encoding", "UTF-8", "--release", "8", "-Xlint:-options", "-d", directory,
            *map(str, sorted(FIXTURE_SOURCE.glob("*.java"))),
        ], check=True)
        logic = (Path(directory) / "fixture/Logic.class").read_bytes()
        startup = (Path(directory) / "fixture/Startup.class").read_bytes()
        fixture_jar(output / "logic.jar", {
            "fabric.mod.json": fabric_descriptor(), "fixture/Logic.class": logic,
        })
        fixture_jar(output / "startup.jar", {
            "fabric.mod.json": fabric_descriptor(environment="client", entrypoints={"client": ["fixture.Startup"]}),
            "fixture/Startup.class": startup,
        })
        fixture_jar(output / "future.jar", {
            "fabric.mod.json": fabric_descriptor(),
            "fixture/Logic.class": logic[:6] + (100).to_bytes(2, "big") + logic[8:],
        })
        fixture_jar(output / "capabilities.jar", {
            "fabric.mod.json": fabric_descriptor(
                mixins=["fixture.mixins.json"], depends={"minecraft": "1.20.4", "absent_library": "^1"}
            ),
            "fixture.mixins.json": "{}",
            "config/fixture.properties": "enabled=true\n",
            **{f"fixture/{file.name}": file.read_bytes() for file in Path(directory).glob("fixture/Capabilities*.class")},
        })
    fixture_jar(output / "legacy.jar", {"mcmod.info": json.dumps([{
        "modid": "legacy_fixture", "version": "0.1", "name": "Legacy Fixture", "mcversion": "1.12.2"
    }])})
    fixture_jar(output / "forge.jar", {"META-INF/mods.toml": """
modLoader = "javafml"
license = "CC0-1.0"
[[mods]]
modId = "bridge_forge"
displayName = "Bridge Forge"
version = "${file.jarVersion}"
authors = "HorizonRelay Test Fixture"
[[dependencies.bridge_forge]]
modId = "minecraft"
mandatory = true
versionRange = "[1.20.1,1.21)"
""", "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\nImplementation-Version: 2.0.0\n"})
    fixture_jar(output / "neoforge.jar", {"META-INF/neoforge.mods.toml": """
modLoader = "javafml"
license = "CC0-1.0"
[[mods]]
modId = "bridge_neoforge"
displayName = "Bridge NeoForge"
version = "1.0"
[[dependencies.bridge_neoforge]]
modId = "needed_library"
type = "required"
versionRange = "[2,)"
"""})
    fixture_jar(output / "quilt.jar", {"quilt.mod.json": json.dumps({
        "schema_version": 1, "quilt_loader": {
            "group": "fixture", "id": "bridge_quilt", "version": "1.0.0",
            "metadata": {"contributors": {"Fixture author": "Owner"}, "license": {"name": "CC0-1.0"}},
            "depends": [{"id": "minecraft", "versions": ">=1.20"}],
        },
    })})
    fixture_jar(output / "data.jar", {
        "fabric.mod.json": fabric_descriptor(),
        "assets/minecraft/lang/en_us.json": json.dumps({"gui.done": "Finish"}),
        "data/bridge_fixture/recipe/simple.json": json.dumps({
            "type": "minecraft:crafting_shapeless", "ingredients": ["minecraft:stick"],
            "result": {"id": "minecraft:stick"},
        }),
    })
    fixture_jar(output / "asset.jar", {
        "fabric.mod.json": fabric_descriptor(id="hb_recipe", name="HorizonRelay recipe fixture",
                                              minecraft="26.3", depends={"minecraft": "26.3"}),
        "data/hb_recipe/recipe/test.json": json.dumps({
            "type": "minecraft:crafting_shapeless", "ingredients": ["minecraft:stick"],
            "result": {"id": "minecraft:oak_planks", "count": 1},
        }),
    })


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Destination directory for generated fixture JARs")
    build(parser.parse_args().output)
