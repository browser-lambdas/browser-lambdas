import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const usage = "Usage: baah init [path] [--template minimal|starter] [--skills|--no-skills] [--skip-connection]";

export async function initializeProject(args, ensureConnection) {
  let destination;
  let template;
  let skills;
  let skipConnection = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--template" && template === undefined) {
      template = args[++i];
      if (!["minimal", "starter"].includes(template)) throw new Error(usage);
    } else if (["--skills", "--no-skills"].includes(arg) && skills === undefined) {
      skills = arg === "--skills";
    } else if (arg === "--skip-connection" && !skipConnection) {
      skipConnection = true;
    } else if (!arg.startsWith("-") && destination === undefined) {
      destination = arg;
    } else throw new Error(usage);
  }
  const root = path.resolve(destination || ".");
  if (template === undefined || skills === undefined) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("Interactive setup requires a terminal. Specify --template minimal|starter and --skills or --no-skills for scripting.");
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const controller = new AbortController();
    const question = (text) => rl.question(text, { signal: controller.signal });
    let cancelled = false;
    rl.on("close", () => { cancelled = true; controller.abort(); });
    rl.on("SIGINT", () => rl.close());
    try {
      if (template === undefined) {
        console.log("Choose a template:\n  1. Minimal — baah.toml only\n  2. Starter — baah.toml, functions/hello-world.js");
        while (template === undefined) {
          const answer = (await question("Template [1]: ")).trim().toLowerCase();
          if (["", "1", "minimal"].includes(answer)) template = "minimal";
          else if (["2", "starter"].includes(answer)) template = "starter";
          else console.log("Choose 1 (minimal) or 2 (starter).");
        }
      }
      while (skills === undefined) {
        const answer = (await question("Include agent skills in .agents/skills/? [y/N]: ")).trim().toLowerCase();
        if (["", "n", "no"].includes(answer)) skills = false;
        else if (["y", "yes"].includes(answer)) skills = true;
        else console.log("Choose yes or no.");
      }
      if (cancelled) throw new Error("Setup cancelled.");
    } catch (error) {
      if (cancelled) throw new Error("Setup cancelled.");
      throw error;
    } finally {
      rl.close();
    }
  }

  const connection = skipConnection ? null : await ensureConnection();
  const starter = template === "starter";
  const config = `# baah.toml\n\n[project]\nname = ${JSON.stringify(path.basename(root) || "my-project")}\n` + (starter ? `\n[functions]\ninclude = ["functions/**/*.js"]\nexclude = ["functions/**/*.test.js", "functions/**/__*__/*"]\n` : "");
  const files = [["baah.toml", config]];
  if (starter) files.push(["functions/hello-world.js", 'console.log("Hello from Browser Lambdas!");\n']);
  if (skills) files.push([".agents/skills/browser-lambdas/SKILL.md", fs.readFileSync(new URL("./templates/browser-lambdas/SKILL.md", import.meta.url), "utf8")]);
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, content] of files) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
      console.log(`✔ Created ${relative}`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      console.log(`⚠ ${relative} already exists, skipping.`);
    }
  }
  console.log(`✔ Project initialized at ${root}\n\nNext:`);
  if (root !== process.cwd()) console.log(`  cd '${root.replace(/'/g, "'\\''")}'`);
  if (!starter) console.log("  Add your lambdas under functions/.");
  if (!connection) console.log("  baah set chrome");
  console.log(`  baah push ${connection || "chrome"}`);
}
