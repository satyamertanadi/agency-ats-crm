import {render,screen} from '@testing-library/react'
import {describe,expect,it,vi} from 'vitest'
import {InterviewBlueprintPanel} from './InterviewBlueprintPanel'
import type {BlueprintStatus} from './blueprintRepository'

/* The panel's job is to say one of four things and never a fifth.
 *
 * The state that matters most is "unavailable": get_interview_blueprint_status returns no row when
 * the workspace has the feature off or the caller cannot use it, and the panel must then render
 * nothing at all. An entry point that RLS would refuse is worse than no entry point -- it teaches
 * people the feature is broken rather than switched off.
 */

const queryState=vi.hoisted(()=>({data:null as BlueprintStatus|null,isLoading:false}))
vi.mock('@tanstack/react-query',async()=>{
  const actual=await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {...actual,useQuery:()=>queryState,useQueryClient:()=>({invalidateQueries:vi.fn()}),useMutation:()=>({mutate:vi.fn(),isPending:false})}
})
vi.mock('./InterviewBlueprintDrawer',()=>({InterviewBlueprintDrawer:()=><div>drawer</div>}))

const status=(overrides:Partial<BlueprintStatus>={}):BlueprintStatus=>({
  rubricId:null,version:null,activatedAt:null,sourceDocumentId:null,
  essentialQuestionCount:0,mustHaveCount:0,niceToHaveCount:0,
  isStale:false,draftRubricId:null,draftUpdatedAt:null,
  coreRubricId:null,coreRubricVersion:null,
  ...overrides,
})

const renderPanel=(value:BlueprintStatus|null,canConfigure=true)=>{
  queryState.data=value
  queryState.isLoading=false
  return render(<InterviewBlueprintPanel organizationId="org-1" jobId="job-1" canConfigure={canConfigure}/>)
}

describe('InterviewBlueprintPanel',()=>{
  it('renders nothing when the workspace cannot use the feature',()=>{
    const {container}=renderPanel(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the status is still loading',()=>{
    queryState.data=null
    queryState.isLoading=true
    const {container}=render(<InterviewBlueprintPanel organizationId="org-1" jobId="job-1" canConfigure/>)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers setup, not a warning, when no blueprint exists',()=>{
    renderPanel(status())
    expect(screen.getByText('No blueprint yet')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Set up'})).toBeInTheDocument()
    expect(screen.queryByText('May be outdated')).not.toBeInTheDocument()
  })

  it('marks a stale blueprint without implying it was refreshed',()=>{
    renderPanel(status({rubricId:'r1',version:2,isStale:true,essentialQuestionCount:5,mustHaveCount:2,coreRubricId:'core-1'}))
    expect(screen.getByText('May be outdated')).toBeInTheDocument()
    expect(screen.getByText(/still in use/)).toBeInTheDocument()
  })

  it('shows the active version and its counts',()=>{
    renderPanel(status({rubricId:'r1',version:4,essentialQuestionCount:7,mustHaveCount:3,coreRubricId:'core-1'}))
    expect(screen.getByText('Version 4 active')).toBeInTheDocument()
    expect(screen.getByText('7 questions · 3 must-have')).toBeInTheDocument()
  })

  it('warns when no agency core rubric is active, because analysis needs both',()=>{
    renderPanel(status({rubricId:'r1',version:1,coreRubricId:null}))
    expect(screen.getByText(/No agency core rubric is active/)).toBeInTheDocument()
  })

  it('hides that warning once a core rubric exists',()=>{
    renderPanel(status({rubricId:'r1',version:1,coreRubricId:'core-1'}))
    expect(screen.queryByText(/No agency core rubric is active/)).not.toBeInTheDocument()
  })

  it('gives a consultant no configuration controls',()=>{
    // view_own and use do not imply configure. A consultant reads the blueprint; they do not author it.
    renderPanel(status({rubricId:'r1',version:1,coreRubricId:'core-1'}),false)
    expect(screen.getByRole('button',{name:'View'})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'New version'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Set up'})).not.toBeInTheDocument()
  })

  it('points a configurer at the waiting draft rather than at generation',()=>{
    renderPanel(status({draftRubricId:'d1'}))
    expect(screen.getByRole('button',{name:'Review draft'})).toBeInTheDocument()
  })
})
