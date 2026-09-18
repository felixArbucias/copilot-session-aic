import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { createSnapshotReader } from "./usage.mjs";
import { startServer } from "./server.mjs";

const servers = new Map();
const emptyInput = { type: "object", properties: {}, additionalProperties: false };
let readSnapshot;

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "copilot-usage-monitor",
            displayName: "Copilot Usage Monitor",
            description: "Track AI credits used by each Copilot session, with live model and agent breakdowns.",
            inputSchema: emptyInput,
            actions: [
                {
                    name: "refresh",
                    description: "Read the runtime's accumulated AI credits for this session.",
                    inputSchema: emptyInput,
                    handler: async () => {
                        try {
                            return await readSnapshot();
                        } catch (error) {
                            throw new CanvasError("usage_unavailable", error.message);
                        }
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = startServer({
                        readSnapshot: () => readSnapshot(),
                        reportError: (error) => session.log(`Copilot Usage Monitor: ${error.message}`, { level: "error" }),
                    });
                    servers.set(ctx.instanceId, entry);
                    entry.catch(() => servers.delete(ctx.instanceId));
                }
                return { title: "Copilot Usage Monitor", url: (await entry).url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await (await entry).close();
                }
            },
        }),
    ],
});

readSnapshot = createSnapshotReader(session);
