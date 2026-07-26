import {AlertTriangle} from 'lucide-react'
import type {ReactNode} from 'react'
import type {UseFormReturn} from 'react-hook-form'
import type {z} from 'zod'
import {candidateFormSchema} from '../core/schemas'
import {candidateStatus,consentStatus} from '../../shared/lib/status'
import {currencyOptions} from '../../shared/lib/currencies'
import {Field,Input,Select} from '../../shared/ui/Field'

export type CandidateFormInput=z.input<typeof candidateFormSchema>
export type CandidateFormOutput=z.output<typeof candidateFormSchema>
/* 'cv-review' differs from the other two in exactly one way: `accept_candidate_cv_parse` writes the
 * extraction, and the extraction has no ownership or consent columns, so offering those fields there
 * would collect values the save then silently drops. Everything else is identical across the three
 * hosts by design -- the whole point of this component is that the form you get is not a function of
 * how you arrived at it. */
export type CandidateFormMode='create'|'cv-review'|'edit'
export interface CandidateOwnerOption {id:string;label:string}

export type CandidateFormProps={
  /* The form object is owned by the host, not by this component. Each host submits to a different
   * mutation (insert / update_candidate_profile / accept parse), needs its own defaults, and reads
   * `formState.isDirty` for its own dirty guard -- so the state belongs where those live, and this
   * stays a rendering of it. */
  form:UseFormReturn<CandidateFormInput,unknown,CandidateFormOutput>
  mode?:CandidateFormMode
  owners?:readonly CandidateOwnerOption[]
  /* Salary inputs are per-period, and the period is a workspace setting. Labelling them "Expected
   * salary" alone is how a monthly-quoting agency ends up with annual figures in the column. */
  salaryPeriod?:'annual'|'monthly'|null
  baseCurrency?:string|null
  /* CV review only: given a schema field path, whether the parser flagged that value as low
   * confidence. Passing it is what finally wires `confidenceFor`, which has existed and gone unused. */
  lowConfidence?:(field:keyof CandidateFormInput)=>boolean
  disabled?:boolean
}

/* Every candidate form in the product, in four named sections.
 *
 * There were three forms over this record with three different field sets (9 / ~20 / 19 fields), and
 * the richest one was the one you reached by having a CV parse fail. Consolidating them is mostly
 * about what manual entry could not previously set at all: owner, status, consent and currency, each
 * of which had to be fixed on a second visit to the record -- or, in currency's case, was never
 * noticed.
 *
 * The sections are not decoration. Nineteen fields in one grid is a wall; grouped as who they are,
 * how you reach them, how you will work them, and money, it is four short lists in the order a
 * consultant actually learns these facts. */
