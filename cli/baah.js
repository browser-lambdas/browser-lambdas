#!/usr/bin/env node

import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import toml from "toml";
import crypto from "crypto";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { initializeProject } from "./init.js";

const __filename = fileURLToPath(import.meta.url);
const SERVICE = "baah";
const LOOPBACK_HOST = "127.0.0.1";
const AUTH_PROTOCOL_VERSION = 1;
const MAX_AUTH_MESSAGE_BYTES = 64 * 1024;
const MAX_WEBSOCKET_MESSAGE_BYTES = 1024 * 1024;
const MAX_FAILED_AUTH_PER_MINUTE = 20;
const AEAD_ALGORITHM = "aes-256-gcm";
const AEAD_IV_BYTES = 12;
const PUSH_ACK_TIMEOUT_MS = 10000;
const MAX_TRIGGER_FILE_BYTES = 64 * 1024;
const MAX_CONFIG_PATTERN_LENGTH = 256;

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const color = (code, value) => (useColor ? `\x1b[${code}m${value}\x1b[0m` : value);
const chalk = {
  cyan: (value) => color(36, value),
  gray: (value) => color(90, value),
  green: (value) => color(32, value),
  red: (value) => color(31, value),
  yellow: (value) => color(33, value),
};

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function randomBase64Url(length = 32) {
  return base64Url(crypto.randomBytes(length));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hmac(secret, value) {
  return crypto
    .createHmac("sha256", secret)
    .update(canonical(value))
    .digest("base64url");
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(a || "");
  const bBuffer = Buffer.from(b || "");
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function hkdfKey(sharedSecret, extensionNonce, cliNonce, info) {
  return crypto.hkdfSync(
    "sha256",
    Buffer.from(sharedSecret),
    Buffer.from(`${extensionNonce}:${cliNonce}`),
    Buffer.from(info),
    32,
  );
}

function deriveSessionKeys(sharedSecret, extensionNonce, cliNonce) {
  return {
    cliToExtension: hkdfKey(
      sharedSecret,
      extensionNonce,
      cliNonce,
      "baah-sync-v1 cli-to-extension aes-256-gcm",
    ),
    extensionToCli: hkdfKey(
      sharedSecret,
      extensionNonce,
      cliNonce,
      "baah-sync-v1 extension-to-cli reserved",
    ),
  };
}

function encryptPayload(key, sequence, payload) {
  const iv = crypto.randomBytes(AEAD_IV_BYTES);
  const aad = Buffer.from(canonical({ type: "sync-message", sequence }));
  const cipher = crypto.createCipheriv(AEAD_ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    type: "sync-message",
    sequence,
    iv: base64Url(iv),
    ct: base64Url(ciphertext),
    tag: base64Url(cipher.getAuthTag()),
  };
}

function decryptPayload(key, expectedSequence, rawMessage) {
  const envelope = JSON.parse(rawMessage);
  if (envelope.type !== "sync-message" || envelope.sequence !== expectedSequence || !envelope.iv || !envelope.ct || !envelope.tag) {
    throw new Error("invalid encrypted acknowledgement");
  }
  const aad = Buffer.from(canonical({ type: "sync-message", sequence: envelope.sequence }));
  const decipher = crypto.createDecipheriv(AEAD_ALGORITHM, key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ct, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function createEncryptedSender(ws, sessionKeys) {
  let sequence = 1;
  return (payload) => {
    ws.send(JSON.stringify(encryptPayload(sessionKeys.cliToExtension, sequence, payload)));
    sequence += 1;
  };
}

function createEncryptedReceiver(sessionKeys) {
  let expectedSequence = 1;
  return (rawMessage) => {
    const payload = decryptPayload(sessionKeys.extensionToCli, expectedSequence, rawMessage.toString());
    expectedSequence += 1;
    return payload;
  };
}

export function isAllowedOrigin(origin) {
  return Boolean(origin && origin.startsWith("chrome-extension://"));
}

const failedAuthTimestamps = [];
function tooManyAuthFailures() {
  const cutoff = Date.now() - 60000;
  while (failedAuthTimestamps.length && failedAuthTimestamps[0] < cutoff) {
    failedAuthTimestamps.shift();
  }
  return failedAuthTimestamps.length >= MAX_FAILED_AUTH_PER_MINUTE;
}

function recordAuthFailure() {
  failedAuthTimestamps.push(Date.now());
}

function connectionFile() {
  const home = os.homedir();
  let base;
  if (process.platform === "win32") {
    base = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  } else if (process.platform === "darwin") {
    base = path.join(home, "Library", "Application Support");
  } else {
    base = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  }
  const dir = path.join(base, SERVICE);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "connections.json");
}

function readConnections() {
  const file = connectionFile();
  if (!fs.existsSync(file)) return {};
  let connections;
  try {
    connections = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    throw new Error(`Unable to read connection store: ${file}`);
  }
  if (!connections || typeof connections !== "object" || Array.isArray(connections)) {
    throw new Error(`Invalid connection store: ${file}`);
  }
  for (const connection of Object.values(connections)) {
    if (!connection || typeof connection.token !== "string" || !connection.token.trim() ||
        !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
      throw new Error(`Invalid connection store: ${file}`);
    }
  }
  return connections;
}

async function promptToken(label = "Token (hidden): ") {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("A terminal is required to enter a token. Use baah set <name> --token TOKEN for scripting.");
  }
  return new Promise((resolve, reject) => {
    // Readline handles editing and restores terminal mode; discard all echoed input.
    const output = new Writable({ write(chunk, encoding, callback) { callback(); } });
    const rl = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
    rl.once("SIGINT", () => rl.close());
    rl.once("close", () => {
      process.stdout.write("\n");
      reject(new Error("Token entry cancelled."));
    });
    process.stdout.write(label);
    rl.question("", (token) => {
      resolve(token);
      rl.close();
    });
  });
}

function askSetup(question) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once("SIGINT", () => rl.close());
    rl.once("close", () => reject(new Error("Setup cancelled.")));
    rl.question(question, (answer) => { resolve(answer.trim()); rl.close(); });
  });
}

