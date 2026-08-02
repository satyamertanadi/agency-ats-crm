export class AppError extends Error {
  constructor(
    message: string,
    public readonly code = 'unexpected_error',
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/* The security-definer RPCs signal refusals by raising bare snake_case identifiers -- `raise exception
 * 'invalid_nonnegative_value'` -- because a stable machine-readable token is the right thing for a
 * database function to raise. The mistake was downstream: both repositories build their AppError from
 * `error.message`, so those tokens travelled unchanged into red text in front of a consultant.
 *
 * This is the one place they become sentences. Keyed by what the migrations actually raise (collected
 * from `raise exception '...'` across supabase/migrations), so a token added later without an entry
 * here falls back to the caller's own fallback string rather than leaking.
 *
 * Wording rules, as everywhere else: say what did not happen and what would make it work, never name a
 * column or a constraint, never apologise. */
const rpcMessages:Record<string,string>={
  // Authorization and identity
  permission_denied:'Your role does not allow this action.',
  authentication_required:'Sign in again to continue.',
  service_role_required:'This action can only run on the server.',
  google_auth_required:'Connect your Google account first.',
  owner_must_sign_in_first:'The workspace owner has to sign in before this can be set up.',
  email_mismatch:'That email does not match the invitation.',
  invitation_email_mismatch:'Sign in with the exact email the invitation was sent to.',
  seat_limit_reached:'Every seat in this workspace is taken. Free one up or raise the seat limit first.',
  // Records not found, or belonging to another workspace
  organization_not_found:'That workspace could not be found.',
  candidate_not_found:'That candidate could not be found in this workspace.',
  company_not_found:'That client could not be found in this workspace.',
  contact_not_found:'That contact could not be found in this workspace.',
  job_not_found:'That job could not be found in this workspace.',
  member_not_found:'That team member could not be found.',
  placement_not_found:'That placement could not be found.',
  referral_not_found:'That referral could not be found.',
  template_not_found:'That template could not be found.',
  link_not_found:'That link is no longer valid.',
  parse_not_found:'That CV upload could not be found.',
  profile_version_not_found:'That profile version could not be found.',
  interview_notes_not_found:'Those interview notes could not be found.',
  // Workflow state
  job_not_open:'This job is not open, so recruitment actions are read-only.',
  candidate_already_in_job:'This candidate is already in that job.',
  referral_not_pending:'This referral has already been dealt with.',
  profile_version_already_finalized:'This profile version is already finalised.',
  parse_expired:'This CV upload expired. Upload the file again.',
  parse_not_ready:'The CV is still being read. Wait for it to finish.',
  candidate_target_mismatch:'This CV belongs to a different candidate.',
  same_candidate:'Pick two different records to merge.',
  merge_conflicting_job_assignments:'These candidates are in the same job at different stages. Resolve that first.',
  last_template_required:'Keep at least one template available.',
  rate_limited:'Too many attempts. Wait a moment and try again.',
  // Required input
  candidate_required:'Choose a candidate.',
  candidate_name_required:'Enter the candidate’s name.',
  company_required:'Choose a client.',
  full_name_required:'Enter a full name.',
  summary_required:'Write what happened.',
  owner_email_required:'Enter the owner’s email.',
  link_required:'A link is required.',
  distinct_profile_documents_required:'The Word and PDF files have to be different documents.',
  // Rejected input
  invalid_email:'Enter a valid email address.',
  invalid_expiry:'Choose an expiry between 1 and 30 days.',
  invalid_submission:'Add a title and at least one candidate.',
  invalid_submission_document:'One of the chosen documents does not belong to that candidate.',
  invalid_nonnegative_value:'Amounts cannot be negative.',
  invalid_percentage:'Enter a percentage between 0 and 100.',
  invalid_fee_percentage:'Enter a fee percentage between 0 and 100.',
  invalid_fixed_fee:'Enter a valid fixed fee.',
  invalid_fee_type:'Choose either a percentage or a fixed fee.',
  invalid_fee_source:'Choose where this fee came from.',
  invalid_skill_experience:'Enter a valid number of years.',
  invalid_initial_stage:'That stage does not belong to this job’s pipeline.',
  invalid_activity_type:'Choose a valid activity type.',
  invalid_direction:'Choose whether this was inbound, outbound, or internal.',
  invalid_role:'Choose a valid role.',
  invalid_kind:'That type is not supported.',
  invalid_bd_stage:'Choose a valid business-development stage.',
  invalid_approval_status:'Choose a valid approval status.',
  invalid_template_name:'Give the template a name.',
  invalid_template_configuration:'That template layout is not valid.',
  invalid_profile_content:'That profile content is not valid.',
  invalid_profile_scope:'That profile does not match this candidate and job.',
  invalid_interview_notes_content:'These interview notes need a summary before they can be accepted.',
  invalid_interview_scope:'Those interview notes do not belong to this interview.',
  invalid_docx_document:'That Word document is not valid.',
  invalid_pdf_document:'That PDF is not valid.',
  occurred_at_in_future:'An activity cannot be logged in the future.',
  comments_too_long:'Shorten the comments and try again.',
  reviewer_name_too_long:'Shorten the reviewer name and try again.',
}

/* `duplicate_candidate:<uuid>` is the one token carrying a payload -- the id of the record it collided
 * with -- so it is matched by prefix and the id is kept on the error, for a caller that wants to offer
 * "open the existing record" rather than just reporting the collision. */
export const DUPLICATE_CANDIDATE='duplicate_candidate'

export interface HumanizedRpcError {message:string;code:string;recordId?:string}

export function humanizeRpcError(rawMessage:string):HumanizedRpcError|null{
  const trimmed=rawMessage.trim()
  const direct=rpcMessages[trimmed]
  if(direct)return {message:direct,code:trimmed}
  if(trimmed.includes(DUPLICATE_CANDIDATE)){
    const id=trimmed.split(`${DUPLICATE_CANDIDATE}:`)[1]?.trim().split(/[\s"']/)[0]
    return {message:'A candidate with this email already exists.',code:DUPLICATE_CANDIDATE,recordId:id||undefined}
  }
  /* Substring matching, because plpgsql context lines and PostgREST wrapping mean an identifier can
   * arrive embedded rather than alone -- better to recognise a known token inside a longer string than
   * to hand the whole string to the user. */
  const found=Object.keys(rpcMessages).find((key)=>trimmed.includes(key))
  const message=found?rpcMessages[found]:undefined
  return found&&message?{message,code:found}:null
}

export function toAppError(error: unknown, fallback = 'Something went wrong.'): AppError {
  if (error instanceof AppError) return error
  if (error instanceof Error) return new AppError(error.message || fallback, 'unexpected_error', error)
  return new AppError(fallback, 'unexpected_error', error)
}
