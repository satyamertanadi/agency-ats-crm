import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {JobSubmissionsRail,linkState,type SubmissionPackageRow} from './JobSubmissionsRail'
import {ToastProvider} from '../../shared/ui/Toast'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'

const {retryClientSubmission,revokeSubmissionLink}=vi.hoisted(()=>({retryClientSubmission:vi.fn(),revokeSubmissionLink:vi.fn()}))
vi.mock('../core/commercialRepository',()=>({retryClientSubmission,revokeSubmissionLink}))

const now=new Date('2026-07-27T12:00:00Z')
const link=(overrides:Partial<{id:string;expires_at:string;revoked_at:string|null;last_accessed_at:string|null;recipient_email:string|null}>={})=>({
  id:'link-1',recipient_email:'rani@sembada.example',expires_at:'2026-08-10T12:00:00Z',revoked_at:null,last_accessed_at:null,...overrides,
})
const pkg=(overrides:Partial<SubmissionPackageRow>={}):SubmissionPackageRow=>({
  id:'pkg-1',job_id:'job-1',title:'2 candidates · Head of Brand',status:'shared',created_at:'2026-07-20T12:00:00Z',
  candidate_submissions:[{id:'cs-1',job_candidate_id:'jc-1',status:'submitted'},{id:'cs-2',job_candidate_id:'jc-2',status:'submitted'}],
  public_submission_links:[link()],...overrides,
})

function renderRail(packages:SubmissionPackageRow[],canSubmit=true){
  const onResend=vi.fn()
  const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  render(<QueryClientProvider client={cache}><ToastProvider>
    <JobSubmissionsRail packages={packages} jobId="job-1" organizationId="org-1" canSubmit={canSubmit} onChanged={vi.fn().mockResolvedValue(undefined)} onResend={onResend} now={now}/>
  </ToastProvider></QueryClientProvider>)
  return onResend
}

describe('linkState',()=>{
  /* Revoked beats expired: saying "expired" about a link somebody deliberately pulled misreports what
   * happened, and the two have different remedies. */
  it('reports a revoked link as revoked even once its expiry has also passed',()=>{
    expect(linkState(link({revoked_at:'2026-07-21T00:00:00Z',expires_at:'2026-07-22T00:00:00Z'}),now)).toMatchObject({label:'Revoked'})
  })
  it('reports a lapsed link as expired and a future one as live',()=>{
    expect(linkState(link({expires_at:'2026-07-26T12:00:00Z'}),now)).toMatchObject({label:'Expired'})
    expect(linkState(link({expires_at:'2026-07-28T12:00:00Z'}),now)).toMatchObject({label:'Live'})
  })
})

describe('JobSubmissionsRail',()=>{
  beforeEach(()=>{vi.clearAllMocks();revokeSubmissionLink.mockResolvedValue(undefined)})

  it('shows only this job’s packages',()=>{
    renderRail([pkg(),pkg({id:'pkg-2',job_id:'other-job',title:'Someone else'})])
    expect(screen.getByText('2 candidates · Head of Brand')).toBeInTheDocument()
    expect(screen.queryByText('Someone else')).not.toBeInTheDocument()
  })

  // The question a consultant is actually asking is whether the client opened it.
  it('says whether the client has opened the link',()=>{
    renderRail([pkg()])
    expect(screen.getByText(/not opened yet/)).toBeInTheDocument()
  })

  /* revokeSubmissionLink has been exported and called from nowhere since it was written -- this is
   * the surface that finally calls it, and it is irreversible, so it confirms first. */
  it('revokes a live link only after confirmation',async()=>{
    renderRail([pkg()])
    fireEvent.click(screen.getByRole('button',{name:'Revoke link'}))
    expect(revokeSubmissionLink).not.toHaveBeenCalled()

    // Two buttons now read "Revoke link" -- the row's and the dialog's -- so the confirm is scoped
    // to the dialog, which is also what proves the dialog is what performed it.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Revoke link'}))
    await waitFor(()=>expect(revokeSubmissionLink).toHaveBeenCalledWith('link-1'))
  })

  it('offers a fresh link instead of revoke once the link is dead',()=>{
    const onResend=renderRail([pkg({public_submission_links:[link({expires_at:'2026-07-01T00:00:00Z'})]})])
    expect(screen.queryByRole('button',{name:'Revoke link'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Send a fresh link'}))
    expect(onResend).toHaveBeenCalled()
  })

  it('hides both actions from a member who cannot submit',()=>{
    renderRail([pkg()],false)
    expect(screen.queryByRole('button',{name:'Revoke link'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Send a fresh link'})).not.toBeInTheDocument()
  })
})
