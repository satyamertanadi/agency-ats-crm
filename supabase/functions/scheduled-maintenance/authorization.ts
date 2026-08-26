/* The authentication contract for scheduled-maintenance, in one place and with no Deno APIs in it.
 *
 * Extracted from index.ts for one reason: this is the rule that broke production, and a rule that
 * can only be exercised by deploying a function and waiting until :17 past the hour is a rule nobody
 * tests. Everything here takes its inputs as arguments, so the whole credential matrix is a unit
 * test (tests/edge/scheduled-maintenance-auth.test.ts) rather than an operational discovery.
 *
 * THE CONTRACT, stated once so the two ends cannot drift again:
 *
 *   pg_cron sends BOTH headers, carrying the SAME value -- see schedule_maintenance_cron:
 *       x-worker-secret: <secret>
 *       authorization:   Bearer <secret>
 *
 *   The function accepts the request when EITHER matches its own environment:
 *       x-worker-secret === WORKER_SECRET
 *       bearer          === SUPABASE_SERVICE_ROLE_KEY
 *
 * So a deployment is only correct when the value handed to schedule_maintenance_cron is one the
 * deployed function already holds. Nothing in the pipeline used to check that, and the two ends
 * drifted: cron kept firing, pg_cron kept reporting success, and every run came back 401 with
 * retention, anonymization and expired-CV cleanup silently not running. deploy.yml now sets
 * WORKER_SECRET from the same value it registers the cron with, and proves it with a preflight.
 */

export type MaintenanceMode = 'run' | 'preflight'

export interface MaintenanceCredentials {
  /** The dedicated worker secret from the function environment, when one is configured. */
  workerSecret: string | null
  /** Injected into every Edge Function by the platform; the supported fallback credential. */
  serviceRoleKey: string | null
}

/* Deliberately identical in semantics to the check it replaces -- this is an extraction, not a
 * redesign. A null or empty configured credential can never authorize: without the guard, an
 * unconfigured WORKER_SECRET plus an absent header would compare `null === null` on some shapes and
 * open the function that deletes candidate PII to anyone who can reach it. */
export function isAuthorized(headers: Headers, credentials: MaintenanceCredentials): boolean {
  const presentedWorker = headers.get('x-worker-secret')
  const presentedBearer = headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null
  const workerAuthorized = Boolean(credentials.workerSecret && presentedWorker === credentials.workerSecret)
  const serviceAuthorized = Boolean(credentials.serviceRoleKey && presentedBearer === credentials.serviceRoleKey)
  return workerAuthorized || serviceAuthorized
}

/** Anything that is not exactly 'preflight' runs the real job. A typo must never silently turn a
 *  scheduled maintenance run into a no-op -- failing closed here means failing towards doing the
 *  work, because the work is what the client is owed. */
export function parseMode(raw: unknown): MaintenanceMode {
  return raw === 'preflight' ? 'preflight' : 'run'
}

/* Reads the mode without consuming the body the caller may still need, and without letting a
 * malformed body change what happens: pg_cron posts `{}`, a human might post nothing at all, and
 * both mean "run". */
export async function readMode(request: Request): Promise<MaintenanceMode> {
  const query = new URL(request.url).searchParams.get('mode')
  if (parseMode(query) === 'preflight') return 'preflight'
  if (request.method !== 'POST') return 'run'
  try {
    const body = await request.clone().json()
    return parseMode((body as { mode?: unknown } | null)?.mode)
  } catch {
    return 'run'
  }
}