async function askSetupYesNo(question) {
  while (true) {
    const answer = (await askSetup(`${question}\nChoose [Y/n]: `)).toLowerCase();
    if (["", "y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    console.log("Choose yes or no.");
  }
}

async function ensureConnection() {
  const connections = readConnections();
  const names = Object.keys(connections).sort();
  if (names.length) {
    console.log(`Saved browser connections: ${names.join(", ")}. Use baah push <name> to choose one.`);
    return names[0];
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("No browser connection saved. Run baah set <name> first, or use --skip-connection to scaffold offline.");
  }
  console.log("No browser connections yet");
  if (!await askSetupYesNo("Set up a new browser connection?\n- yes\n- no")) return null;
  let name;
  do {
    name = await askSetup("Name new connection (e.g. chrome, work): ");
    if (!name || /\s/.test(name) || name.startsWith("-")) console.log("Enter a name without spaces or a leading dash.");
  } while (!name || /\s/.test(name) || name.startsWith("-"));
  console.log("Open extension → Settings → Connection token → create a new token or reuse the existing one. Click to copy the token and paste it below (input is hidden).");
  let token;
  do {
    token = await promptToken("token: ");
    if (!token.trim()) console.log("Token must not be empty.");
  } while (!token.trim());
  let port = "4455";
  if (!await askSetupYesNo("Use default port for updates (4455)?\n- yes (recommended)\n- no")) {
    console.log("Use the WebSocket Port configured in extension Settings.");
    do {
      port = await askSetup("Port: ");
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) console.log("Port must be an integer between 1 and 65535.");
    } while (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535);
  }
  saveConnection(name, { token, port: Number(port) }, readConnections());
  return name;
}

function saveConnection(name, connection, connections) {
  const existed = Object.hasOwn(connections, name);
  Object.defineProperty(connections, name, { value: connection, enumerable: true, configurable: true, writable: true });
  fs.writeFileSync(connectionFile(), JSON.stringify(connections, null, 2), { encoding: "utf-8", mode: 0o600 });
  console.log(chalk.green(`✔ ${existed ? "Updated" : "Added"} connection '${name}'.`));
}

function deleteConnection(name) {
  const connections = readConnections();
  if (Object.hasOwn(connections, name)) {
    delete connections[name];
    fs.writeFileSync(connectionFile(), JSON.stringify(connections, null, 2), "utf-8");
    console.log(chalk.yellow(`Removed connection '${name}'.`));
  } else {
    console.log(chalk.yellow(`Connection '${name}' not found.`));
  }
}

function listConnections() {
  const connections = readConnections();
  const names = Object.keys(connections).sort();
  if (names.length === 0) {
    console.log(chalk.yellow("No baah connections configured."));
    console.log("Run baah set <name> to add one.");
    return;
  }
  for (const name of names) {
    console.log(` • ${chalk.green(name)}`);
  }
}

function showConnectionInfo(name) {
  const connections = readConnections();
  if (!Object.hasOwn(connections, name)) {
    throw new Error(`Connection '${name}' not found. Run baah set ${name} first.`);
  }
  console.log(`Push listener: ws://${LOOPBACK_HOST}:${connections[name].port}`);
}

function loadConfig() {
  const file = path.resolve("baah.toml");
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf-8");
  return toml.parse(raw);
}

function assertSafePattern(pattern) {
  if (typeof pattern !== "string" || !pattern) {
    throw new Error("file patterns must be non-empty strings");
  }
  if (pattern.length > MAX_CONFIG_PATTERN_LENGTH) {
    throw new Error(`file pattern is too long: ${pattern}`);
  }
  if (path.isAbsolute(pattern) || pattern.split(/[\\/]+/).includes("..")) {
    throw new Error(`file pattern must stay inside the project: ${pattern}`);
  }
  if (/[{}()[\]!+@]/.test(pattern)) {
    throw new Error(`unsupported advanced glob syntax in pattern: ${pattern}`);
  }
}

function patternToRegExp(pattern) {
  assertSafePattern(pattern);
  const normalized = pattern.replace(/\\/g, "/");
  let source = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      const after = normalized[i + 2];
      if (after === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
    }
  }
  source += "$";
  return new RegExp(source);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function walkFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, results);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

