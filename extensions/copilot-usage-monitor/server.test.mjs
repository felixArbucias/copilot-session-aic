import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";

test("serves the local panel and authoritative snapshot with private routes", async (t) => {
    const panel = await startServer({
        readSnapshot: async () => ({ sessionId: "a", aiCredits: 1.25 }),
        reportError: async () => assert.fail("unexpected error"),
    });
    t.after(() => panel.close());
    assert.equal(new URL(panel.url).hostname, "127.0.0.1");
    const html = await fetch(panel.url);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Copilot Usage Monitor/);
    assert.match(html.headers.get("content-security-policy"), /default-src 'none'/);
    for (const file of ["panel.css", "panel.mjs"]) assert.equal((await fetch(`${panel.url}${file}`)).status, 200);
    const data = await fetch(`${panel.url}api/usage`);
    assert.equal(data.headers.get("cache-control"), "no-store");
    assert.deepEqual(await data.json(), { sessionId: "a", aiCredits: 1.25 });
    assert.equal((await fetch(new URL("/", panel.url))).status, 404);
    assert.equal((await fetch(`${panel.url}missing`)).status, 404);
    assert.equal((await fetch(`${panel.url}api/usage`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${panel.url}api/usage`, { headers: { Origin: "https://example.com" } })).status, 403);
});
test("errors are surfaced as 503, logged, and recover on the next read", async (t) => {
    let failing = true;
    const errors = [];
    const panel = await startServer({
        readSnapshot: async () => {
            if (failing) throw new Error("runtime disconnected");
            return { aiCredits: 0 };
        },
        reportError: async (error) => errors.push(error.message),
    });
    t.after(() => panel.close());
    for (let i = 0; i < 2; i++) {
        const response = await fetch(`${panel.url}api/usage`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: "runtime disconnected" });
    }
    assert.deepEqual(errors, ["runtime disconnected"]);
    failing = false;
    const response = await fetch(`${panel.url}api/usage`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { aiCredits: 0 });
});
