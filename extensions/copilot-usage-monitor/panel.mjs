const byId = (id) => document.getElementById(id);
const creditFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const countFormat = new Intl.NumberFormat();
let pending = false;
let timer;
let lastRead;
let previousModels;
let previousAgents;

function formatCredits(value) {
    if (value === null) return "Unavailable";
    if (value > 0 && value < 0.0001) return "<0.0001";
    return creditFormat.format(value);
}

function dateLabel(value) {
    return value ? new Date(value).toLocaleString() : "Unavailable";
}

function cell(text, className = "") {
    const node = document.createElement("td");
    node.textContent = text;
    node.className = className;
    return node;
}

function render(snapshot) {
    byId("total").textContent = formatCredits(snapshot.aiCredits);
    byId("total").title = snapshot.totalNanoAiu === null ? "Billing data not reported" : `${snapshot.totalNanoAiu} nano-AIU`;
    byId("identity").textContent = `This session \u00b7 ${snapshot.sessionId.slice(0, 8)}`;
    byId("session-id").textContent = snapshot.sessionId;
    byId("started").textContent = dateLabel(snapshot.sessionStartTime);
    byId("current-model").textContent = snapshot.currentModel ?? "Unavailable";
    byId("availability").textContent = snapshot.aiCredits === null
        ? "This runtime has not reported an AIC total. It may use a different billing mode."
        : "Accumulated usage reported for this session.";
    byId("empty").hidden = snapshot.models.length > 0;
    byId("models-table").hidden = snapshot.models.length === 0;
    const modelsKey = JSON.stringify(snapshot.models);
    if (modelsKey !== previousModels) {
        byId("models").replaceChildren(...snapshot.models.map((model) => {
            const row = document.createElement("tr");
            row.append(
                cell(model.name),
                cell(model.requests === null ? "--" : countFormat.format(model.requests), "number"),
                cell(formatCredits(model.aiCredits), "number"),
            );
            return row;
        }));
        previousModels = modelsKey;
    }
    byId("agents-section").hidden = snapshot.agents.length < 2;
    const agentsKey = JSON.stringify(snapshot.agents);
    if (agentsKey !== previousAgents) {
        byId("agents").replaceChildren(...snapshot.agents.map((agent) => {
            const row = document.createElement("div");
            row.className = "agent-row";
            const name = document.createElement("dt");
            name.textContent = agent.name;
            const amount = document.createElement("dd");
            amount.textContent = `${formatCredits(agent.aiCredits)} AIC`;
            row.append(name, amount);
            return row;
        }));
        previousAgents = agentsKey;
    }
}

async function refresh(manual = false) {
    clearTimeout(timer);
    if (pending) return;
    pending = true;
    byId("refresh").disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch("api/usage", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Usage request failed (${response.status}).`);
        render(data);
        lastRead = data.observedAt;
        byId("error").hidden = true;
        byId("status").textContent = `Updated ${new Date(lastRead).toLocaleTimeString()}`;
        if (manual) byId("refresh").textContent = "Refreshed";
    } catch (error) {
        byId("error").textContent = `Usage could not be refreshed. ${error.name === "AbortError" ? "The runtime did not respond in time." : error.message} Use Refresh to retry.`;
        byId("error").hidden = false;
        byId("status").textContent = lastRead
            ? `Not live. Last updated ${dateLabel(lastRead)}.`
            : "Usage unavailable. Retrying while this panel is visible.";
    } finally {
        clearTimeout(timeout);
        pending = false;
        byId("refresh").disabled = false;
        if (!document.hidden) timer = setTimeout(() => {
            byId("refresh").textContent = "Refresh";
            void refresh();
        }, 3000);
    }
}

byId("refresh").addEventListener("click", () => void refresh(true));
document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden) void refresh();
});
window.addEventListener("pagehide", () => clearTimeout(timer));
void refresh();
