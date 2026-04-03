import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const runHeavy = process.env["RUN_CHAT_UI_BUILD_ORIGIN_CHECK"] === "1";

function chatUiRoot(): string {
  return path.resolve(import.meta.dirname, "..", "..");
}

describe.skipIf(!runHeavy)("chat-ui production build + API origin (heavy)", () => {
  const fixtureOrigin = "https://fixture-api.example.test";

  it(
    "inlines VITE_API_ORIGIN into JS and Vercel builds fail without it (sequential)",
    () => {
    const cwd = chatUiRoot();

    execFileSync("npm", ["run", "build"], {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_API_ORIGIN: fixtureOrigin,
      },
    });

    const assetsDir = path.join(cwd, "dist", "public", "assets");
    const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
    expect(jsFiles.length).toBeGreaterThan(0);
    const combined = jsFiles
      .map((f) => readFileSync(path.join(assetsDir, f), "utf8"))
      .join("\n");
    expect(combined).toContain(fixtureOrigin);

    const env = { ...process.env } as NodeJS.ProcessEnv;
    env["VERCEL"] = "1";
    delete env["VITE_API_ORIGIN"];
    delete env["VITE_ALLOW_SAME_ORIGIN_API"];

    const r = spawnSync("npm", ["run", "build"], {
      cwd,
      encoding: "utf8",
      env,
    });

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/VITE_API_ORIGIN/);
    },
    120_000,
  );
});
