import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function startServer({ readSnapshot, reportError }) {
    const assets = new Map(await Promise.all([
        ["", "panel.html", "text/html; charset=utf-8"],
        ["panel.css", "panel.css", "text/css; charset=utf-8"],
        ["panel.mjs", "panel.mjs", "text/javascript; charset=utf-8"],
    ].map(async ([route, file, type]) => [route, { type, body: await readFile(new URL(file, import.meta.url)) }])));
    const secret = randomBytes(24).toString("hex");
    const prefix = `/${secret}/`;
    let origin;
    let lastError;

    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
        if (req.headers.host !== new URL(origin).host
            || (req.headers.origin && req.headers.origin !== origin)) {
            res.writeHead(403).end("Forbidden");
            return;
        }
        if (req.method !== "GET") {
            res.writeHead(405, { Allow: "GET" }).end("Method not allowed");
            return;
        }
        if (!req.url?.startsWith(prefix)) {
            res.writeHead(404).end("Not found");
            return;
        }
        const route = req.url.slice(prefix.length);
        if (route === "api/usage") {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            try {
                const snapshot = await readSnapshot();
                lastError = undefined;
                res.end(JSON.stringify(snapshot));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (lastError !== message) {
                    lastError = message;
                    try {
                        await reportError(new Error(message));
                    } catch (logError) {
                        console.error("Session AIC could not log the usage failure:", logError);
                    }
                }
                res.writeHead(503).end(JSON.stringify({ error: message }));
            }
            return;
        }
        const asset = assets.get(route);
        if (!asset) {
            res.writeHead(404).end("Not found");
            return;
        }
        res.writeHead(200, { "Content-Type": asset.type }).end(asset.body);
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    return {
        url: `${origin}${prefix}`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeAllConnections();
        }),
    };
}
