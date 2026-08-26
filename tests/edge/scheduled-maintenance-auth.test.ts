import assert from 'node:assert/strict'
import {isAuthorized, parseMode, readMode} from '../../supabase/functions/scheduled-maintenance/authorization.ts'

/* The credential matrix for scheduled-maintenance.
 *
 * This is the rule that stopped retention, anonymization and expired-CV cleanup in production: cron
 * fired every hour, pg_cron reported success, and the function answered 401 because the value being
 * sent was not a value the deployed function held. Nothing failed, because nothing checked.
 *
 * These run under Deno (`npm run test:edge`) rather than Vitest, because the code under test ships to
 * Deno and testing it anywhere else would be testing a translation of it. They need no network, no
 * database and no Docker -- which is precisely why they can be the gate that the real 17:17
 * invocation never was.
 *
 * Lives outside supabase/functions/ on purpose: `supabase functions deploy` treats every directory
 * under there as a function to deploy, so a tests/ folder in that tree would try to become one.
 */

const WORKER = 'worker-secret-value'
const SERVICE = 'service-role-key-value'
const both = {workerSecret: WORKER, serviceRoleKey: SERVICE}

const headers = (entries: Record<string, string>) => new Headers(entries)

Deno.test('no credential is refused', () => {
  assert.equal(isAuthorized(headers({}), both), false)
})

Deno.test('an incorrect worker secret is refused', () => {
  assert.equal(isAuthorized(headers({'x-worker-secret': 'wrong'}), both), false)
})

Deno.test('an incorrect bearer token is refused', () => {
  assert.equal(isAuthorized(headers({authorization: 'Bearer wrong'}), both), false)
})

Deno.test('the correct worker secret is accepted', () => {
  assert.equal(isAuthorized(headers({'x-worker-secret': WORKER}), both), true)
})

Deno.test('the correct service role key is accepted', () => {
  assert.equal(isAuthorized(headers({authorization: `Bearer ${SERVICE}`}), both), true)
})

Deno.test('the bearer scheme is matched case-insensitively', () => {
  assert.equal(isAuthorized(headers({authorization: `bearer ${SERVICE}`}), both), true)
})

/* Exactly what schedule_maintenance_cron registers: both headers, one value. This is the shape the
 * deploy-time preflight sends, so if this case ever stopped passing the pipeline would be proving
 * something other than what cron actually does. */
Deno.test('the registered cron request shape is accepted with the worker secret', () => {
  const cronHeaders = headers({'content-type': 'application/json', 'x-worker-secret': WORKER, authorization: `Bearer ${WORKER}`})
  assert.equal(isAuthorized(cronHeaders, both), true)
})

Deno.test('the registered cron request shape is accepted with the service role key', () => {
  const cronHeaders = headers({'content-type': 'application/json', 'x-worker-secret': SERVICE, authorization: `Bearer ${SERVICE}`})
  assert.equal(isAuthorized(cronHeaders, both), true)
})

/* THE production failure, reproduced. The cron carries one value; the function holds two different
 * ones. Both arms miss, and the result is the silent 401 that ran for weeks. */
Deno.test('a cron secret matching neither configured credential is refused', () => {
  const cronHeaders = headers({'x-worker-secret': 'stale-secret', authorization: 'Bearer stale-secret'})
  assert.equal(isAuthorized(cronHeaders, both), false)
})

/* An unconfigured credential must never authorize by matching an absent header. This is the arm that
 * would open a function which deletes candidate PII to anyone who can reach the URL. */
Deno.test('an unconfigured worker secret does not authorize a missing header', () => {
  assert.equal(isAuthorized(headers({}), {workerSecret: null, serviceRoleKey: null}), false)
  assert.equal(isAuthorized(headers({'x-worker-secret': ''}), {workerSecret: null, serviceRoleKey: null}), false)
  assert.equal(isAuthorized(headers({authorization: 'Bearer '}), {workerSecret: null, serviceRoleKey: null}), false)
})

