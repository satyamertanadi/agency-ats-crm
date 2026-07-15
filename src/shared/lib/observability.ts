import * as Sentry from '@sentry/react'
import { env } from './env'

const sensitiveKeys=/email|phone|name|salary|token|authorization|resume|document|candidate/i

function scrub(value:unknown):unknown{
  if(Array.isArray(value))return value.map(scrub)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,sensitiveKeys.test(key)?'[Filtered]':scrub(item)]))
  return value
}

export function initializeObservability(){
  if(!env.sentryDsn)return
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
}

export function captureError(error:unknown,context:Record<string,unknown>={}){
  if(env.sentryDsn)Sentry.captureException(error,{extra:scrub(context) as Record<string,unknown>})
}