async function findFiles(include, exclude = []) {
  const includePatterns = toArray(include);
  const excludePatterns = toArray(exclude);
  const includeMatchers = includePatterns.map(patternToRegExp);
  const excludeMatchers = excludePatterns.map(patternToRegExp);
  const cwd = process.cwd();
  const files = walkFiles(cwd)
    .map((file) => ({
      absolute: path.resolve(file),
      relative: path.relative(cwd, file).replace(/\\/g, "/"),
    }))
    .filter(({ relative }) => includeMatchers.some((matcher) => matcher.test(relative)))
    .filter(({ relative }) => !excludeMatchers.some((matcher) => matcher.test(relative)))
    .map(({ absolute }) => absolute)
    .sort();
  return files;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  return body.split(",").map(parseScalar);
}

function parseTriggerContent(raw, file) {
  const data = {};
  let activeList = null;
  for (const [index, sourceLine] of raw.split(/\r?\n/).entries()) {
    const withoutComment = sourceLine
      .replace(/^\s*#.*$/, "")
      .replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) continue;
    const listMatch = withoutComment.match(/^\s*-\s*(.+)$/);
    if (listMatch) {
      if (!activeList) throw new Error(`unexpected list item on line ${index + 1}`);
      data[activeList].push(parseScalar(listMatch[1]));
      continue;
    }
    const keyMatch = withoutComment.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!keyMatch) throw new Error(`unsupported trigger syntax on line ${index + 1}`);
    const [, key, value] = keyMatch;
    if (!["name", "patterns", "commands"].includes(key)) {
      throw new Error(`unsupported trigger field '${key}' in ${path.basename(file)}`);
    }
    const inlineList = parseInlineList(value);
    if (inlineList) {
      data[key] = inlineList;
      activeList = null;
    } else if (value.trim() === "") {
      data[key] = [];
      activeList = key;
    } else {
      data[key] = parseScalar(value);
      activeList = null;
    }
  }
  return data;
}

