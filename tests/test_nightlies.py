from scripts.refresh_nightlies import details, discover, merge


def test_discover_uses_immutable_nightly_tags_and_peels_annotated_tags():
    latest = "1234567" + "a" * 33
    prior = "7654321" + "b" * 33
    current, builds = discover(f"""{'c' * 40}\trefs/tags/nightly
{latest}\trefs/tags/nightly^{{}}
{latest}\trefs/tags/nightly-source/2026-11-09-1234567
{prior}\trefs/tags/nightly-2026-11-01
{prior}\trefs/tags/nightly-source/2026-11-01-7654321
{prior}\trefs/tags/nightly-source/2026-10-27-0000000
{prior}\trefs/tags/launcher@0.2.58
""")
    assert current == latest
    assert set(builds) == {("2026-11-09", latest), ("2026-11-01", prior)}
    assert builds[("2026-11-01", prior)].endswith("nightly-source/2026-11-01-7654321")


def test_refresh_preserves_records_even_when_upstream_prunes_the_release():
    first, second = "a" * 40, "b" * 40
    inspect = lambda _: {"minecraft": "26.3", "hookApi": 410, "mixinsRevision": None, "contentApi": "0.2", "nativeStartup": False}
    old = merge(first, {("2026-10-01", first): "old-release"}, [], inspect)
    new = merge(second, {("2026-11-01", second): "new-release"}, old["targets"], inspect)
    assert [row["horizonRevision"] for row in new["targets"]] == [second, first]
    assert new["current"] == new["targets"][0]["id"]
    assert new["targets"][1] == old["targets"][0]


def test_missing_signatures_do_not_enable_native_startup(monkeypatch):
    files = {"version.rs": 'pub const VANILLA_VERSION: &str = "26.3";',
             "manifest.rs": 'pub const APIS: [&str; 2] = ["0.1", "0.2"];',
             "native_hooks.rs": 'pub(crate) const NATIVE_HOOKS_API: u32 = 411;'}
    monkeypatch.setattr("scripts.refresh_nightlies.get_text", lambda url: files.get(url.split("/")[-1]))
    profile = details("c" * 40)
    assert profile["minecraft"] == "26.3" and profile["contentApi"] == "0.2"
    assert profile["hookApi"] == 411 and profile["nativeStartup"] is False
