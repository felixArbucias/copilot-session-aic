export const NANO_AIU_PER_CREDIT = 1_000_000_000;

function quantity(value, name) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid ${name} returned by the Copilot runtime.`);
    }
    return value;
}

export function credits(value) {
    const nanoAiu = quantity(value, "AI credit total");
    return nanoAiu === null ? null : nanoAiu / NANO_AIU_PER_CREDIT;
}

export function toSnapshot(metrics, sessionId, now = new Date()) {
    if (!metrics || typeof metrics !== "object" || !metrics.modelMetrics
        || typeof metrics.modelMetrics !== "object" || Array.isArray(metrics.modelMetrics)) {
        throw new Error("The Copilot runtime returned an unsupported usage response.");
    }
    const models = Object.entries(metrics.modelMetrics)
        .filter(([, model]) => model != null)
        .map(([name, model]) => ({
            name,
            aiCredits: credits(model.totalNanoAiu),
            requests: quantity(model.requests?.count, "request count"),
            inputTokens: quantity(model.usage?.inputTokens, "input tokens"),
            outputTokens: quantity(model.usage?.outputTokens, "output tokens"),
            cacheReadTokens: quantity(model.usage?.cacheReadTokens, "cache read tokens"),
            cacheWriteTokens: quantity(model.usage?.cacheWriteTokens, "cache write tokens"),
        }))
        .sort((a, b) => (b.aiCredits ?? -1) - (a.aiCredits ?? -1) || a.name.localeCompare(b.name));
    const agents = Object.entries(metrics.agentMetrics ?? {})
        .filter(([, agent]) => agent != null)
        .map(([id, agent]) => ({
            id,
            name: id === "main" ? "Main conversation" : agent.agentDisplayName ?? agent.agentName ?? id,
            aiCredits: credits(agent.totalNanoAiu),
        }))
        .sort((a, b) => (b.aiCredits ?? -1) - (a.aiCredits ?? -1) || a.id.localeCompare(b.id));

    return {
        sessionId,
        source: "session.usage.getMetrics",
        observedAt: now.toISOString(),
        sessionStartTime: metrics.sessionStartTime ?? null,
        currentModel: metrics.currentModel ?? null,
        totalNanoAiu: quantity(metrics.totalNanoAiu, "AI credit total"),
        aiCredits: credits(metrics.totalNanoAiu),
        models,
        agents,
    };
}

export function createSnapshotReader(session) {
    let pending;
    return () => {
        if (!pending) {
            pending = (async () => {
                if (typeof session.rpc?.usage?.getMetrics !== "function") {
                    throw new Error("This Copilot runtime does not expose session usage. Update the app and reload the extension.");
                }
                return toSnapshot(await session.rpc.usage.getMetrics(), session.sessionId);
            })().finally(() => { pending = undefined; });
        }
        return pending;
    };
}
