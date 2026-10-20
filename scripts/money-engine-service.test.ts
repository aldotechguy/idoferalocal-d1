// Rust money-engine HTTP contract for Node tests: start the compiled binary,
// exercise every route, and prove the Worker's client handles success and
// failure the way production depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  callRemoteEngine,
  normalizeEngineUrl,
  probeRemoteEngine,
  remoteCalculateAmountDueKobo,
  remotePlanCoreUpsert,
  remoteValidateOrderTransition,
  remoteVerifyOrderTotals,
} from '../src/native-bridge/remoteEngine';

const ROOT = process.cwd();
const BINARY = path.join(ROOT, 'native', 'target', 'release', process.platform === 'win32' ? 'money_engine_server.exe' : 'money_engine_server');
const TOKEN = 'test-engine-token';

function startServer(port: number): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const child = spawn(BINARY, [], {
      env: { ...process.env, PORT: String(port), MONEY_ENGINE_TOKEN: TOKEN },
      stdio: 'pipe',
    });
    const timer = setTimeout(() => reject(new Error('money engine did not start')), 10_000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`money engine exited with ${code}`));
    });
  });
}

test('Rust money engine answers the Worker client contract', { skip: !existsSync(BINARY) && 'run npm run build:native-engine first' }, async (t) => {
  const port = 18_700 + Math.floor(Math.random() * 200);
  const server = await startServer(port);
  const config = { url: `http://127.0.0.1:${port}`, token: TOKEN, timeoutMs: 2_000 };
  t.after(() => server.kill());

  await t.test('health identifies the Rust runtime without a token', async () => {
    const identity = await probeRemoteEngine({ url: config.url });
    assert.equal(identity?.engine, 'idofera-rust-money-engine');
    assert.equal(identity?.runtime, 'rust');
  });

  await t.test('health stays public because the engine only reports identity', async () => {
    // A wrong token must not block readiness: /health leaks no data and the
    // Worker needs it precisely to detect a broken token configuration.
    const identity = await probeRemoteEngine({ url: config.url, token: 'wrong' });
    assert.equal(identity?.engine, 'idofera-rust-money-engine');
  });

  await t.test('amount due is exact integer kobo', async () => {
    assert.equal(await remoteCalculateAmountDueKobo(config, 50_000, 20_000, 'processing'), 30_000);
    assert.equal(await remoteCalculateAmountDueKobo(config, 50_000, 70_000, 'processing'), 0);
    assert.equal(await remoteCalculateAmountDueKobo(config, 50_000, 10_000, 'refunded'), 0);
  });

  await t.test('order transitions match the TS state machine', async () => {
    assert.equal((await remoteValidateOrderTransition(config, 'pending', 'confirmed'))?.allowed, true);
    assert.equal((await remoteValidateOrderTransition(config, 'completed', 'pending'))?.allowed, false);
    assert.equal((await remoteValidateOrderTransition(config, 'packed', 'packed'))?.isIdempotent, true);
  });

  await t.test('totals invariant is enforced', async () => {
    assert.equal(await remoteVerifyOrderTotals(config, 10_000, 1_000, 1_500, 10_500), true);
    assert.equal(await remoteVerifyOrderTotals(config, 10_000, 1_000, 1_500, 10_501), false);
  });

  await t.test('relational planner distinguishes unsupported collections from failure', async () => {
    const now = '2026-10-20T00:00:00.000Z';
    const statements = await remotePlanCoreUpsert(config, 'customers', { id: 'remote-c1', name: 'Ada' }, now);
    assert.ok(Array.isArray(statements) && statements!.length === 1);
    assert.ok(statements![0].sql.startsWith('INSERT INTO customers'));
    assert.equal(await remotePlanCoreUpsert(config, 'widgets', { id: 'x' }, now), null);
  });

  await t.test('an unreachable engine returns null so the caller falls back', async () => {
    const dead = { url: 'http://127.0.0.1:1', token: TOKEN, timeoutMs: 300 };
    assert.equal(await callRemoteEngine(dead, '/orders/amount-due', { totalKobo: 1, paidKobo: 0, status: 'pending' }), null);
    assert.equal(await remoteValidateOrderTransition(dead, 'pending', 'confirmed'), null);
  });
});

test('engine url normalization rejects non-http targets', () => {
  assert.equal(normalizeEngineUrl('https://engine.test/'), 'https://engine.test');
  assert.equal(normalizeEngineUrl(''), null);
  assert.equal(normalizeEngineUrl('file:///etc/passwd'), null);
  assert.equal(normalizeEngineUrl('not a url'), null);
});
