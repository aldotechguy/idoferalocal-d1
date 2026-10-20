// Container transport: prove the Worker client speaks to the Rust engine through
// the Durable Object binding (production path), not just a public URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeRemoteEngine,
  remoteCalculateAmountDueKobo,
  remoteEngineConfigFrom,
  remoteValidateOrderTransition,
  type ContainerBinding,
} from '../src/native-bridge/remoteEngine';

type Sent = { method: string; path: string; body: unknown };

/**
 * Stand-in for the Cloudflare Container binding. Routes are answered with the
 * same envelopes the Rust service produces so the client is tested against its
 * real contract rather than a hand-shaped mock.
 */
function fakeContainer(behaviour: 'healthy' | 'error' = 'healthy') {
  const sent: Sent[] = [];
  const binding: ContainerBinding = {
    getByName(name: string) {
      assert.equal(name, 'money-engine', 'engine requests use the singleton instance');
      return {
        async fetch(input: Request) {
          const url = new URL(input.url);
          const body = input.method === 'POST' ? await input.json() : undefined;
          sent.push({ method: input.method, path: url.pathname, body });
          if (behaviour === 'error') return new Response('boom', { status: 500 });
          if (url.pathname === '/health') {
            return Response.json({ ok: true, result: { engine: 'idofera-rust-money-engine', version: '0.1.0', runtime: 'rust', auth: 'open' } });
          }
          if (url.pathname === '/orders/amount-due') {
            const { totalKobo, paidKobo, status } = body as { totalKobo: number; paidKobo: number; status: string };
            const due = ['cancelled', 'refunded'].includes(status) ? 0 : Math.max(0, totalKobo - paidKobo);
            return Response.json({ ok: true, result: { amountDueKobo: due } });
          }
          if (url.pathname === '/orders/transition') {
            const { from, to } = body as { from: string; to: string };
            return Response.json({ ok: true, result: { allowed: from !== to && to === 'confirmed', isIdempotent: from === to, errorMessage: null } });
          }
          return Response.json({ ok: false, error: 'unknown route' }, { status: 404 });
        },
      };
    },
  };
  return { binding, sent };
}

test('a container binding is configured without any public URL or token', () => {
  const { binding } = fakeContainer();
  const config = remoteEngineConfigFrom({ MONEY_ENGINE_CONTAINER: binding, MONEY_ENGINE_URL: '', MONEY_ENGINE_TIMEOUT_MS: '900' });
  assert.ok(config);
  assert.equal(config!.url, '');
  assert.equal(config!.token, undefined);
  assert.equal(config!.timeoutMs, 900);
  assert.equal(config!.container, binding);
});

test('requests are routed through the container binding, not the network', async () => {
  const { binding, sent } = fakeContainer();
  const config = remoteEngineConfigFrom({ MONEY_ENGINE_CONTAINER: binding })!;
  const identity = await probeRemoteEngine(config);
  assert.equal(identity?.engine, 'idofera-rust-money-engine');
  assert.equal(await remoteCalculateAmountDueKobo(config, 50_000, 20_000, 'processing'), 30_000);
  assert.equal((await remoteValidateOrderTransition(config, 'pending', 'confirmed'))?.allowed, true);
  assert.deepEqual(sent.map((s) => `${s.method} ${s.path}`), [
    'GET /health',
    'POST /orders/amount-due',
    'POST /orders/transition',
  ]);
  assert.deepEqual(sent[1].body, { totalKobo: 50_000, paidKobo: 20_000, status: 'processing' });
});

test('a failing container returns null so the bridge falls back to TypeScript', async () => {
  const { binding } = fakeContainer('error');
  const config = remoteEngineConfigFrom({ MONEY_ENGINE_CONTAINER: binding })!;
  assert.equal(await probeRemoteEngine(config), null);
  assert.equal(await remoteCalculateAmountDueKobo(config, 50_000, 20_000, 'processing'), null);
});

test('no binding and no URL means unconfigured (kill switch)', () => {
  assert.equal(remoteEngineConfigFrom({ MONEY_ENGINE_URL: '' }), null);
  assert.equal(remoteEngineConfigFrom({}), null);
  assert.equal(remoteEngineConfigFrom(undefined), null);
});
