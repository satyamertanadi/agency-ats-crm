import {useState} from 'react'
import {BriefcaseBusiness,Plus,Search,Trash2} from 'lucide-react'
import {Avatar} from '../../shared/ui/Avatar'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Badge,Page,Panel} from '../../shared/ui/Page'
import {Table} from '../../shared/ui/Table'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {ReviewCandidate,ReviewHeader} from '../submissions/PublicReviewPage'
import type {PublicReview,PublicSubmission} from '../../shared/types/domain'
import './styleguide.css'

/**
 * Dev-only design system specimen. Never routed in production (see App.tsx).
 *
 * This is the instrument for the design revamp: it renders every primitive with no auth and no
 * database, which is the only way to verify the system while local Supabase is unavailable. Each
 * section carries a stable `id` so Playwright can snapshot sections individually — snapshotting
 * the whole page produces one enormous image that every token change invalidates, which trains
 * everyone to rubber-stamp --update-snapshots.
 */

const TEXT_TOKENS=['--text-2xs','--text-xs','--text-sm','--text-base','--text-md','--text-lg','--text-xl','--text-2xl','--text-3xl','--text-4xl','--text-5xl']
const WEIGHT_TOKENS=['--weight-regular','--weight-medium','--weight-semibold','--weight-bold']
const PRIMITIVES=['--color-ink','--color-ink-soft','--color-muted','--color-faint','--color-canvas','--color-canvas-deep','--color-surface','--color-surface-soft','--color-line-soft','--color-line','--color-line-strong','--color-accent','--color-accent-hover','--color-accent-soft','--color-accent-on-dark','--color-info','--color-violet','--color-mist','--color-steel','--color-slate','--color-slate-deep','--color-sidebar','--color-sidebar-deep']
const TONES=['neutral','good','warn','bad','info'] as const
const RADII=['--radius-xs','--radius-sm','--radius-md','--radius-lg','--radius-pill']
const SHADOWS=['--shadow-xs','--shadow-sm','--shadow-md','--shadow-lg']
const SPACES=['--space-05','--space-1','--space-15','--space-2','--space-3','--space-4','--space-5','--space-6','--space-8','--space-10']

const computed=(token:string)=>typeof window==='undefined'?'':getComputedStyle(document.documentElement).getPropertyValue(token).trim()
const px=(token:string)=>{const v=computed(token);if(!v)return '—';if(v.endsWith('rem'))return `${parseFloat(v)*16}px`;return v}

const fixtureCandidate:PublicSubmission={
  submission_id:'sg-1',
  candidate_name:'Aisha Rahman',
  current_company:'SunGrid Energy',
  current_position:'Commercial Director, South East Asia',
  location:'Singapore',
  linkedin_url:null,portfolio_url:null,
  candidate_summary:'Fifteen years building commercial teams across renewables in South East Asia, most recently owning a $40M P&L at SunGrid. Led the Indonesian market entry end to end — hiring the first eight commercial staff, closing the anchor utility contract, and taking the region to profitability in under two years. Wants a step up into a regional MD seat with full P&L ownership.',
  recruiter_comments:'Strongest commercial profile we have seen for this mandate.',
  suitability_assessment:'Directly relevant market-entry experience and an existing network with the two utilities the client is targeting. Has run a team of this size before. The only gap is listed-company reporting exposure, which the client indicated is a nice-to-have rather than essential.',
  relevant_experience:null,
  expected_salary:512500000,currency:'IDR',
  notice_period:'3 months',availability:'From April 2026',
  motivation:null,relocation_willingness:null,interview_availability:null,
  feedback:null,
}
const fixturePackage:PublicReview['package']={
  id:'sg-pkg',title:'Regional Commercial Director — Shortlist',message:'Three candidates for your review ahead of Thursday. Each has confirmed availability for a first-round conversation next week.',
  job_title:'Regional Commercial Director',company_name:'Tirta Surya Energi',recipient_name:'Budi Santoso',expires_at:'2026-08-01T00:00:00Z',
}
const fixtureDocuments:PublicReview['documents']=[
  {id:'d1',filename:'Aisha-Rahman-CV.pdf',mimeType:'application/pdf',url:'#'},
  {id:'d2',filename:'Shortlist-summary.pdf',mimeType:'application/pdf',url:'#'},
]
// No logo_path: the initials fallback is the case worth specimen-ing, since most agencies will
// not have uploaded a logo on day one. The accent is a non-default colour on purpose -- if the
// header only ever renders in the product's own green, the white-labelling is untested.
const fixtureBranding:PublicReview['branding']={organization_name:'Samara Search',primary_color:'#2f4858',logo_path:null}

function Section({id,title,note,children}:{id:string;title:string;note?:string;children:React.ReactNode}){
  return <section id={id} className="sg-section">
    <header className="sg-section-header"><h2>{title}</h2>{note&&<p>{note}</p>}</header>
    <div className="sg-section-body">{children}</div>
  </section>
}

