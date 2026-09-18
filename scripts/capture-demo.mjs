import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { startDemo } from "./demo.mjs";

const browserPath = process.argv[2];
if (!browserPath) throw new Error("Usage: node scripts/capture-demo.mjs <Edge-or-Chromium-executable>");
const profile = await mkdtemp(join(tmpdir(), "session-aic-demo-"));
const panel = await startDemo();
let browser;
let socket;
try {
    browser = spawn(browserPath, [
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
        `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    const endpoint = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Browser did not expose its DevTools endpoint")), 20000);
        let output = "";
        browser.stderr.on("data", (data) => {
            output += data;
            const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
            if (match) { clearTimeout(timer); resolve(new URL(match[1]).origin.replace("ws:", "http:")); }
        });
        browser.once("error", (error) => { clearTimeout(timer); reject(error); });
        browser.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Browser exited: ${code}`)); });
    });
    const pages = await (await fetch(`${endpoint}/json/list`)).json();
    socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
    await once(socket, "open");
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
    await command("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
    await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await command("Page.navigate", { url: panel.url });
    const rendered = await command("Runtime.evaluate", {
        expression: `new Promise((resolve, reject) => {
            const deadline = Date.now() + 5000;
            const check = () => {
                if (document.getElementById("total")?.textContent === "12.75") {
                    const label = document.createElement("p");
                    label.textContent = "DEMO - synthetic data, not actual usage";
                    label.style.cssText = "color:#79c0ff;font-size:12px;margin-top:16px";
                    document.querySelector("header").after(label);
                    document.getElementById("identity").textContent = "This session - demo";
                    document.getElementById("status").textContent = "Demo snapshot - 12:10:00";
                    resolve(document.documentElement.scrollWidth <= 420);
                } else if (Date.now() > deadline) reject(new Error("Demo did not render"));
                else setTimeout(check, 50);
            };
            check();
        })`,
        awaitPromise: true,
        returnByValue: true,
    });
    assert.equal(rendered.result.value, true, "Demo must render without horizontal overflow");
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const directory = fileURLToPath(new URL("../docs/images/", import.meta.url));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "session-aic-demo.png"), Buffer.from(screenshot.data, "base64"));
    console.log("Captured docs/images/session-aic-demo.png using synthetic demo data.");
} finally {
    socket?.close();
    if (browser && browser.exitCode === null) {
        const exited = once(browser, "exit");
        browser.kill();
        await exited;
    }
    await panel.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
