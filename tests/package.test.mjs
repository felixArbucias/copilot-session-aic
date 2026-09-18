import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const version = /^\d+\.\d+\.\d+$/;

test("legacy manifest declares only supported metadata and the extension search root", async () => {
    const plugin = await json("plugin.json");
    const allowed = new Set(["name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"]);
    for (const key of Object.keys(plugin)) assert.ok(allowed.has(key), `Unsupported manifest field: ${key}`);
    assert.equal(plugin.name, "copilot-usage-monitor");
    assert.match(plugin.version, version);
    assert.equal(plugin.description, "Track AI credits used by each Copilot session, with live model and agent breakdowns.");
    assert.equal(plugin.license, "MIT");
    assert.equal(plugin.author.name, "Felix");
    assert.equal(plugin.repository, "https://github.com/felixArbucias/copilot-usage-monitor");
    assert.equal(plugin.homepage, plugin.repository);
    assert.deepEqual(plugin.keywords, ["copilot", "usage", "ai-credits", "billing", "session"]);
    assert.equal(plugin.$schema, undefined, "Agent Plugins 1.0 changes extension discovery semantics");
    assert.deepEqual(plugin.extensions, ["./extensions"]);
    assert.deepEqual(await readdir(new URL("extensions/", root)), ["copilot-usage-monitor"]);
    for (const file of ["extension.mjs", "usage.mjs", "server.mjs", "panel.html", "panel.css", "panel.mjs", "help.txt"]) {
        assert.ok((await stat(new URL(`extensions/copilot-usage-monitor/${file}`, root))).isFile());
    }
});

test("self-hosted marketplace uses the canonical path and points to the root plugin", async () => {
    const marketplace = await json(".github/plugin/marketplace.json");
    const plugin = await json("plugin.json");
    assert.deepEqual(Object.keys(marketplace).sort(), ["metadata", "name", "owner", "plugins"]);
    assert.equal(marketplace.name, "copilot-usage-monitor-marketplace");
    assert.equal(marketplace.owner.name, "felixArbucias");
    assert.equal(marketplace.metadata.version, plugin.version);
    assert.equal(marketplace.plugins.length, 1);
    const entry = marketplace.plugins[0];
    assert.deepEqual(Object.keys(entry).sort(), ["description", "license", "name", "source", "version"]);
    assert.equal(entry.name, plugin.name);
    assert.equal(entry.version, plugin.version);
    assert.equal(entry.license, plugin.license);
    assert.equal(entry.description, plugin.description);
    assert.equal(entry.source, "./");
    assert.deepEqual(await json(`${entry.source}plugin.json`), plugin);
});

test("package metadata stays dependency-free and agrees with the plugin version", async () => {
    const metadata = await json("package.json");
    const plugin = await json("plugin.json");
    assert.equal(metadata.name, plugin.name);
    assert.equal(metadata.version, plugin.version);
    assert.equal(metadata.description, plugin.description);
    assert.deepEqual(metadata.keywords, plugin.keywords);
    assert.equal(metadata.private, true);
    assert.equal(metadata.license, "MIT");
    assert.equal(metadata.dependencies, undefined);
    assert.equal(metadata.devDependencies, undefined);
    assert.equal(metadata.engines.node, ">=22");
    assert.match(await readFile(new URL("LICENSE", root), "utf8"), /MIT License/);
});

test("documentation includes a real PNG demo screenshot", async () => {
    const image = await readFile(new URL("docs/images/copilot-usage-monitor-demo.png", root));
    assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(image.readUInt32BE(16), 420);
    assert.ok(image.readUInt32BE(20) >= 700);
    const readme = await readFile(new URL("README.md", root), "utf8");
    assert.match(readme, /docs\/images\/copilot-usage-monitor-demo\.png/);
    assert.match(readme, /synthetic demo data/i);
});

test("documentation explains explicit migration from both legacy plugin identities", async () => {
    for (const path of ["README.md", "extensions/copilot-usage-monitor/help.txt"]) {
        const text = await readFile(new URL(path, root), "utf8");
        for (const command of [
            "copilot plugin uninstall session-aic@session-aic-marketplace",
            "copilot plugin marketplace remove session-aic-marketplace",
            "copilot plugin uninstall session-aic",
            "copilot plugin marketplace add felixArbucias/copilot-usage-monitor",
            "copilot plugin install copilot-usage-monitor@copilot-usage-monitor-marketplace",
        ]) assert.ok(text.includes(command), `${path} must document: ${command}`);
        assert.match(text, /user:session-aic/);
        assert.match(text, /redirects do not migrate plugin IDs automatically/);
    }
});
