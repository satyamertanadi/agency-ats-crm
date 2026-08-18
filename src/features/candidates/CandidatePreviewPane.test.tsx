import {render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {describe,expect,it,vi} from 'vitest'
import {CandidatePreviewPane} from './CandidatePreviewPane'
import type {CandidateSearchRow} from '../../shared/types/domain'

const row=(overrides:Partial<CandidateSearchRow>={})=>({
  id:'cand-1',full_name:'Ni Putu Widya',current_position:'Junior Taxation Consultant',
  current_company:'IBS Consulting',location:'Denpasar',status:'active',source:'referral',
  owner_name:'Satya Mertanadi',skill_names:['Accounting','Audit','Excel'],tag_names:['VIP'],
  total_count:1,...overrides,
} as unknown as CandidateSearchRow)

const renderPane=(candidate:CandidateSearchRow|null,extra:{canAddToJob?:boolean;onAddToJob?:()=>void}={})=>render(
  <MemoryRouter><CandidatePreviewPane candidate={candidate} organizationSlug="acme"
    canAddToJob={extra.canAddToJob??true} onAddToJob={extra.onAddToJob??vi.fn()}/></MemoryRouter>)

describe('CandidatePreviewPane',()=>{
  it('teaches the keyboard model when nothing is chosen yet',()=>{
    renderPane(null)
    expect(screen.getByText('Choose a candidate to see their details here.')).toBeInTheDocument()
    // The pane is where a consultant who never opens the shortcut sheet learns j/k.
    expect(screen.getByText('j')).toBeInTheDocument()
    expect(screen.getByText('k')).toBeInTheDocument()
  })

  it('states the facts a consultant screens on before opening a record',()=>{
    renderPane(row())
    expect(screen.getByText('Ni Putu Widya')).toBeInTheDocument()
    expect(screen.getByText('Junior Taxation Consultant at IBS Consulting')).toBeInTheDocument()
    expect(screen.getByText('Denpasar')).toBeInTheDocument()
    expect(screen.getByText('Satya Mertanadi')).toBeInTheDocument()
  })

  /* The whole skill set, not the two the table column has room for -- seeing the rest without
   * navigating is most of the reason the pane exists. */
  it('shows every skill rather than the table truncation',()=>{
    renderPane(row())
    for(const skill of ['Accounting','Audit','Excel'])expect(screen.getByText(skill)).toBeInTheDocument()
  })

  /* The permission boundary. Email, phone and salary sit behind candidates_private and are not in the
   * list row at all -- the page promises the list does not expose them. If someone later widens the
   * search row to carry them, this fails rather than quietly leaking them into a always-visible pane. */
  it('never renders private contact or salary data, and says where it lives',()=>{
    const {container}=renderPane(row({
      ...({email:'widya@example.test',phone:'+62811',expected_salary:9_000_000,salary_currency:'IDR'} as object),
    }))
    const text=container.textContent||''
    expect(text).not.toContain('widya@example.test')
    expect(text).not.toContain('+62811')
    expect(text).not.toContain('9000000')
    expect(text).not.toContain('9,000,000')
    expect(screen.getByText('Contact details and salary are on the full record.')).toBeInTheDocument()
  })

  it('always offers the full record, and links to it by id',()=>{
    renderPane(row())
    expect(screen.getByRole('link',{name:'Open full record'})).toHaveAttribute('href','/app/acme/candidates/cand-1')
  })

  // Same rule the table's row action follows, so the two cannot disagree about who is reachable.
  it('refuses to add an unreachable candidate to a job',()=>{
    renderPane(row({status:'do_not_contact'} as Partial<CandidateSearchRow>))
    expect(screen.getByRole('button',{name:'Add to job'})).toBeDisabled()
  })

  it('hides the add action entirely without the permission',()=>{
    renderPane(row(),{canAddToJob:false})
    expect(screen.queryByRole('button',{name:'Add to job'})).not.toBeInTheDocument()
    expect(screen.getByRole('link',{name:'Open full record'})).toBeInTheDocument()
  })

  /* Candidate -> Job -> Stage -> Activity -> Next action, which is the sequence this pane exists to
   * make answerable without opening the record. All of it comes from the row the list already has. */
  it('reads the workflow spine from the row it was given',()=>{
    const days=(n:number)=>new Date(Date.now()-n*86_400_000).toISOString()
    renderPane(row({
      open_job_count:2,primary_job_title:'Backend Engineer',primary_stage_name:'Interview',
      primary_stage_entered_at:days(12),last_activity_at:days(6),
      next_task_at:days(2),next_task_title:'Call back',availability:'1_month',
    } as Partial<CandidateSearchRow>))
    expect(screen.getByText('Backend Engineer +1 more')).toBeInTheDocument()
    expect(screen.getByText('Interview · 12d')).toBeInTheDocument()
    expect(screen.getByText('6d ago')).toBeInTheDocument()
    expect(screen.getByText('Call back · 2 days late')).toBeInTheDocument()
    expect(screen.getByText('1 month')).toBeInTheDocument()
  })

  /* The RLS-degraded shape: a member with candidates.read but not jobs.read/tasks.read/activities.read
   * gets nulls. The pane must state absence, never render a half-built pipeline line, and never imply
   * the facts do not exist -- they may simply be invisible to this member. */
  it('states absence rather than inventing a pipeline when the columns degraded',()=>{
    renderPane(row({
      open_job_count:0,primary_job_title:null,primary_stage_name:null,primary_stage_entered_at:null,
      last_activity_at:null,next_task_at:null,next_task_title:null,
    } as Partial<CandidateSearchRow>))
    expect(screen.getByText('Not in a pipeline')).toBeInTheDocument()
    expect(screen.getByText('None logged')).toBeInTheDocument()
    expect(screen.getByText('No follow-up set')).toBeInTheDocument()
    expect(screen.queryByText('Stage')).not.toBeInTheDocument()
  })
})
