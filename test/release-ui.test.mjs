// Native release checks on throwaway CI data only. A synthetic clock gap
// exercises the lock timer; this is not a physical sleep/resume test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createServer } from 'node:net';
import { Session } from '../vendor/lattice-desktop/test/ui/webdriver.mjs';
const run = promisify(execFile);
const APP = process.env.LATTICE_UI_APP;
const WIN = process.platform === 'win32';
const PASSWORD = 'release fixture password';
const DRIVER = 'http://127.0.0.1:4444';
const freePort = () => new Promise((done, fail) => {
  const s = createServer(); s.once('error', fail);
  s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => done(port)); });
});
async function until(probe, label, timeout = 120000) {
  const end = Date.now() + timeout; let error;
  while (Date.now() < end) {
    try { const value = await probe(); if (value) return value; } catch (e) { error = e; }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out: ${label}${error ? ` (${error.message})` : ''}`);
}
test('release UI: chain management, settings, Activity, and inert lock keyboard behavior', {skip: !APP, timeout: 900000}, async () => {
  if (WIN) assert.equal(process.env.CI, 'true', 'Windows host reset is restricted to disposable CI');
  const home = WIN ? null : mkdtempSync(join(tmpdir(), 'lattice-release-ui-'));
  const bin = resolve(process.env.LATTICE_APP_BINARIES ?? dirname(resolve(APP)));
  const hostRoot = home ? join(home, '.local/share/Lattice/host') : null;
  const topologyFile = hostRoot ? join(hostRoot, 'lattice.json') : process.env.LATTICE_UI_TOPOLOGY_FILE;
  assert.ok(topologyFile, 'a disposable topology file is required');
  if (home) {
    await run(join(bin, 'lattice'), ['init', '--root', hostRoot]);
    const config = JSON.parse(readFileSync(topologyFile, 'utf8'));
    writeFileSync(topologyFile, JSON.stringify({...config, rpc: await freePort(), listen: await freePort(), peers: []}));
  }
  const original = readFileSync(topologyFile, 'utf8');
  assert.deepEqual(JSON.parse(original).peers, [], 'fixture starts with no peers');
  const driver = spawn('tauri-driver', process.env.LATTICE_UI_NATIVE_DRIVER ? ['--native-driver', process.env.LATTICE_UI_NATIVE_DRIVER] : [], {
    stdio: 'inherit', env: {...process.env, ...(home ? {HOME: home, XDG_DATA_HOME: '', XDG_CONFIG_HOME: '', XDG_CACHE_HOME: ''} : {})},
  });
  let session;
  try {
    await until(async () => (await fetch(`${DRIVER}/status`)).ok, 'driver starts', 30000);
    session = await Session.start(DRIVER, resolve(APP));
    const text = () => session.run("return document.body.textContent.replace(/\\s+/g,' ').trim()");
    const shows = (pattern) => until(async () => pattern.test(await text()), `page ${pattern}`);
    const field = selector => until(() => session.run('return document.querySelector(arguments[0])', selector), selector);
    const press = async label => session.click(await until(() => session.run("return [...document.querySelectorAll('button')].find(b => !b.disabled && b.getClientRects().length && !b.closest('[inert]') && (b.textContent === arguments[0] || b.getAttribute('aria-label') === arguments[0] || b.getAttribute('data-row') === arguments[0])) || null", label), `button ${label}`));
    const type = async (selector, value) => session.type(await field(selector), value);
    const value = selector => session.run('return document.querySelector(arguments[0])?.value', selector);
    const choose = (selector, value) => session.run("const e=document.querySelector(arguments[0]); e.value=arguments[1]; e.dispatchEvent(new Event('change',{bubbles:true})); return true", selector, value);
    const config = () => JSON.parse(readFileSync(topologyFile, 'utf8'));
    await press('Create wallet');
    await type('input[placeholder="password (min 8)"]', PASSWORD);
    await type('input[placeholder="confirm password"]', PASSWORD);
    await press('Continue');
    await press('I saved it — create'); // Never print or save the fixture recovery phrase.
    await shows(/Balance on Nexus/);
    await until(async () => (await session.run("return document.querySelector('.balance-value .v')?.textContent")) === '0', 'isolated node balance');

    await press('Activity'); await shows(/Transactions/);
    await press('Transactions'); await shows(/Transactions/); await press('Back'); await press('Back');
    await session.click(await field('#settings-button'));
    await shows(/Default fee/);
    assert.equal(await session.run("return !!document.querySelector('#settings-screen [data-row=\"Activity\"]')"), false);
    await press('Your node'); await shows(/Your nodeRunning/);
    await session.click(await field('button[data-chain="Nexus"]'));
    await field('select[aria-label="Peers of Nexus"]');
    assert.equal(await value('select[aria-label="Peers of Nexus"]'), 'none');
    await type('input[aria-label="Name of a chain under Nexus"]', 'releasecheck');
    await press('Add');
    await until(() => config().hostedChains?.includes('Nexus/releasecheck'), 'child hosted in disposable configuration');
    await session.click(await field('button[data-chain="Nexus/releasecheck"]'));
    await field('select[aria-label="Peers of Nexus/releasecheck"]');
    await choose('select[aria-label="Peers of Nexus/releasecheck"]', 'custom');
    const peer = '11'.repeat(32) + '@127.0.0.1:65535';
    await type('textarea[aria-label="Peer list of Nexus/releasecheck"]', peer);
    await press('Save peers of Nexus/releasecheck');
    await until(() => config().peers?.['Nexus/releasecheck']?.[0] === peer, 'per-chain peer format saved');
    assert.deepEqual(config().peers.Nexus, [], 'Nexus remains isolated');
    await press('Stop hosting releasecheck');
    await press('Keep it');
    assert.ok(config().hostedChains.includes('Nexus/releasecheck'));
    await press('Stop hosting releasecheck');
    await press('Stop hosting Nexus/releasecheck');
    await until(() => !config().hostedChains?.includes('Nexus/releasecheck'), 'child removed');
    assert.deepEqual(config().peers, [], 'removing the child restores the legacy-compatible peer list');
    await press('Back to wallet'); await shows(/Balance on Nexus/);
    await session.click(await field('#net-badge'));
    await field('.chain-menu [data-chain="Nexus"]');
    await session.click(await field('.chain-menu [data-chain="Nexus"]'));
    await press('Mining'); await shows(/MiningNot mining/);
    await press('Mining settings'); await shows(/Who each chain pays/);
    await press('Cancel'); await shows(/MiningNot mining/); await press('Back');

    // Keep an unfinished, invalid draft behind the cover. Nothing is sent.
    await press('Send');
    const recipient = 'input[placeholder="recipient address (bafy…)"]';
    await type(recipient, 'unfinished fixture draft');
    await type('input[aria-label="Amount"]', '1');
    await session.run('window.__releaseOriginalNow=Date.now; const now=Date.now(); Date.now=()=>now+11*60*1000; return true');
    await field('.lock-cover');
    await session.run('Date.now=window.__releaseOriginalNow; delete window.__releaseOriginalNow; return true');
    assert.equal(await session.run("return [...document.body.children].filter(e=>!e.matches('.lock-cover')).every(e=>e.inert)"), true);
    const password = '.lock-cover input[type="password"]';
    for (const count of [1, 2, 5, 8]) {
      await type(password, '\uE004'.repeat(count)); // Real WebDriver Tab keys.
      assert.equal(await session.run("return !document.activeElement.closest('[inert]')"), true, 'keyboard cannot reach covered content');
    }
    await session.run("document.querySelector('#settings-button').focus(); return true");
    assert.equal(await session.run("return document.activeElement.id==='settings-button'"), false, 'inert background refuses focus');
    await type(password, 'wrong fixture password'); await press('Unlock');
    await shows(/That password is not right/);
    assert.equal(await session.run("return !!document.querySelector('.lock-cover')"), true);
    await type(password, PASSWORD); await press('Unlock');
    await until(() => session.run("return !document.querySelector('.lock-cover')"), 'cover removed after correct password');
    assert.equal(await value(recipient), 'unfinished fixture draft');
    assert.equal(await session.run("return [...document.body.children].some(e=>e.inert)"), false);
    await press('Cancel'); await shows(/Balance on Nexus/);
    await session.click(await field('#settings-button')); await press('Lock wallet');
    await shows(/Unlock/); await type('input[placeholder="password"]', PASSWORD); await press('Unlock');
    await shows(/Balance on Nexus/);
    console.log('release UI passed: native navigation, disposable per-chain configuration round-trip, synthetic idle lock, inert background, real Tab keys, draft preservation, manual unlock');
  } finally {
    await session?.run('if(window.__releaseOriginalNow) Date.now=window.__releaseOriginalNow; return true').catch(()=>{});
    await session?.end(); driver.kill();
    if (home) {
      await run(join(bin,'lattice'), ['mine','stop','--root',hostRoot]).catch(()=>{});
      await run(join(bin,'lattice'), ['down','--root',hostRoot]).catch(()=>{});
      rmSync(home,{recursive:true,force:true});
    }
  }
});
