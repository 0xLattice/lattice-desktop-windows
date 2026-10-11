// The installed app, launched for real on Windows with WSL: the app opens,
// its page reaches the shell, and the shell copies the Linux node binaries
// into the WSL distribution, runs the CLI there and starts the node, which
// answers on Windows' own loopback. It cannot see or click the window.
//
//   $env:LATTICE_APP = "<the installed app's .exe>"
//   $env:LATTICE_LINUX_BIN = "build\linux"
//   node --test test/installed-app.test.mjs
//
// It uses the default distribution's real ~/.local/share/Lattice, so it is
// for a CI runner or a machine with no Lattice data to lose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const app = process.env.LATTICE_APP;
const linuxBin = process.env.LATTICE_LINUX_BIN;
const BINARIES = ["lattice", "lattice-node", "lattice-mining-coordinator", "lattice-miner"];

const run = promisify(execFile);
const wsl = async (...args) => (await run("wsl.exe", args, { windowsHide: true })).stdout;

const freePort = () => new Promise((done, fail) => {
  const server = createServer();
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => done(port));
  });
});

async function until(check, what, within) {
  const deadline = Date.now() + within;
  for (;;) {
    const value = await check().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((wake) => setTimeout(wake, 500));
  }
}

test("the installed app starts its own node in WSL", { skip: !app || !linuxBin, timeout: 420_000 }, async () => {
  assert.ok(existsSync(app), "the app's executable is there");
  const distro = (await wsl("-e", "printenv", "WSL_DISTRO_NAME")).trim();
  const home = (await wsl("-e", "printenv", "HOME")).trim();
  assert.ok(distro && home.startsWith("/"), "WSL has a default distribution");
  // A Linux path inside the distribution, as Windows reaches it.
  const share = (linux) => `\\\\wsl$\\${distro}${linux.replaceAll("/", "\\")}`;
  const commit = readFileSync(join(resolve(linuxBin), "COMMIT"), "utf8").trim();
  const data = `${home}/.local/share/Lattice`;
  const root = `${data}/host`;
  assert.equal(existsSync(share(root)), false, "no host root yet: this is a first run");

  // A host root the app will find: a private node (no peers) on free ports, so
  // the test joins no network. The CLI that scaffolds it is this test's own
  // copy; the app has not installed its own yet.
  const staged = "/tmp/lattice-test-bin";
  mkdirSync(share(staged), { recursive: true });
  for (const name of BINARIES) copyFileSync(join(resolve(linuxBin), name), join(share(staged), name));
  await wsl("-e", "chmod", "755", ...BINARIES.map((name) => `${staged}/${name}`));
  await wsl("-e", `${staged}/lattice`, "init", "--root", root);
  const topologyFile = join(share(root), "lattice.json");
  const rpc = await freePort();
  writeFileSync(topologyFile, JSON.stringify({ ...JSON.parse(readFileSync(topologyFile, "utf8")), rpc, listen: await freePort(), peers: [] }, null, 2));

  const installed = `${data}/bin/${commit}`;
  const child = spawn(app, [], { stdio: "ignore" });
  const exited = new Promise((done) => child.once("exit", () => done()));
  try {
    // Nothing but the page starts the node: its answering on Windows' loopback
    // means the page ran, reached the shell, and the shell ran the CLI in WSL.
    await until(async () => ((await fetch(`http://127.0.0.1:${rpc}/health`)).ok ? true : undefined), "the app to start its node", 300_000);
    assert.equal(child.exitCode, null, "the app is still running");
    assert.ok(existsSync(join(share(installed), "COMMIT")), "the app installed its node binaries in WSL");
    assert.ok(existsSync(join(share(root), "chains", "Nexus", ".cookie")), "the node the app started wrote its cookie");
    assert.match(await wsl("-e", `${installed}/lattice`, "status", "--root", root), /^Nexus: active/m);
    assert.equal(existsSync(join(share(root), "log", "mine.log")), false, "opening the app starts no miner");
  } finally {
    // Killing the app does not run its exit handler, so stop its node as the handler would.
    await wsl("-e", `${staged}/lattice`, "down", "--root", root).catch(() => {});
    child.kill();
    await exited;
  }
});
