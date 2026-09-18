import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const directory of ["extensions", "scripts", "tests"]) {
    for (const file of await readdir(join(root, directory), { recursive: true })) {
        if (!file.endsWith(".mjs")) continue;
        const result = spawnSync(process.execPath, ["--check", join(root, directory, file)], { stdio: "inherit" });
        if (result.error) throw result.error;
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
}
console.log("All JavaScript modules passed syntax checks.");
