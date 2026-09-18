import { pathToFileURL } from "node:url";
import { startServer } from "../extensions/copilot-usage-monitor/server.mjs";
import { toSnapshot } from "../extensions/copilot-usage-monitor/usage.mjs";

export async function startDemo() {
    return startServer({
        readSnapshot: async () => toSnapshot({
            totalNanoAiu: 12_750_000_000,
            sessionStartTime: "2026-01-01T12:00:00Z",
            currentModel: "Demo model A",
            modelMetrics: {
                "Demo model A": { totalNanoAiu: 9_500_000_000, requests: { count: 12 } },
                "Demo model B": { totalNanoAiu: 3_250_000_000, requests: { count: 5 } },
            },
            agentMetrics: {
                main: { totalNanoAiu: 10_000_000_000 },
                "demo-worker": { agentDisplayName: "Demo research agent", totalNanoAiu: 2_750_000_000 },
            },
        }, "DEMO-DATA-NOT-A-REAL-SESSION", new Date("2026-01-01T12:10:00Z")),
        reportError: async (error) => console.error(error),
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const panel = await startDemo();
    console.log(`Synthetic demo data only. Open ${panel.url}`);
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.once(signal, async () => { await panel.close(); });
    }
}
