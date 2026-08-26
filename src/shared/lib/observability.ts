import { env } from './env'

/* Error reporting, loaded only if it is going to be used.
 *
 * `import * as Sentry from '@sentry/react'` at the top of this file put the entire SDK into the
 * initial bundle -- of every page load, for every user, whether or not a DSN was configured and
 * before anything had rendered. It is the largest single thing in that chunk and it does nothing
 * until something goes wrong, which makes it the clearest possible candidate for deferral.
 *
 * A dynamic import means: no DSN, no download at all; DSN present, the SDK arrives alongside the
 * first route chunk rather than ahead of first paint.
 *
 * ORDERING IS THE PART THAT NEEDS CARE. An error thrown while the SDK is still in flight must not be
 * dropped, and `captureException` before `init` is not reliably buffered. So there is one promise --
 * the module import AND its init, resolved together -- and every capture awaits it. A capture that
 * arrives first simply waits; a capture that arrives before initializeObservability() ever ran
 * triggers it, which is what keeps this correct for callers that do not go through main.tsx.
 */

const sensitiveKeys=/email|phone|name|salary|token|authorization|resume|document|candidate/i

function scrub(value:unknown):unknown{
  if(Array.isArray(value))return value.map(scrub)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,sensitiveKeys.test(key)?'[Filtered]':scrub(item)]))
  return value
}

/** The SDK and its initialisation as one promise, so a capture can never run against an uninitialised
 *  client. Null until a DSN is configured and something asks for it. */
let ready:Promise<typeof import('@sentry/react')>|null=null

export function initializeObservability(){
  if(!env.sentryDsn||ready)return
  ready=import('@sentry/react').then((Sentry)=>{
    Sentry.init({
      dsn:env.sentryDsn,
      tracesSampleRate:env.sentryTracesSampleRate,
      sendDefaultPii:false,
      integrations:[],
      beforeSend(event){
        event.request=scrub(event.request) as typeof event.request
        event.extra=scrub(event.extra) as typeof event.extra
        event.contexts=scrub(event.contexts) as typeof event.contexts
        return event
      },
    })
    return Sentry
  }).catch((error:unknown)=>{
    /* Reporting that cannot load must not take the application with it. The console is the only
     * place left to say so, and a failed import is exactly the case where staying silent would be
     * indistinguishable from working. */
    if(import.meta.env.DEV)console.warn('Error reporting could not be loaded',error)
    throw error
  })
}

/* Unchanged for callers: still synchronous-looking, still fire-and-forget. The work now happens on a
 * microtask once the SDK is present. */
export function captureError(error:unknown,context:Record<string,unknown>={}){
  if(!env.sentryDsn)return
  initializeObservability()
  void ready?.then((Sentry)=>{Sentry.captureException(error,{extra:scrub(context) as Record<string,unknown>})}).catch(()=>{/* already reported above */})
}
