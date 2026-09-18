import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
    options: {
        runtime: { type: "string" },
        sdk: { type: "string" },
        source: { type: "string", default: fileURLToPath(new URL("../", import.meta.url)) },
        marketplace: { type: "boolean", default: false },
        "migrate-from": { type: "string" },
        "legacy-source": { type: "string" },
    },
});
if (!values.runtime || !values.sdk) {
    throw new Error("Provide --runtime <Copilot executable> and --sdk <bundled copilot-sdk directory>.");
}
if (values["migrate-from"] || values["legacy-source"]) {
    assert.ok(["direct", "marketplace"].includes(values["migrate-from"]), "--migrate-from must be direct or marketplace.");
    assert.ok(values["legacy-source"], "Provide --legacy-source <v0.1.0 package> for migration checks.");
}
const runtime = resolve(values.runtime);
const sdk = resolve(values.sdk);
const { CopilotClient, RuntimeConnection } = await import(pathToFileURL(join(sdk, "index.js")).href);
const home = await mkdtemp(join(tmpdir(), "copilot-usage-monitor-smoke-"));
const env = { ...process.env, COPILOT_HOME: home, COPILOT_CACHE_HOME: join(home, "cache"), COPILOT_AUTO_UPDATE: "false" };
const cli = (...args) => {
    const result = spawnSync(runtime, ["plugin", ...args], { env, cwd: home, encoding: "utf8", timeout: 120000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${args.join(" ")} failed:\n${result.stderr}\n${result.stdout}`);
    return result.stdout;
};
let client;
try {
    if (values["migrate-from"]) {
        const marketplace = values["migrate-from"] === "marketplace";
        const legacyName = marketplace ? "session-aic@session-aic-marketplace" : "session-aic";
        if (marketplace) cli("marketplace", "add", values["legacy-source"]);
        cli("install", marketplace ? legacyName : values["legacy-source"]);
        assert.equal(JSON.parse(cli("list", "--json")).find((plugin) => plugin.name === "session-aic")?.version, "0.1.0");
        cli("uninstall", legacyName);
        if (marketplace) cli("marketplace", "remove", "session-aic-marketplace");
        assert.deepEqual(JSON.parse(cli("list", "--json")), []);
    }
    const name = values.marketplace ? "copilot-usage-monitor@copilot-usage-monitor-marketplace" : "copilot-usage-monitor";
    if (values.marketplace) {
        cli("marketplace", "add", values.source);
        const catalog = JSON.parse(cli("marketplace", "browse", "copilot-usage-monitor-marketplace", "--json"));
        assert.ok(catalog.some((plugin) => plugin.name === "copilot-usage-monitor"));
    }
    cli("install", values.marketplace ? name : values.source);
    const installed = JSON.parse(cli("list", "--json"));
    assert.equal(installed.find((plugin) => plugin.name === "copilot-usage-monitor")?.version, "0.2.0");
    assert.equal(installed.length, 1);
    if (values.marketplace) {
        cli("disable", name);
        assert.equal(JSON.parse(cli("list", "--json")).find((plugin) => plugin.name === "copilot-usage-monitor")?.enabled, false);
        cli("enable", name);
    }
    client = new CopilotClient({
        connection: RuntimeConnection.forStdio({ path: runtime }),
        baseDirectory: home,
        workingDirectory: home,
        env,
        useLoggedInUser: false,
    });
    await client.start();
    const session = await client.createSession({
        model: "packaging-test",
        // No prompt is sent. This unreachable BYOK endpoint avoids Copilot authentication.
        provider: { type: "openai", baseUrl: "http://127.0.0.1:9/v1" },
        workingDirectory: home,
        requestCanvasRenderer: true,
        requestExtensions: true,
        extensionSdkPath: sdk,
        enableConfigDiscovery: true,
        enableSessionTelemetry: false,
        skipCustomInstructions: true,
        availableTools: [],
        onPermissionRequest: async () => ({ kind: "denied-interactively-by-user" }),
    });
    await session.rpc.extensions.reload();
    const extensions = (await session.rpc.extensions.list()).extensions;
    assert.ok(!extensions.some((entry) => entry.id === "plugin:session-aic:session-aic"));
    const extension = extensions.find((entry) => entry.id === "plugin:copilot-usage-monitor:copilot-usage-monitor");
    assert.equal(extension?.status, "running");
    const canvases = (await session.rpc.canvas.list()).canvases;
    assert.ok(!canvases.some((entry) => entry.canvasId === "session-aic"));
    const canvas = canvases.find((entry) => entry.canvasId === "copilot-usage-monitor");
    assert.equal(canvas?.extensionId, extension.id);
    assert.equal(canvas.displayName, "Copilot Usage Monitor");
    assert.equal(canvas.description, "Track AI credits used by each Copilot session, with live model and agent breakdowns.");
    assert.deepEqual(canvas.actions.map((action) => action.name), ["refresh"]);
    assert.deepEqual(canvas.inputSchema, { type: "object", properties: {}, additionalProperties: false });
    const opened = await session.rpc.canvas.open({ canvasId: "copilot-usage-monitor", instanceId: "package-smoke", input: {} });
    assert.equal(opened.title, "Copilot Usage Monitor");
    assert.equal(new URL(opened.url).hostname, "127.0.0.1");
    const response = await fetch(opened.url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<h1>Copilot Usage Monitor<\/h1>/);
    const { result } = await session.rpc.canvas.action.invoke({ instanceId: opened.instanceId, actionName: "refresh", input: {} });
    const metrics = await session.rpc.usage.getMetrics();
    assert.equal(result.sessionId, session.sessionId);
    assert.equal(result.aiCredits, metrics.totalNanoAiu == null ? null : metrics.totalNanoAiu / 1e9);
    assert.deepEqual((await (await fetch(`${opened.url}api/usage`)).json()).models, result.models);
    await assert.rejects(
        session.rpc.canvas.open({ canvasId: "copilot-usage-monitor", instanceId: "invalid-input", input: { unexpected: true } }),
        /input|schema|additional|unexpected/i,
    );
    await assert.rejects(
        session.rpc.canvas.action.invoke({ instanceId: opened.instanceId, actionName: "refresh", input: { unexpected: true } }),
        /input|schema|additional|unexpected/i,
    );
    await assert.rejects(
        session.rpc.canvas.action.invoke({ instanceId: opened.instanceId, actionName: "canvas.open", input: {} }),
        /reserved/i,
    );
    await session.rpc.canvas.close({ instanceId: opened.instanceId });
    assert.equal((await session.rpc.canvas.listOpen()).openCanvases.length, 0);
    await client.stop();
    client = undefined;
    cli("uninstall", name);
    // Local marketplace plugins load from the checkout: uninstall disables, never deletes source.
    for (const remaining of JSON.parse(cli("list", "--json"))) {
        assert.equal(remaining.source, "live");
        assert.equal(remaining.enabled, false);
    }
    if (values.marketplace) cli("marketplace", "remove", "copilot-usage-monitor-marketplace");
    assert.equal(JSON.parse(cli("list", "--json")).length, 0);
    console.log(`PASS: ${values["migrate-from"] ? `v0.1.0 ${values["migrate-from"]} migration; ` : ""}isolated ${values.marketplace ? "marketplace install and disable/enable" : "direct install"}, discovery, open, refresh, input checks, close, and uninstall. No AI calls.`);
} finally {
    try {
        if (client) await client.stop();
    } finally {
        await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
}