async function loadFunctionFile(file) {
  const bundle = fs.readFileSync(file, "utf-8");
  const filename = path.basename(file);
  return { filename, bundle };
}

export async function loadAllFunctions(files) {
  console.log(chalk.cyan("▶ Loading functions..."));

  const results = [];
  const failedFiles = [];

  for (const file of files) {
    const name = path.basename(file);
    console.log(` • ${chalk.cyan(name)} ${chalk.gray("loading...")}`);

    try {
      const { filename, bundle } = await loadFunctionFile(file);
      const sizeKB = (bundle.length / 1024).toFixed(1);
      console.log(`   ${chalk.green(`loaded (${sizeKB} KB)`)}`);
      results.push({ filename, bundle });
    } catch (err) {
      const reason = err?.message ?? String(err);
      console.log(`   ${chalk.red("failed to load")}`);
      failedFiles.push({ file, reason });
    }
  }

  if (failedFiles.length) {
    console.error(chalk.red("\n❌ Some functions failed to load:"));
    for (const failure of failedFiles) {
      console.error(
        ` • ${chalk.cyan(path.basename(failure.file))} ${chalk.red(failure.reason)}`,
      );
    }
  }

  console.log(chalk.green("✔ Function loading complete"));
  return results;
}

export function loadTriggerFile(file) {
  try {
    const stats = fs.statSync(file);
    if (stats.size > MAX_TRIGGER_FILE_BYTES) {
      throw new Error(`trigger file exceeds ${MAX_TRIGGER_FILE_BYTES} bytes`);
    }
    const raw = fs.readFileSync(file, "utf-8");
    const data = parseTriggerContent(raw, file);
    const name = data.name || path.basename(file, path.extname(file));
    const rawPatterns = data.patterns;
    const patterns = Array.isArray(rawPatterns)
      ? rawPatterns
      : rawPatterns
        ? [rawPatterns]
        : [];
    const commands = Array.isArray(data.commands)
      ? data.commands
      : data.commands
        ? [data.commands]
        : [];
    if (typeof name !== "string") throw new Error("trigger name must be a string");
    if (!patterns.every((pattern) => typeof pattern === "string")) {
      throw new Error("trigger patterns must be strings");
    }
    if (!commands.every((command) => typeof command === "string")) {
      throw new Error("trigger commands must be strings");
    }
    return { name, patterns, commands };
  } catch (err) {
    console.error(`❌ Failed to parse trigger ${file}:`, err.message);
    return null;
  }
}

function loadAllTriggers(files) {
  const triggers = [];
  for (const file of files) {
    const t = loadTriggerFile(file);
    if (t) triggers.push(t);
  }
  if (triggers.length !== files.length) {
    throw new Error("Push aborted: some triggers failed to load or parse. Fix the errors and retry; no changes were sent.");
  }
  return triggers;
}

function sendBundles(send, bundles, project, batchId) {
  console.log("\n" + chalk.cyan(`▶ Pushing functions for project ${project}...`));
  for (const { filename, bundle } of bundles) {
    const name = path.basename(filename, path.extname(filename));
    send({ type: "lambda", batchId, project, filename: name, sourcePath: path.basename(filename), bundle });
    console.log(
      ` • ${chalk.cyan(name)} ${chalk.green(`sent (${(bundle.length / 1024).toFixed(1)} KB)`)}`,
    );
  }
  console.log("\n" + chalk.green("✔ Functions sent"));
}

