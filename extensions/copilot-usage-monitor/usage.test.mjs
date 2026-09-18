import test from "node:test";
import assert from "node:assert/strict";
import { credits, toSnapshot, createSnapshotReader } from "./usage.mjs";

const metrics = () => ({
    totalNanoAiu: 2_500_000_000,
    totalPremiumRequestCost: 999,
    sessionStartTime: "2026-09-18T18:00:00Z",
    modelMetrics: {
        "model-a": { totalNanoAiu: 1_000_000_000, requests: { count: 2 }, usage: { inputTokens: 100 } },
        "model-b": { totalNanoAiu: 500_000_000, requests: { count: 1 } },
    },
    agentMetrics: {
        main: { totalNanoAiu: 1_500_000_000 },
        worker: { totalNanoAiu: 1_000_000_000, agentDisplayName: "Research" },
    },
});

test("uses nano-AIU conversion and preserves small nonzero values", () => {
    assert.equal(credits(1_000_000_000), 1);
    assert.equal(credits(1), 1e-9);
    assert.equal(credits(0), 0);
    assert.equal(credits(undefined), null);
});
test("uses authoritative total without double-counting model or agent breakdowns", () => {
    const result = toSnapshot(metrics(), "session-one", new Date("2026-09-18T18:10:00Z"));
    assert.equal(result.aiCredits, 2.5);
    assert.equal(result.totalNanoAiu, 2_500_000_000);
    assert.equal(result.sessionId, "session-one");
    assert.equal(result.models[0].aiCredits, 1);
    assert.equal(result.agents[0].name, "Main conversation");
    assert.equal(result.observedAt, "2026-09-18T18:10:00.000Z");
});
test("never substitutes premium request multipliers for missing billing", () => {
    const input = metrics();
    delete input.totalNanoAiu;
    delete input.modelMetrics["model-a"].totalNanoAiu;
    const result = toSnapshot(input, "old-runtime");
    assert.equal(result.aiCredits, null);
    assert.equal(result.models.find((m) => m.name === "model-a").aiCredits, null);
});
test("accepts genuine zero usage and no calls", () => {
    const result = toSnapshot({ totalNanoAiu: 0, modelMetrics: {} }, "empty");
    assert.equal(result.aiCredits, 0);
    assert.deepEqual(result.models, []);
    assert.deepEqual(result.agents, []);
});
test("invalid data raises an explicit error", () => {
    for (const value of [-1, Infinity, NaN, "10"]) assert.throws(() => credits(value), /Invalid/);
    for (const value of [null, {}, { modelMetrics: [] }]) assert.throws(() => toSnapshot(value, "bad"), /unsupported/);
});
test("reloads use runtime totals rather than resetting or adding snapshots", async () => {
    let calls = 0;
    const session = { sessionId: "persistent", rpc: { usage: { getMetrics: async () => {
        calls++;
        return metrics();
    } } } };
    const reader = createSnapshotReader(session);
    assert.equal((await reader()).aiCredits, 2.5);
    assert.equal((await reader()).aiCredits, 2.5);
    assert.equal((await createSnapshotReader(session)()).aiCredits, 2.5);
    assert.equal(calls, 3);
});
test("simultaneous reads share one RPC and recover from rejection", async () => {
    let resolve;
    let calls = 0;
    const reader = createSnapshotReader({
        sessionId: "one",
        rpc: { usage: { getMetrics: () => {
            calls++;
            return new Promise((r) => { resolve = r; });
        } } },
    });
    const first = reader();
    const second = reader();
    assert.equal(first, second);
    resolve(metrics());
    await first;
    assert.equal(calls, 1);
    let attempts = 0;
    const retry = createSnapshotReader({ sessionId: "retry", rpc: { usage: { getMetrics: async () => {
        if (++attempts === 1) throw new Error("disconnected");
        return metrics();
    } } } });
    await assert.rejects(retry(), /disconnected/);
    assert.equal((await retry()).aiCredits, 2.5);
});
test("sessions remain isolated and missing RPC is explicit", async () => {
    const first = createSnapshotReader({ sessionId: "a", rpc: { usage: { getMetrics: async () => metrics() } } });
    const second = createSnapshotReader({ sessionId: "b", rpc: { usage: { getMetrics: async () => ({ totalNanoAiu: 0, modelMetrics: {} }) } } });
    assert.equal((await first()).aiCredits, 2.5);
    assert.equal((await second()).aiCredits, 0);
    await assert.rejects(createSnapshotReader({ sessionId: "old", rpc: {} })(), /Update the app/);
});