export function StyleguidePage(){
  const [tab,setTab]=useState('all')
  return <div className="sg">
    <header className="sg-masthead">
      <p className="eyebrow">Design system</p>
      <h1>Agency ATS specimen</h1>
      <p>Every primitive, rendered from the real components. Dev-only — never shipped.</p>
    </header>

    <Section id="type-scale" title="Type scale" note="Bottom rungs step 1px linearly; top rungs step modularly. Serif is display-only — nothing at --text-md or below uses it.">
      <div className="sg-type-list">
        {TEXT_TOKENS.map((token)=><div className="sg-type-row" key={token}>
          <code>{token}</code><span className="sg-type-px">{px(token)}</span>
          <p style={{fontSize:`var(${token})`}} className="sg-type-sans">Shortlist ready for review</p>
          <p style={{fontSize:`var(${token})`,fontFamily:'var(--font-editorial)'}} className="sg-type-serif">Shortlist ready for review</p>
        </div>)}
      </div>
    </Section>

    <Section id="weights" title="Weights" note="Four tokens replace eleven ad-hoc values. At 13–14px, 600 carries more weight than 750 did at 11.5px.">
      <div className="sg-weight-list">
        {WEIGHT_TOKENS.map((token)=><div className="sg-weight-row" key={token}>
          <code>{token}</code><span className="sg-type-px">{computed(token)||'—'}</span>
          <p style={{fontWeight:`var(${token})`}}>Commercial Director</p>
          <p style={{fontWeight:`var(${token})`,fontFamily:'var(--font-editorial)'}}>Commercial Director</p>
        </div>)}
      </div>
    </Section>

    <Section id="colors" title="Colour" note="Primitives, then the five tone triplets rendered as badge + box + chip together — the mismatch is visible here or nowhere.">
      <div className="sg-swatches">
        {PRIMITIVES.map((token)=><div className="sg-swatch" key={token}>
          <span style={{background:`var(${token})`}}/><code>{token}</code><small>{computed(token)||'—'}</small>
        </div>)}
      </div>
      <h3 className="sg-sub">Tone triplets</h3>
      <div className="sg-tones">
        {TONES.map((tone)=><div className="sg-tone" key={tone}>
          <Badge tone={tone==='neutral'?'neutral':tone}>{tone}</Badge>
          <div className="sg-tone-box" style={{background:`var(--tone-${tone}-bg)`,color:`var(--tone-${tone}-fg)`,borderColor:`var(--tone-${tone}-border)`}}>
            Tone box — {tone}
          </div>
          <span className="sg-tone-chip" style={{background:`var(--tone-${tone}-bg)`,color:`var(--tone-${tone}-fg)`,borderColor:`var(--tone-${tone}-border)`}}>chip</span>
        </div>)}
      </div>
    </Section>

    <Section id="primitives" title="Radius, shadow, spacing">
      <div className="sg-radii">{RADII.map((token)=><div className="sg-radius" key={token}><span style={{borderRadius:`var(${token})`}}/><code>{token}</code><small>{computed(token)||'—'}</small></div>)}</div>
      <div className="sg-shadows">{SHADOWS.map((token)=><div className="sg-shadow" key={token}><span style={{boxShadow:`var(${token})`}}/><code>{token}</code></div>)}</div>
      <div className="sg-spaces">{SPACES.map((token)=><div className="sg-space" key={token}><span style={{width:`var(${token})`,height:`var(${token})`}}/><code>{token}</code><small>{computed(token)||'—'}</small></div>)}</div>
    </Section>

    <Section id="buttons" title="Buttons" note="5 variants x 3 sizes, plus loading / disabled / icon states.">
      <div className="sg-grid">
        {(['primary','secondary','caution','danger','quiet'] as const).map((variant)=><div className="sg-row" key={variant}>
          <code>{variant}</code>
          <Button variant={variant} size="sm">Small</Button>
          <Button variant={variant}>Medium</Button>
          <Button variant={variant} size="lg">Large</Button>
          <Button variant={variant} leadingIcon={<Plus size={14}/>}>With icon</Button>
          <Button variant={variant} loading>Loading</Button>
          <Button variant={variant} disabled>Disabled</Button>
          <Button variant={variant} iconOnlyLabel="Delete"><Trash2 size={14}/></Button>
        </div>)}
      </div>
    </Section>

    <Section id="forms" title="Forms">
      <div className="form-grid">
        <Field label="Full name"><Input defaultValue="Aisha Rahman"/></Field>
        <Field label="Status"><Select defaultValue="active"><option value="active">Active</option><option value="passive">Passive</option></Select></Field>
        <Field label="With error" error="Enter a valid email address."><Input defaultValue="not-an-email"/></Field>
        <div className="full"><Field label="Summary"><Textarea rows={3} defaultValue="Fifteen years building commercial teams across renewables."/></Field></div>
      </div>
    </Section>

    <Section id="badges" title="Badges" note="Rendered standalone AND inside a <td> — the table cell is where the specificity bug lives.">
      <div className="sg-row">{TONES.map((tone)=><Badge tone={tone} key={tone}>{tone}</Badge>)}</div>
      <Table headers={['Candidate','Status','Priority']}>
        <tr><td><strong>Aisha Rahman</strong><span>Commercial Director</span></td><td><Badge tone="good">Active</Badge></td><td><Badge tone="warn">High</Badge></td></tr>
        <tr><td><strong>Daniel Wong</strong><span>Regional Sales Lead</span></td><td><Badge tone="neutral">Passive</Badge></td><td><Badge tone="bad">Urgent</Badge></td></tr>
      </Table>
    </Section>

    <Section id="panels" title="Panels">
      <div className="two-column">
        <Panel title="Flat panel" subtitle="Default elevation and tone.">
          <div className="sg-pad">Body content.</div>
        </Panel>
        <Panel title="Raised panel" subtitle="elevation=raised" elevation="raised" action={<Button variant="secondary" size="sm">Action</Button>}>
          <div className="sg-pad">Body content with a header action.</div>
        </Panel>
      </div>
    </Section>

    <Section id="table" title="Table" note="Two-line cells with <span> sub-lines — the real pattern used across the app.">
      <Panel>
        <Table headers={['Vacancy','Client','Location','Status']}>
          {[['Regional Commercial Director','Tirta Surya Energi','Makassar','Open'],['Head of Brand Marketing','Sembada Pangan Indonesia','Bali','Open'],['Plant Engineering Manager','Bumirakit Manufaktur','Bandung','On hold']].map((r)=>
            <tr key={r[0]}><td><strong>{r[0]}</strong><span>Opened 15/07/2026</span></td><td>{r[1]}</td><td>{r[2]}</td><td><Badge tone={r[3]==='Open'?'good':'warn'}>{r[3]}</Badge></td></tr>)}
        </Table>
      </Panel>
    </Section>

    <Section id="states" title="States">
      <div className="sg-grid-3">
        <Panel><LoadingState label="Preparing today's agency priorities…"/></Panel>
        <Panel><EmptyState title="No placements" description="Convert a successful candidate and vacancy into a commercial outcome." action={<Button size="sm">Record placement</Button>}/></Panel>
        <Panel><ErrorState error={new Error('Could not load this view')}/></Panel>
      </div>
    </Section>

    <Section id="page-header" title="Page header" note="The eyebrow -> h1 -> description ramp. This is the ratio being fixed.">
      <div className="sg-inset">
        <Page title="Candidates" eyebrow="Talent database" description="Search, own, document, detect duplicates, and manage candidate relationships before or after a vacancy exists."
          metadata={<><Badge tone="neutral">40 candidates</Badge><Badge tone="info">2 duplicates</Badge></>}
          actions={<><Button variant="secondary">Import</Button><Button leadingIcon={<Plus size={14}/>}>Add candidate</Button></>}
          tabs={<><button className={tab==='all'?'active':''} onClick={()=>setTab('all')}>All</button><button className={tab==='mine'?'active':''} onClick={()=>setTab('mine')}>Mine</button></>}>
          <Panel><div className="sg-pad">Page content sits here.</div></Panel>
        </Page>
      </div>
    </Section>

    <Section id="kpi" title="KPI grid" note="Six-up. Watch the label width at --tracking-caps.">
      <div className="kpi-grid">
        {[['Active vacancies','12'],['Candidates','40'],['Overdue actions','3'],['Interviews / 7d','5'],['Offers in progress','2'],['Placement fees / YTD','IDR 512.5M']].map(([label,value],i)=>
          <div className={`kpi ${i===2?'kpi-alert':''}`} key={label}><span><BriefcaseBusiness/></span><div><p>{label}</p><strong>{value}</strong></div></div>)}
      </div>
    </Section>

    <Section id="kanban" title="Kanban" note="Column + candidate card. Restraint is the design here.">
      <div className="kanban" style={{minHeight:'auto'}}>
        {['Shortlisted','Submitted to Client','Interview Scheduled'].map((col)=><div className="kanban-column" key={col} style={{minHeight:220}}>
          <header><strong>{col}</strong><Badge tone="neutral">2</Badge></header>
          {['Aisha Rahman','Daniel Wong'].map((n)=><article className="candidate-card" key={n}><strong>{n}</strong><span>Commercial Director · SunGrid</span></article>)}
        </div>)}
      </div>
    </Section>

    <Section id="review-card" title="Client review page" note="The real ReviewHeader + ReviewCandidate against fixtures, white-labelled to a non-default agency accent. This is the surface the agency's client actually opens.">
      {/* No router wrapper: ReviewCandidate/ReviewHeader use no router hooks (only PublicReviewPage
          calls useParams), and nesting a Router inside the app's BrowserRouter throws. */}
      <div className="sg-inset review-page">
        <ReviewHeader pkg={fixturePackage} documents={fixtureDocuments} branding={fixtureBranding}/>
        <section className="review-grid"><ReviewCandidate token="styleguide-fixture" candidate={fixtureCandidate}/></section>
      </div>
    </Section>

    <Section id="misc" title="Avatar & search">
      <div className="sg-row">
        <Avatar name="Satya Berdikari" size="sm"/><Avatar name="Aisha Rahman"/><Avatar name="Daniel Wong" size="lg"/>
        <div className="search-box" style={{maxWidth:320}}><Search size={16}/><Input className="input" placeholder="Name, company, or position"/></div>
      </div>
    </Section>
  </div>
}