export function CandidateForm({form,mode='create',owners=[],salaryPeriod,baseCurrency,lowConfidence,disabled=false}:CandidateFormProps){
  const {register,formState:{errors}}=form
  const periodLabel=salaryPeriod==='monthly'?'month':'year'
  /* The status maps are written for badges, where a chip reading just "Granted" out of context is
   * ambiguous -- so they carry the noun ("Consent granted"). Inside a select that already has a
   * "Consent" label the noun repeats, so it is dropped here rather than duplicating the wording in a
   * second place, which is the thing labels.ts and these maps exist to prevent. */
  const consentLabel=(label:string)=>label.replace(/^Consent /,'').replace(/^./,(first)=>first.toUpperCase())
  /* Ownership, status and consent are all writes on columns the parse-accept path does not touch. */
  const showsOwnership=mode!=='cv-review'
  const currencies=currencyOptions(baseCurrency)

  return <div className="candidate-form">
    <section className="candidate-form-section">
      <h3>Who they are</h3>
      <div className="form-grid">
        <FormField label="Full name" error={errors.full_name?.message} low={lowConfidence?.('full_name')} className="full">
          {/* Autofocused only when this form is the reason the dialog opened. In CV review the eye
            * belongs on the flagged values, and on the detail page focus has already been placed. */}
          <Input autoFocus={mode==='create'} disabled={disabled} {...register('full_name')}/>
        </FormField>
        <FormField label="Current company" low={lowConfidence?.('current_company')}><Input disabled={disabled} {...register('current_company')}/></FormField>
        <FormField label="Current position" low={lowConfidence?.('current_position')}><Input disabled={disabled} {...register('current_position')}/></FormField>
        <FormField label="Location" low={lowConfidence?.('location')}><Input disabled={disabled} {...register('location')}/></FormField>
        <FormField label="LinkedIn" error={errors.linkedin_url?.message}><Input type="url" placeholder="https://linkedin.com/in/…" disabled={disabled} {...register('linkedin_url')}/></FormField>
        <FormField label="Portfolio" error={errors.portfolio_url?.message}><Input type="url" disabled={disabled} {...register('portfolio_url')}/></FormField>
      </div>
    </section>

    <section className="candidate-form-section">
      <h3>Reaching them</h3>
      <div className="form-grid">
        <FormField label="Email" error={errors.email?.message} low={lowConfidence?.('email')}><Input type="email" disabled={disabled} {...register('email')}/></FormField>
        <FormField label="Phone" low={lowConfidence?.('phone')}><Input type="tel" disabled={disabled} {...register('phone')}/></FormField>
        {showsOwnership&&<>
          {/* Consent belongs beside the contact details, not in a compliance section of its own:
            * it is the answer to "may I use these", and asking at the moment the number is typed is
            * the only time the consultant actually knows. Defaulting to 'unknown' and fixing it later
            * is how every hand-entered candidate ended up flagged as a compliance gap. */}
          <FormField label="Consent status">
            <Select disabled={disabled} {...register('consent_status')}>
              {Object.entries(consentStatus).map(([value,item])=><option key={value} value={value}>{consentLabel(item.label)}</option>)}
            </Select>
          </FormField>
          <FormField label="Consent expires"><Input type="date" disabled={disabled} {...register('consent_expires_at')}/></FormField>
        </>}
        <p className="candidate-form-note muted full">Email, phone and salary stay behind the candidate-private permission boundary — teammates without it see this candidate, but not these fields.</p>
      </div>
    </section>

    <section className="candidate-form-section">
      <h3>How you will work them</h3>
      <div className="form-grid">
        {showsOwnership&&<>
          <FormField label="Owner">
            <Select disabled={disabled} {...register('owner_member_id')}>
              <option value="">Unassigned</option>
              {owners.map((owner)=><option key={owner.id} value={owner.id}>{owner.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Status">
            <Select disabled={disabled} {...register('status')}>
              {Object.entries(candidateStatus).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}
            </Select>
          </FormField>
        </>}
        <FormField label="Source" low={lowConfidence?.('source')}><Input placeholder="Referral, LinkedIn, job board…" disabled={disabled} {...register('source')}/></FormField>
        <FormField label="Availability" low={lowConfidence?.('availability')}><Input placeholder="Immediately, from March…" disabled={disabled} {...register('availability')}/></FormField>
        <FormField label="Notice period (days)" error={errors.notice_period_days?.message} low={lowConfidence?.('notice_period_days')}><Input type="number" min="0" disabled={disabled} {...register('notice_period_days')}/></FormField>
        <FormField label="Work authorization"><Input disabled={disabled} {...register('work_authorization')}/></FormField>
      </div>
    </section>

    <section className="candidate-form-section">
      <h3>Money</h3>
      <div className="form-grid">
        <FormField label={`Current salary (per ${periodLabel})`} error={errors.current_salary?.message}><Input type="number" min="0" disabled={disabled} {...register('current_salary')}/></FormField>
        <FormField label={`Expected salary (per ${periodLabel})`} error={errors.expected_salary?.message} low={lowConfidence?.('expected_salary')}><Input type="number" min="0" disabled={disabled} {...register('expected_salary')}/></FormField>
        {/* Was a free-text 3-character input in two of the three forms and absent from the third. */}
        <FormField label="Currency" error={errors.salary_currency?.message}>
          <Select disabled={disabled} {...register('salary_currency')}>
            {currencies.map((option)=><option key={option.code} value={option.code}>{option.code} — {option.name}</option>)}
          </Select>
        </FormField>
      </div>
    </section>
  </div>
}

/* Field plus the two annotations that were previously hand-repeated per call site: the resolver error
 * and the parser's low-confidence marker, which had a `confidenceFor` helper but no row ever rendered
 * it. */
function FormField({label,error,low,className,children}:{label:string;error?:string;low?:boolean;className?:string;children:ReactNode}){
  const field=<Field label={label} error={error}>{children}{low&&<small className="cv-low-confidence"><AlertTriangle size={11}/>Low confidence — check this value</small>}</Field>
  return className?<div className={className}>{field}</div>:field
}
