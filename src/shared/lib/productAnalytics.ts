import {supabase} from './supabase'

type EventName='navigation_changed'|'action_started'|'action_completed'|'action_abandoned'

export function recordWorkflowEvent(input:{organizationId:string;eventName:EventName;surface:string;actionKey?:string;destination?:string;metadata?:Record<string,boolean|number>}){
  const row={organization_id:input.organizationId,event_name:input.eventName,surface:input.surface.slice(0,60),action_key:input.actionKey?.slice(0,60)||null,destination:input.destination?.slice(0,60)||null,metadata:input.metadata||{}}
  void supabase.from('workflow_product_events').insert(row).then(({error})=>{if(error&&import.meta.env.DEV)console.warn('Workflow telemetry was not recorded',error.message)})
}