Deno.test('the service role fallback still works when no worker secret is configured', () => {
  const credentials = {workerSecret: null, serviceRoleKey: SERVICE}
  assert.equal(isAuthorized(headers({authorization: `Bearer ${SERVICE}`}), credentials), true)
  assert.equal(isAuthorized(headers({'x-worker-secret': SERVICE}), credentials), false)
})

Deno.test('mode defaults to a real run for anything but an exact preflight', () => {
  assert.equal(parseMode('preflight'), 'preflight')
  assert.equal(parseMode('run'), 'run')
  assert.equal(parseMode(undefined), 'run')
  assert.equal(parseMode(null), 'run')
  assert.equal(parseMode('PREFLIGHT'), 'run')
  assert.equal(parseMode(' preflight '), 'run')
  assert.equal(parseMode(true), 'run')
})

const post = (body: string | null, url = 'https://example.test/functions/v1/scheduled-maintenance') =>
  new Request(url, {method: 'POST', headers: {'content-type': 'application/json'}, ...(body === null ? {} : {body})})

Deno.test('the body pg_cron posts means a real run', async () => {
  assert.equal(await readMode(post('{}')), 'run')
})

Deno.test('an explicit preflight body is honoured', async () => {
  assert.equal(await readMode(post('{"mode":"preflight"}')), 'preflight')
})

Deno.test('a preflight query parameter is honoured', async () => {
  assert.equal(await readMode(post('{}', 'https://example.test/functions/v1/scheduled-maintenance?mode=preflight')), 'preflight')
})

/* A malformed or absent body must not become a preflight -- that would turn a scheduled run into a
 * no-op and leave retention undone while everything reported success. */
Deno.test('a malformed body runs the real job', async () => {
  assert.equal(await readMode(post('not json at all')), 'run')
  assert.equal(await readMode(post(null)), 'run')
})

Deno.test('reading the mode leaves the body available to the caller', async () => {
  const request = post('{"mode":"preflight"}')
  await readMode(request)
  assert.equal(request.bodyUsed, false)
  assert.deepEqual(await request.json(), {mode: 'preflight'})
})

/* Secret hygiene: nothing here may end up in a log line or a diagnostic. The module holds no
 * formatting of its own, which is the cheapest way to guarantee that -- this pins it. */
Deno.test('the authorization module exposes no credential formatting', async () => {
  const source = await Deno.readTextFile(new URL('../../supabase/functions/scheduled-maintenance/authorization.ts', import.meta.url))
  assert.equal(/console\.|log\(/.test(source), false, 'authorization.ts must not log; a credential comparison is the last place to print operands')
})

/* Preflight must never mutate. It exists to be run at deploy time against PRODUCTION, so a write
 * hidden in it would let the pipeline delete a candidate's CV or mark a healthy job failed as a side
 * effect of checking a credential.
 *
 * Enforced structurally rather than behaviourally, and deliberately so: proving it by observation
 * would need a deployed function and a live database, which is exactly the dependency that let the
 * original 401 hide. Reading the shipped source and asserting the preflight path contains no writer
 * is cheap, runs everywhere, and fails the moment somebody adds one.
 */
Deno.test('the preflight path performs no writes', async () => {
  const source = await Deno.readTextFile(new URL('../../supabase/functions/scheduled-maintenance/index.ts', import.meta.url))
  const start = source.indexOf('async function preflight(')
  assert.notEqual(start, -1, 'preflight() must exist in the deployed function')
  // To the next top-level declaration, which is the end of the function body.
  const rest = source.slice(start)
  const end = rest.indexOf('\n}\n')
  assert.notEqual(end, -1, 'could not delimit the preflight body')
  const body = rest.slice(0, end)

  for (const writer of ['.update(', '.delete(', '.insert(', '.upsert(', '.rpc(', '.remove(']) {
    assert.equal(body.includes(writer), false, `preflight must not call ${writer} -- it runs against production at deploy time`)
  }
  // The one read it is allowed to make, kept explicit so a rewrite that drops it is visible.
  assert.equal(body.includes('.select('), true, 'preflight should still read the heartbeat row')
  assert.equal(body.includes('recordFailure'), false, 'preflight must not write a failed heartbeat')
})
