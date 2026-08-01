import {Component,type ErrorInfo,type ReactNode} from 'react'
import {AlertTriangle,RefreshCw} from 'lucide-react'
import {useLocation} from 'react-router'
import {useAuth} from './AuthProvider'
import {useOrganization} from './OrganizationProvider'
import {captureError} from '../shared/lib/observability'

type BoundaryContext={route?:string;workspaceId?:string;workspaceSlug?:string;userId?:string}
type Props={children:ReactNode;resetKey?:string;context?:BoundaryContext}
type State={error:Error|null;referenceId:string|null}

const referenceId=()=>{
  const suffix=typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID().slice(0,8):Math.random().toString(36).slice(2,10)
  return `ATS-${suffix.toUpperCase()}`
}

/** Last-resort render protection. It deliberately uses plain anchors so recovery still works when
 * React Router or a lazy route chunk is the part that failed. */
export class AppErrorBoundary extends Component<Props,State>{
  override state:State={error:null,referenceId:null}

  static getDerivedStateFromError(error:Error):State{return {error,referenceId:referenceId()}}

  override componentDidCatch(error:Error,info:ErrorInfo){
    captureError(error,{area:'render_boundary',error_reference:this.state.referenceId,component_stack:info.componentStack,...this.props.context})
  }

  override componentDidUpdate(previous:Props){
    if(this.state.error&&previous.resetKey!==this.props.resetKey)this.setState({error:null,referenceId:null})
  }

  override render(){
    if(!this.state.error)return this.props.children
    const today=this.props.context?.workspaceSlug?`/app/${this.props.context.workspaceSlug}/today`:'/app'
    return <main className="error-page" role="main">
      <section className="state state-error" role="alert">
        <AlertTriangle/>
        <p className="eyebrow">Workspace recovery</p>
        <h1>This view could not be opened</h1>
        <p>Your data is safe. Retry the view, or return to Today and continue working.</p>
        <small>Error reference: <code>{this.state.referenceId}</code></small>
        <div className="state-actions">
          <button className="button button-primary" onClick={()=>this.setState({error:null,referenceId:null})}><RefreshCw size={15}/>Retry view</button>
          <a className="button button-secondary" href={today}>Return to Today</a>
        </div>
      </section>
    </main>
  }
}

export function RouteErrorBoundary({children}:{children:ReactNode}){
  const location=useLocation();const {user}=useAuth();const {organization}=useOrganization()
  const route=`${location.pathname}${location.search}`
  return <AppErrorBoundary resetKey={route} context={{route,workspaceId:organization?.id,workspaceSlug:organization?.slug,userId:user?.id}}>{children}</AppErrorBoundary>
}
