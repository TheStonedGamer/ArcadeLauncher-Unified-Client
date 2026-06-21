#!/usr/bin/env node
// In-repo agent memory tool. Maintains AGENT_MEMORY.md — a shared, durable
// scratchpad any AI agent (or human) working on this repo can read and update.
// It mirrors the personal Claude memory system: one fact per entry with a slug,
// title, type, and one-line description, plus an auto-maintained Index at the
// top so an agent can skim what's known before diving in.
//
// Usage:
//   node scripts/memory.mjs list
//   node scripts/memory.mjs get <id>
//   node scripts/memory.mjs set --id <slug> --title "..." [--type project] \
//        [--desc "one-liner"] [--body "the fact"]   (body also accepted on stdin)
//   node scripts/memory.mjs rm <id>
//
// Types mirror the personal system: project | feedback | reference | user.
// `set` upserts: re-running with an existing id replaces that entry in place and
// refreshes its "updated" date. Entries are delimited by HTML comment markers so
// the body can contain any Markdown without breaking the parser.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// In-project agent memory lives under memory/ (gitignored — local-only, not
// committed). mkdirSync ensures the folder exists before the first write.
const MEM_DIR = join(ROOT, "memory");
const FILE = join(MEM_DIR, "AGENT_MEMORY.md");
const TYPES = ["project", "feedback", "reference", "user"];

const HEADER = `# Agent Memory

> Shared, durable memory for AI agents working on this repository. Read this
> before starting work; record non-obvious, lasting facts here as you learn them.
> **Do not edit entries by hand** — use the tool so the Index stays in sync:
> \`node scripts/memory.mjs set --id <slug> --title "..." --type project --desc "..." --body "..."\`
> (\`npm run memory -- ...\`). See \`node scripts/memory.mjs --help\`.

`;

const today = () => new Date().toISOString().slice(0, 10);

/** Parse AGENT_MEMORY.md into an ordered list of entry objects. */
function parse() {
  if (!existsSync(FILE)) return [];
  const text = readFileSync(FILE, "utf8");
  const entries = [];
  const re = /<!-- am:start id=([a-z0-9-]+) type=(\S+) -->\n([\s\S]*?)\n<!-- am:end -->/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, id, type, block] = m;
    const lines = block.split("\n");
    // Line 0: "### Title", line 1: "_Updated DATE_", line 2: "> desc", rest: body.
    const title = (lines[0] || "").replace(/^###\s*/, "").trim();
    const updated = ((lines[1] || "").match(/_Updated (.+)_/) || [])[1] || today();
    const desc = (lines[2] || "").replace(/^>\s*/, "").trim();
    const body = lines.slice(4).join("\n").trim();
    entries.push({ id, type, title, updated, desc, body });
  }
  return entries;
}

/** Render an entry to its Markdown block. */
function renderEntry(e) {
  return [
    `<!-- am:start id=${e.id} type=${e.type} -->`,
    `### ${e.title}`,
    `_Updated ${e.updated}_`,
    `> ${e.desc || ""}`,
    ``,
    e.body || "",
    `<!-- am:end -->`,
  ].join("\n");
}

/** Write the whole file: header, index, then entries (stable by id). */
function write(entries) {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const index = sorted.length
    ? "## Index\n\n" +
      sorted.map((e) => `- [${e.title}](#${e.id}) — _${e.type}_ — ${e.desc}`).join("\n") +
      "\n"
    : "## Index\n\n_(empty — add the first fact with `node scripts/memory.mjs set`)_\n";
  const body = sorted.map(renderEntry).join("\n\n");
  mkdirSync(MEM_DIR, { recursive: true });
  writeFileSync(FILE, `${HEADER}${index}\n---\n\n${body}${body ? "\n" : ""}`, "utf8");
}

/** Minimal --flag parser. */
function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

function help() {
  console.log(
    [
      "Agent memory tool — maintains AGENT_MEMORY.md",
      "",
      "  list                 List every entry (id, type, title).",
      "  get <id>             Print one entry's full body.",
      "  set --id <slug> --title <t> [--type project] [--desc <d>] [--body <b>]",
      "                       Add or replace an entry. Body may be piped on stdin.",
      "  rm <id>              Delete an entry.",
      "",
      `  types: ${TYPES.join(" | ")}`,
    ].join("\n"),
  );
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  let entries = parse();

  switch (cmd) {
    case "list": {
      if (!entries.length) return console.log("(no entries yet)");
      for (const e of entries.sort((a, b) => a.id.localeCompare(b.id))) {
        console.log(`${e.id.padEnd(28)} [${e.type}] ${e.title}`);
      }
      return;
    }
    case "get": {
      const id = rest[0];
      const e = entries.find((x) => x.id === id);
      if (!e) {
        console.error(`no entry: ${id}`);
        process.exit(1);
      }
      console.log(`# ${e.title} (${e.type}) — updated ${e.updated}\n> ${e.desc}\n\n${e.body}`);
      return;
    }
    case "set": {
      const f = flags(rest);
      const id = f.id;
      if (!id || !/^[a-z0-9-]+$/.test(id)) {
        console.error("set requires --id <kebab-slug>");
        process.exit(1);
      }
      const type = f.type && TYPES.includes(f.type) ? f.type : "project";
      const body = f.body && f.body !== "true" ? f.body : readStdin();
      const existing = entries.find((x) => x.id === id);
      const entry = {
        id,
        type,
        title: f.title && f.title !== "true" ? f.title : existing?.title || id,
        desc: f.desc && f.desc !== "true" ? f.desc : existing?.desc || "",
        body: body || existing?.body || "",
        updated: today(),
      };
      entries = entries.filter((x) => x.id !== id);
      entries.push(entry);
      write(entries);
      console.log(`${existing ? "updated" : "added"}: ${id}`);
      return;
    }
    case "rm": {
      const id = rest[0];
      const before = entries.length;
      entries = entries.filter((x) => x.id !== id);
      if (entries.length === before) {
        console.error(`no entry: ${id}`);
        process.exit(1);
      }
      write(entries);
      console.log(`removed: ${id}`);
      return;
    }
    default:
      help();
  }
}

main();
