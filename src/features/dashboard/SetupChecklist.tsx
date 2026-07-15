import {Check,Lock} from 'lucide-react'
import {Link} from 'react-router-dom'
import {Button} from '../../shared/ui/Button'
import {Panel} from '../../shared/ui/Page'

export interface SetupStep {key:string;title:string;description:string;done:boolean;blocked:boolean;href:string;cta:string}

/**
 * Derives setup progress from live counts rather than stored flags, so the list cannot
 * desync from reality — deleting the last company reopens step one.
 */
export function buildSetupSteps(data:{companies:number;contacts:number;activeJobs:number;candidates:number;pipelineEntries:number;members:number},base:string):SetupStep[]{
  const steps:Array<Omit<SetupStep,'blocked'>>=[
    {key:'company',title:'Add your first client company',description:'Everything else hangs off a client, so this comes first.',done:data.companies>0,href:`${base}/companies`,cta:'Add company'},
    {key:'contact',title:'Add a hiring contact',description:'The person you send candidates to for review.',done:data.contacts>0,href:`${base}/contacts`,cta:'Add contact'},
    {key:'job',title:'Open your first vacancy',description:'Each vacancy gets its own pipeline, copied from your default stages.',done:data.activeJobs>0,href:`${base}/jobs`,cta:'Create vacancy'},
    {key:'candidate',title:'Add a candidate',description:'Upload a CV to fill the profile automatically, or enter one by hand.',done:data.candidates>0,href:`${base}/candidates`,cta:'Add candidate'},
    {key:'pipeline',title:'Move a candidate into a pipeline',description:'This is where day-to-day delivery happens.',done:data.pipelineEntries>0,href:`${base}/jobs`,cta:'Open pipelines'},
    {key:'team',title:'Invite your team',description:'Consultants get their own logins and permissions.',done:data.members>1,href:`${base}/settings`,cta:'Invite team'},
  ]
  // A step is blocked while any earlier step is outstanding — the same dependency the pages
  // already enforce by disabling their own create buttons, surfaced up front instead of on arrival.
  let unmet=false
  return steps.map((step)=>{const blocked=unmet&&!step.done;if(!step.done)unmet=true;return {...step,blocked}})
}

export function SetupChecklist({steps,onDismiss,dismissing=false}:{steps:SetupStep[];onDismiss?:()=>void;dismissing?:boolean}){
  const done=steps.filter((step)=>step.done).length
  const next=steps.find((step)=>!step.done)
  return <Panel className="setup-checklist" elevation="raised" title="Set up your agency"
    subtitle={`${done} of ${steps.length} done${next?` · next: ${next.title.toLowerCase()}`:''}`}
    action={onDismiss&&<Button variant="quiet" onClick={onDismiss} disabled={dismissing}>{dismissing?'Hiding…':'Hide this'}</Button>}>
    <ol className="setup-steps">
      {steps.map((step)=><li key={step.key} className={`setup-step ${step.done?'setup-step-done':''} ${step.blocked?'setup-step-blocked':''}`.trim()}>
        <span className="setup-step-marker" aria-hidden="true">{step.done?<Check size={14}/>:step.blocked?<Lock size={12}/>:null}</span>
        <div className="setup-step-body">
          <strong>{step.title}</strong>
          <p>{step.description}</p>
        </div>
        {step.done
          ? <span className="setup-step-state">Done</span>
          : step.blocked
            ? <span className="setup-step-state">Earlier step first</span>
            : <Link className="button button-secondary button-sm" to={step.href}>{step.cta}</Link>}
      </li>)}
    </ol>
  </Panel>
}
