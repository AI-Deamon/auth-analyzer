// Guards for the scan-reliability fixes (a real scan of 105 apps was cut off by Chrome and left the popup locked).
// The worker cannot run outside Chrome, so these check the guarantees in its source and the pure parts of the flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const worker = src('../extension/background.js');
const scanFn = worker.slice(worker.indexOf('async function scan('));

test('the scan keeps the worker alive and always stops the keep-alive', () => {
  assert.match(worker, /setInterval\(\(\) => chrome\.runtime\.getPlatformInfo/);
  assert.match(scanFn, /startKeepAlive\(\)/);
  assert.match(scanFn, /finally \{[\s\S]*stopKeepAlive\(\)[\s\S]*running = false/);
});

test('progress is saved during the scan and again if it fails', () => {
  assert.match(scanFn, /SAVE_EVERY/);
  assert.match(scanFn, /partialScan/);
  assert.match(scanFn, /catch \(e\) \{[\s\S]*saveState\(\)/, 'a failure must save what was read');
  assert.match(scanFn, /remove\('partialScan'\)/, 'a finished scan clears the partial state');
});

test('resume skips apps that were already read, per account', () => {
  assert.match(scanFn, /if \(done\.has\(recKey\(base\)\)\) continue;/);
  assert.match(worker, /const recKey = \(r\) => accountKey\(r\.account \|\| \{\}\) \+ '\|' \+ r\.href;/);
});

test('a worker that starts with a stale "running" status marks it interrupted instead of leaving the popup locked', () => {
  const recovery = worker.slice(worker.indexOf("chrome.storage.local.get(['scan', 'partialScan']"));
  assert.match(recovery, /!running && s && s\.state === 'running'/, 'must not touch a scan that is genuinely running');
  assert.match(recovery, /state: 'error'/);
});

test('the popup wakes the worker and offers Resume when a partial scan exists', () => {
  const popup = src('../extension/popup.js');
  assert.match(popup, /type: 'ping'/);
  assert.match(popup, /type: 'scan', resume: true/);
  assert.match(popup, /\$\('resume'\)\.hidden = !partial \|\| busy/);
  assert.match(src('../extension/popup.html'), /id="resume"/);
});

test('status updates carry a timestamp', () => {
  assert.match(worker, /updatedAt: Date\.now\(\)/);
});
