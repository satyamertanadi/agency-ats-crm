import {fireEvent,render,screen,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {describe,expect,it,vi} from 'vitest'
import {CandidateCardMenu} from './CandidateCardMenu'
import {OutcomePrompt} from './OutcomePrompt'
import {OutcomesDrawer} from './OutcomesDrawer'
import type {JobCandidate,PipelineStage} from '../../shared/types/domain'

const stage=(id:string,name:string,stage_type:string):PipelineStage=>({
  id,pipeline_id:'p1',name,stage_key:id,stage_type,phase_key:null,position:1,color:null,
} as PipelineStage)

const rejected=stage('rejected','Rejected','rejected')
const withdrawn=stage('withdrawn','Withdrawn','withdrawn')
const onHold=stage('on_hold','On Hold','on_hold')
const sourced=stage('sourced','Sourced','active')

const candidate=(id:string,name:string,stageId:string,history?:Array<{occurred_at:string;note?:string|null;to_stage_id?:string}>):JobCandidate=>({
  id,job_id:'job-1',candidate_id:`cand-${id}`,current_stage_id:stageId,updated_at:'2026-07-20T00:00:00Z',
  candidates:{id:`cand-${id}`,full_name:name,current_position:'Brand Manager'} as JobCandidate['candidates'],
  stage_history:history,
} as JobCandidate)

describe('CandidateCardMenu',()=>{
  /* Rejecting used to mean opening the drawer and working its move form -- and the drag-to-tray
   * shortcut is mouse-only, so this menu is the accessible path, not a convenience duplicate. */
  const targets=[{key:'sourcing',label:'Sourcing'},{key:'interview',label:'Interview'}] as const

  it('offers every outcome stage and reports the one chosen',()=>{
    const onOutcome=vi.fn();const onOpen=vi.fn()
    render(<CandidateCardMenu candidateName="Ana Chen" columnKey="sourcing" targets={targets}
      outcomeStages={[rejected,withdrawn,onHold]} onOpen={onOpen} onMove={vi.fn()} onOutcome={onOutcome}/>)
    fireEvent.click(screen.getByRole('button',{name:'Actions for Ana Chen'}))

    // The ellipsis promises a prompt rather than an immediate destructive act.
    expect(screen.getByRole('menuitem',{name:'Reject…'})).toBeInTheDocument()
    expect(screen.getByRole('menuitem',{name:'Withdraw…'})).toBeInTheDocument()
    expect(screen.getByRole('menuitem',{name:'Put on hold…'})).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem',{name:'Reject…'}))
    expect(onOutcome).toHaveBeenCalledWith(rejected)
  })

  /* The card's phase <select> was removed, so this menu is now the only keyboard route to a move.
   * If it ever stops offering the phases, drag-and-drop becomes the sole way to move a candidate --
   * which is exactly the pointer-only trap the outcomes menu above exists to avoid. */
  it('is the keyboard route to a phase move, and never offers the phase already occupied',()=>{
    const onMove=vi.fn()
    render(<CandidateCardMenu candidateName="Ana Chen" columnKey="sourcing" targets={targets}
      outcomeStages={[]} onOpen={vi.fn()} onMove={onMove} onOutcome={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button',{name:'Actions for Ana Chen'}))

    // Present but disabled, so the menu still states where the candidate currently is.
    expect(screen.getByRole('menuitem',{name:'Move to Sourcing'})).toBeDisabled()

    fireEvent.click(screen.getByRole('menuitem',{name:'Move to Interview'}))
    expect(onMove).toHaveBeenCalledWith('interview')
  })
})

describe('OutcomePrompt',()=>{
  it('captures the reason at the moment the decision is made',()=>{
    const onConfirm=vi.fn()
    render(<OutcomePrompt open stage={rejected} candidateName="Ana Chen" onClose={vi.fn()} onConfirm={onConfirm}/>)
    // Names the candidate, so a mis-aimed click on a dense board is still readable.
    expect(screen.getByRole('heading',{name:'Reject Ana Chen?'})).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Reason (optional)'),{target:{value:'Not enough commercial exposure'}})
    fireEvent.click(screen.getByRole('button',{name:'Reject Ana Chen'}))
    expect(onConfirm).toHaveBeenCalledWith('Not enough commercial exposure')
  })

  it('confirms on Enter, because it is a one-field form',()=>{
    const onConfirm=vi.fn()
    render(<OutcomePrompt open stage={withdrawn} candidateName="Ana Chen" onClose={vi.fn()} onConfirm={onConfirm}/>)
    fireEvent.keyDown(screen.getByLabelText('Reason (optional)'),{key:'Enter'})
    expect(onConfirm).toHaveBeenCalled()
  })

  it('still closes an outcome with no reason given',()=>{
    const onConfirm=vi.fn()
    render(<OutcomePrompt open stage={onHold} candidateName="Ana Chen" onClose={vi.fn()} onConfirm={onConfirm}/>)
    fireEvent.click(screen.getByRole('button',{name:'Put on hold Ana Chen'}))
    expect(onConfirm).toHaveBeenCalledWith('')
  })
})

describe('OutcomesDrawer',()=>{
  const items=[
    candidate('1','Ana Chen','rejected',[{occurred_at:'2026-07-21T00:00:00Z',note:'Client passed on the profile',to_stage_id:'rejected'}]),
    candidate('2','Budi Hartono','withdrawn',[{occurred_at:'2026-07-19T00:00:00Z',note:'Took another offer',to_stage_id:'withdrawn'}]),
    candidate('3','Sari Wijaya','sourced'),
  ]
  const renderDrawer=(onMove=vi.fn())=>{
    render(<MemoryRouter><OutcomesDrawer open onClose={vi.fn()} items={items} outcomeStages={[rejected,withdrawn,onHold]}
      reinstateStage={sourced} organizationSlug="northstar" canMove onMove={onMove}/></MemoryRouter>)
    return onMove
  }

  it('groups closed candidates by outcome with the reason recorded at the time',()=>{
    renderDrawer()
    expect(screen.getByText('Client passed on the profile')).toBeInTheDocument()
    expect(screen.getByText('Took another offer')).toBeInTheDocument()
    // Still-active candidates are not "closed" and must not appear here.
    expect(screen.queryByText('Sari Wijaya')).not.toBeInTheDocument()
    // An outcome nobody has been moved to gets no empty heading.
    expect(screen.queryByRole('heading',{name:/On Hold/})).not.toBeInTheDocument()
  })

  /* Reinstating lands on the board's first active stage rather than where they were closed from:
   * putting someone straight back into Offer because that is where they were rejected would assert
   * progress nobody has re-made. */
  it('reinstates to the first active stage and offers a way back',()=>{
    const onMove=renderDrawer()
    fireEvent.click(within(screen.getByRole('heading',{name:/Rejected/}).closest('section') as HTMLElement).getByRole('button',{name:'Reinstate'}))
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({
      itemId:'1',stageId:'sourced',name:'Ana Chen',label:'Sourced',
      source:'reinstate',undo:{stageId:'rejected',label:'Rejected'},
    }))
  })

  it('says so plainly when a candidate was closed without a reason',()=>{
    render(<MemoryRouter><OutcomesDrawer open onClose={vi.fn()} items={[candidate('9','Rina Putri','rejected')]}
      outcomeStages={[rejected]} reinstateStage={sourced} organizationSlug="northstar" canMove onMove={vi.fn()}/></MemoryRouter>)
    expect(screen.getByText('No reason was recorded.')).toBeInTheDocument()
  })

  it('hides the reinstate action from a member who cannot move the pipeline',()=>{
    render(<MemoryRouter><OutcomesDrawer open onClose={vi.fn()} items={items} outcomeStages={[rejected]}
      reinstateStage={sourced} organizationSlug="northstar" canMove={false} onMove={vi.fn()}/></MemoryRouter>)
    expect(screen.queryByRole('button',{name:'Reinstate'})).not.toBeInTheDocument()
  })
})