function sendStyles(send, files, project, batchId) {
  console.log("\n" + chalk.cyan("▶ Pushing styles..."));
  for (const file of files) {
    const filename = path.basename(file);
    const content = fs.readFileSync(file, "utf-8");
    send({ type: "style", batchId, project, filename, content });
    console.log(
      ` • ${chalk.cyan(filename)} ${chalk.green(`sent (${(content.length / 1024).toFixed(1)} KB)`)}`,
    );
  }
  console.log(chalk.green("✔ Style push complete"));
}

function sendTriggers(send, triggers, project, batchId) {
  if (!triggers.length) return;
  console.log("\n" + chalk.cyan("▶ Pushing triggers..."));
  for (const t of triggers) {
    send({
      type: "trigger",
      batchId,
      project,
      name: t.name,
      patterns: t.patterns,
      commands: t.commands,
    });
    console.log(` • ${chalk.cyan(t.name)} ${chalk.green("sent")}`);
  }
  console.log(chalk.green("✔ Trigger push complete"));
}

function sendPushBatch(send, bundles, styleFiles, triggers, project) {
  const batchId = randomBase64Url(16);
  const counts = { lambdas: bundles.length, styles: styleFiles.length, triggers: triggers.length };
  const manifest = {
    lambdas: bundles.map(({ filename }) => path.basename(filename, path.extname(filename))),
    styles: styleFiles.map((file) => path.basename(file)),
    triggers: triggers.map((trigger) => trigger.name),
  };
  send({ type: "batch-start", batchId, project, createdAt: Date.now(), counts, manifest, mode: "push" });
  sendBundles(send, bundles, project, batchId);
  sendStyles(send, styleFiles, project, batchId);
  sendTriggers(send, triggers, project, batchId);
  send({ type: "batch-end", batchId, counts });
  return { batchId, counts };
}

