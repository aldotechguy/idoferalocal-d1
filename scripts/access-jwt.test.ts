import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessGroupAllowed,
  accessJwksUrl,
  normalizeAccessGroups,
  readAccessIdentity,
  resetAccessKeyCache,
} from '../src/server/accessJwt.ts';

const TEAM = 'https://demo.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

async function fixture() {
  resetAccessKeyCache();
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, keys: [{ ...jwk, kid: 'test-key-1', alg: 'RS256', use: 'sig' }] };
}

async function sign(privateKey: CryptoKey, header: Record<string, unknown>, payload: Record<string, unknown>) {
  const signingInput = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, encoder.encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

const claims = (overrides: Record<string, unknown> = {}) => ({
  iss: TEAM,
  aud: AUD,
  email: 'Manager@Company.com',
  sub: 'idp-subject-1',
  type: 'app',
  iat: Math.floor(Date.now() / 1000) - 30,
  exp: Math.floor(Date.now() / 1000) + 600,
  ...overrides,
});

const config = (keys: any[], now?: () => number) => ({ teamDomain: TEAM, audience: AUD, jwks: async () => keys, now });

const request = (token?: string) => new Request('https://idomall.olz.workers.dev/api/auth/session', {
  headers: token ? { 'cf-access-jwt-assertion': token } : {},
});

test('a valid Access JWT yields the asserted identity and groups', async () => {
  const { privateKey, keys } = await fixture();
  const token = await sign(privateKey, { alg: 'RS256', kid: 'test-key-1', typ: 'JWT' }, claims({ groups: ['mall-staff', 'idofera-super-admins'] }));
  const identity = await readAccessIdentity(request(token), config(keys));
  assert.ok(identity);
  assert.equal(identity.email, 'manager@company.com');
  assert.equal(identity.subject, 'idp-subject-1');
  assert.deepEqual(identity.groups, ['mall-staff', 'idofera-super-admins']);
});

test('an unconfigured Access app never authenticates anyone', async () => {
  const { privateKey, keys } = await fixture();
  const token = await sign(privateKey, { alg: 'RS256', kid: 'test-key-1' }, claims());
  assert.equal(await readAccessIdentity(request(token), { jwks: async () => keys }), null);
  assert.equal(await readAccessIdentity(request(token), { teamDomain: TEAM, jwks: async () => keys }), null);
  assert.equal(await readAccessIdentity(request(), config(keys)), null);
});

test('audience, issuer, expiry and signature are all enforced', async () => {
  const { privateKey, keys } = await fixture();
  const now = () => Math.floor(Date.now() / 1000);
  const read = (token: string) => readAccessIdentity(request(token), config(keys, now));

  const wrongAudience = await sign(privateKey, { alg: 'RS256', kid: 'test-key-1' }, claims({ aud: 'someone-elses-app' }));
  assert.equal(await read(wrongAudience), null, 'a token minted for another application must not be accepted');

  const wrongIssuer = await sign(privateKey, { alg: 'RS256', kid: 'test-key-1' }, claims({ iss: 'https://other.cloudflareaccess.com' }));
  assert.equal(await read(wrongIssuer), null);

  const expired = await sign(privateKey, { alg: 'RS256', kid: 'test-key-1' }, claims({ exp: now() - 120 }));
  assert.equal(await read(expired), null);

  const notYetValid = await sign(privateKey, { alg: 'RS256', kid: 'test-key-1' }, claims({ nbf: now() + 600 }));
  assert.equal(await read(notYetValid), null);

  const unsigned = `${wrongIssuer.split('.').slice(0, 2).join('.')}.`;
  assert.equal(await read(unsigned), null, 'an unsigned token must not be accepted');

  const foreign = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  assert.equal(await read(await sign(foreign.privateKey, { alg: 'RS256', kid: 'test-key-1' }, claims())), null,
    'a token signed by an unknown key must not be accepted');
});

test('tampering with the payload invalidates the signature', async () => {
  const { privateKey, keys } = await fixture();
  const token = await sign(privateKey, { alg: 'RS256', kid: 'test-key-1' }, claims({ email: 'staff@company.com' }));
  const [header, , signature] = token.split('.');
  const upgraded = base64url(encoder.encode(JSON.stringify(claims({ email: 'boss@company.com' }))));
  assert.equal(await readAccessIdentity(request(`${header}.${upgraded}.${signature}`), config(keys)), null,
    'editing the email claim must break verification');
});

test('a signed token without an email claim is refused', async () => {
  const { privateKey, keys } = await fixture();
  const token = await sign(privateKey, { alg: 'RS256', kid: 'test-key-1' }, claims({ email: undefined }));
  assert.equal(await readAccessIdentity(request(token), config(keys)), null);
});

test('group claims are normalized across IdP shapes', () => {
  assert.deepEqual(normalizeAccessGroups(['a', 'b']), ['a', 'b']);
  assert.deepEqual(normalizeAccessGroups('a, b ,a'), ['a', 'b']);
  assert.deepEqual(normalizeAccessGroups([['a'], ['b']]), ['a', 'b']);
  assert.deepEqual(normalizeAccessGroups({ a: true, b: false, c: 'c' }), ['a', 'c']);
  assert.deepEqual(normalizeAccessGroups(undefined), []);
  assert.deepEqual(normalizeAccessGroups(42), []);
});

test('the super-admin group gate fails closed when it is configured', () => {
  const identity = { email: 'manager@company.com', subject: 's', groups: ['mall-staff'] };
  assert.equal(accessGroupAllowed(identity, undefined), true, 'an unconfigured group requirement is disabled');
  assert.equal(accessGroupAllowed(identity, ''), true);
  assert.equal(accessGroupAllowed(identity, 'mall-staff'), true);
  assert.equal(accessGroupAllowed(identity, 'idofera-super-admins'), false);
  assert.equal(accessGroupAllowed(null, 'idofera-super-admins'), false);
  assert.equal(accessGroupAllowed(null, undefined), true);
});

test('the JWKS endpoint is derived from the team domain', () => {
  assert.equal(accessJwksUrl('https://demo.cloudflareaccess.com/'), 'https://demo.cloudflareaccess.com/cdn-cgi/access/certs');
  assert.equal(accessJwksUrl('https://demo.cloudflareaccess.com'), 'https://demo.cloudflareaccess.com/cdn-cgi/access/certs');
});

test('CF_ACCESS_AUD accepts comma-separated tags, one per Access application', async () => {
  const { privateKey, keys } = await fixture();
  const multi = { ...config(keys), audience: ` ${AUD}, aud-tag-456 ` };
  const signed = (payload: Record<string, unknown>) =>
    sign(privateKey, { alg: 'RS256', kid: 'test-key-1' }, claims(payload));

  // The runbook creates one application per staff path and each mints its own
  // AUD; a token from ANY configured application must authenticate, otherwise
  // identity (and the IdP-group leg of the super-admin gate) would silently
  // vanish on every path whose app tag is not the single configured one.
  assert.ok(await readAccessIdentity(request(await signed({})), multi), 'first tag matches');
  assert.ok(await readAccessIdentity(request(await signed({ aud: 'aud-tag-456' })), multi), 'second tag matches');
  assert.ok(await readAccessIdentity(request(await signed({ aud: ['other', 'aud-tag-456'] })), multi), 'an array aud claim intersects the list');

  // A tag nobody configured stays rejected: a foreign application's token is
  // still useless here, and a single tag behaves exactly as before.
  assert.equal(await readAccessIdentity(request(await signed({ aud: 'foreign-tag' })), multi), null);
  assert.ok(await readAccessIdentity(request(await signed({})), config(keys)), 'a single tag still works unchanged');
});