async function startServerAndPush(bundles, styleFiles, triggers, token, port, project) {
  console.log("\n" + chalk.cyan("▶ Connecting to client..."));

  const sharedSecret = token;
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      host: LOOPBACK_HOST,
      port,
      maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    let settled = false;
    let ackTimeout = null;
    console.log(chalk.gray(`waiting for client on ws://${LOOPBACK_HOST}:${port}`));
    const shutdown = (error = null) => {
      if (settled) return;
      settled = true;
      if (ackTimeout) clearTimeout(ackTimeout);
      server.close(() => {
        if (error) reject(error);
        else resolve();
      });
    };

    server.on("error", (err) => {
      console.error(chalk.red(`failed to listen on ws://${LOOPBACK_HOST}:${port}`));
      shutdown(err);
    });

    server.on("connection", (ws, req) => {
      if (!isAllowedOrigin(req.headers.origin) || tooManyAuthFailures()) {
        recordAuthFailure();
        ws.close();
        return;
      }
      let authenticated = false;
      let challenge = null;
      let receiveAck = null;
      let ackBatchId = null;
      const timeout = setTimeout(() => {
        if (!authenticated) {
          recordAuthFailure();
          console.error(chalk.red("client failed to authenticate in time"));
          ws.close();
          shutdown(new Error("client failed to authenticate in time"));
        }
      }, 2000);

      ws.on("message", (data) => {
        try {
          if (authenticated) {
            const ack = receiveAck(data);
            if (ack.batchId !== ackBatchId) throw new Error("acknowledgement batch ID did not match push batch");
            clearTimeout(ackTimeout);
            if (ack.type === "batch-rejected") {
              console.error(chalk.red(`❌ Extension rejected batch ${ack.batchId}`));
              if (ack.reason) console.error(chalk.red(`Reason: ${ack.reason}`));
              if (ack.debug) console.error(chalk.gray(`Debug: ${JSON.stringify(ack.debug)}`));
              process.exitCode = 1;
              ws.close();
              shutdown();
              return;
            }
            if (ack.type !== "batch-received" && ack.type !== "batch-applied") throw new Error("unexpected acknowledgement type");
            const status = ack.type === "batch-applied" ? "applied" : (ack.status ?? "received");
            console.log(chalk.green(`✔ Extension ${status} batch ${ack.batchId}`));
            if (ack.counts) console.log(chalk.gray(`  ${ack.counts.lambdas ?? 0} functions, ${ack.counts.styles ?? 0} styles, ${ack.counts.triggers ?? 0} triggers`));
            console.log("\n" + chalk.green("✔ Push complete"));
            ws.close(1000, "push acknowledged");
            shutdown();
            return;
          }

          if (data.length > MAX_AUTH_MESSAGE_BYTES) {
            recordAuthFailure();
            ws.close();
            shutdown(new Error("auth message too large"));
            return;
          }
          const msg = JSON.parse(data.toString());
          if (!challenge) {
            if (msg.type !== "auth-hello" || msg.version !== AUTH_PROTOCOL_VERSION || !msg.extensionNonce || Math.abs(Date.now() - msg.timestamp) > 30000) {
              recordAuthFailure();
              console.error(chalk.red("unauthorized client tried to connect"));
              ws.close();
              shutdown(new Error("unauthorized client tried to connect"));
              return;
            }
            challenge = { extensionNonce: msg.extensionNonce, cliNonce: randomBase64Url(), keyId: msg.keyId || "default", timestamp: Date.now() };
            const challengeFields = { type: "auth-challenge", version: AUTH_PROTOCOL_VERSION, keyId: challenge.keyId, extensionNonce: challenge.extensionNonce, cliNonce: challenge.cliNonce, timestamp: challenge.timestamp };
            ws.send(JSON.stringify({ ...challengeFields, mac: hmac(sharedSecret, challengeFields) }));
            return;
          }

          const challengeMac = hmac(sharedSecret, { type: "auth-challenge", version: AUTH_PROTOCOL_VERSION, keyId: challenge.keyId, extensionNonce: challenge.extensionNonce, cliNonce: challenge.cliNonce, timestamp: challenge.timestamp });
          const expectedResponse = hmac(sharedSecret, { type: "auth-response", version: AUTH_PROTOCOL_VERSION, keyId: challenge.keyId, extensionNonce: challenge.extensionNonce, cliNonce: challenge.cliNonce, challengeMac });
          if (msg.type !== "auth-response" || msg.version !== AUTH_PROTOCOL_VERSION || !safeEqual(msg.mac, expectedResponse)) {
            recordAuthFailure();
            console.error(chalk.red("unauthorized client tried to connect"));
            ws.close();
            shutdown(new Error("unauthorized client tried to connect"));
            return;
          }

          authenticated = true;
          clearTimeout(timeout);
          console.log(chalk.green("✔ Client authenticated on ws://" + LOOPBACK_HOST + ":" + port));
          const sessionKeys = deriveSessionKeys(sharedSecret, challenge.extensionNonce, challenge.cliNonce);
          const send = createEncryptedSender(ws, sessionKeys);
          receiveAck = createEncryptedReceiver(sessionKeys);
          const { batchId } = sendPushBatch(send, bundles, styleFiles, triggers, project);
          ackBatchId = batchId;
          ackTimeout = setTimeout(() => {
            ws.close();
            shutdown(new Error("timed out waiting for extension acknowledgement"));
          }, PUSH_ACK_TIMEOUT_MS);
        } catch (err) {
          recordAuthFailure();
          if (authenticated) console.error(chalk.red(`❌ ${err.message}`));
          else console.error(chalk.red("malformed auth message"));
          ws.close();
          shutdown(err);
        }
      });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "init") {
    await initializeProject(args.slice(1), ensureConnection);
    return;
  }

  if (args[0] === "ls") {
    if (args.length !== 1) throw new Error("Usage: baah ls");
    listConnections();
    return;
  }

  if (args[0] === "info") {
    const name = args[1];
    if (!name || name.startsWith("-") || args.length !== 2) {
      throw new Error("Usage: baah info <name>");
    }
    showConnectionInfo(name);
    return;
  }

  if (args[0] === "set") {
    const name = args[1];
    const usage = "Usage: baah set <name> [--token TOKEN] [--port PORT]";
    if (!name || name.startsWith("-")) throw new Error(usage);
    const options = new Map();
    for (let i = 2; i < args.length; i += 2) {
      if (!["--token", "--port"].includes(args[i]) || args[i + 1] === undefined || options.has(args[i])) {
        throw new Error(usage);
      }
      options.set(args[i], args[i + 1]);
    }
    const portValue = options.get("--port");
    if (portValue !== undefined && (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535)) {
      throw new Error("Port must be an integer between 1 and 65535.");
    }
    const connections = readConnections();
    const existing = Object.hasOwn(connections, name) ? connections[name] : undefined;
    const token = options.get("--token") ?? (portValue !== undefined && existing ? existing.token : await promptToken());
    if (!token.trim()) throw new Error("Token must not be empty.");
    const port = portValue === undefined ? (existing?.port ?? 4455) : Number(portValue);
    saveConnection(name, { token, port }, connections);
    return;
  }

  if (args[0] === "rm") {
    const name = args[1];
    if (!name || name.startsWith("-") || args.length !== 2) {
      throw new Error("Usage: baah rm <name>");
    }
    deleteConnection(name);
    return;
  }

  if (args[0] === "push") {
    if (args.length !== 2 || !args[1] || args[1].startsWith("-")) throw new Error("Usage: baah push <name>");
    const name = args[1];
    const connections = readConnections();
    if (!Object.hasOwn(connections, name)) {
      throw new Error(`Connection '${name}' not found. Run baah set ${name} first.`);
    }
    const { token, port } = connections[name];
    const config = loadConfig();

    const project = config.project?.name || path.basename(process.cwd());
    const funcInclude = config.functions?.include || ["functions/**/*.js"];
    const funcExclude = config.functions?.exclude || [];
    const styleInclude = config.styles?.include || ["styles/**/*.css"];
    const styleExclude = config.styles?.exclude || [];
    const triggerInclude = config.triggers?.include || ["triggers/**/*.yaml"];
    const triggerExclude = config.triggers?.exclude || [];

    const functionFiles = await findFiles(funcInclude, funcExclude);
    const styleFiles = await findFiles(styleInclude, styleExclude);
    const triggerFiles = await findFiles(triggerInclude, triggerExclude);

    if (
      functionFiles.length === 0 &&
      styleFiles.length === 0 &&
      triggerFiles.length === 0
    ) {
      console.log(chalk.yellow("No functions, styles, or triggers found."));
      return;
    }

    const bundles = await loadAllFunctions(functionFiles);
    const triggers = loadAllTriggers(triggerFiles);
    await startServerAndPush(bundles, styleFiles, triggers, token, port, project);
    return;
  }

  const usage = `Usage:
  baah init [path]                 Set up a project and browser connection
    [--template minimal|starter] [--skills|--no-skills] [--skip-connection]
  baah set <name> [--token TOKEN] [--port PORT]
                                   Save a named connection to your browser extension
  baah ls                          List saved connections
  baah info <name>                 Show saved connection details
  baah rm <name>                   Remove a saved connection
  baah push <name>                 Push using a saved connection`;
  if (args.length === 0 || (args.length === 1 && ["--help", "-h"].includes(args[0]))) {
    console.log(usage);
    return;
  }
  console.error(usage);
  process.exit(1);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(chalk.red(err?.message ?? String(err)));
    process.exit(1);
  });
}
