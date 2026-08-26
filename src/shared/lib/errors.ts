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
  // Talent lists. A name collides only against the caller's OWN live lists, which is why the sentence
  // can say "you" -- a colleague's list of the same name is not what was hit.
  duplicate_list_name:'You already have a talent list with that name.',
  invalid_visibility:'A talent list is either private to you or shared with the workspace.',
  /* Raised by log_activity_with_follow_up when the activity is linked only to records a task cannot
   * point at. The follow-up is meant to be attached to the record you just wrote about, so an
   * unattached one is refused rather than created and left linking nowhere. */
  follow_up_link_required:'A follow-up has to be attached to a candidate, client, contact, or job.',
  authentication_required:'Sign in again to continue.',
  service_role_required:'This action can only run on the server.',
  google_auth_required:'Connect your Google account first.',
  owner_must_sign_in_first:'The workspace owner has to sign in before this can be set up.',
  email_mismatch:'That email does not match the invitation.',
  invitation_email_mismatch:'Sign in with the exact email the invitation was sent to.',
  // Records not found, or belonging to another workspace
  organization_not_found:'That workspace could not be found.',
  candidate_not_found:'That candidate could not be found in this workspace.',
  /* Raised by add_candidates_to_list when any id in the batch is not a live candidate in the list's
   * own workspace. The sentence names the batch rather than the record, because the whole batch is
   * refused: a partial write would turn a cross-tenant id into a number in a toast nobody reads. */
  candidate_not_in_organization:'Some of those candidates are not in this workspace, so nothing was added.',
  company_not_found:'That client could not be found in this workspace.',
  contact_not_found:'That contact could not be found in this workspace.',
  job_not_found:'That job could not be found in this workspace.',
  member_not_found:'That team member could not be found.',
  placement_not_found:'That placement could not be found.',
  delivery_not_found:'That email delivery could not be found.',
  interview_not_found:'That interview could not be found in this workspace.',
  default_pipeline_not_found:'This workspace has no default recruitment pipeline.',
  invitation_not_found:'That invitation could not be found.',
  template_not_found:'That template could not be found.',
  link_not_found:'That link is no longer valid.',
  parse_not_found:'That CV upload could not be found.',
  profile_version_not_found:'That profile version could not be found.',
  // Workflow state
  job_not_open:'This job is not open, so recruitment actions are read-only.',
  job_already_placed:'This vacancy already has a placement. Create a separate job record for another hire.',
  interview_not_cancellable:'Only a scheduled or already-cancelled interview can be cancelled.',
  default_pipeline_stage_in_use:'The default pipeline could not be simplified because one of its stages is already in use.',
  manual_placement_reconciliation_required:'Existing placement records need an administrator to resolve them before this change can continue.',
  candidate_not_due_for_retention:'This candidate does not yet meet the retention policy rules.',
  retention_storage_changed:'Candidate files changed during retention. The safe cleanup will retry.',
  audit_logs_are_immutable:'Audit history cannot be changed or deleted.',
  candidate_already_in_job:'This candidate is already in that job.',
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
  recipient_email_required:'Enter the recipient email.',
  legal_hold_reason_required:'Record why this legal hold is changing.',
  candidate_private_details_not_found:'This candidate has no private record to place on legal hold.',
  task_title_required:'Enter a follow-up title.',
  request_key_required:'Retry this action from the open form.',
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
  invalid_owner:'Choose an active team member in this workspace.',
  invalid_profile_list:'The candidate profile details are not valid.',
  invalid_profile_lists:'The candidate profile details are not valid.',
  invalid_profile_section:'Choose a valid candidate profile section.',
  invalid_task_link:'Choose one valid record for this follow-up.',
  invalid_initial_stage:'That stage does not belong to this job’s pipeline.',
  invalid_activity_type:'Choose a valid activity type.',
  invalid_direction:'Choose whether this was inbound, outbound, or internal.',
  invalid_role:'Choose a valid role.',
  invalid_delivery_status:'That email delivery status is not valid.',
  unsupported_access_audit_table:'That access change could not be audited safely.',
  invalid_kind:'That type is not supported.',
  invalid_bd_stage:'Choose a valid business-development stage.',
  invalid_approval_status:'Choose a valid approval status.',
  invalid_template_name:'Give the template a name.',
  invalid_template_configuration:'That template layout is not valid.',
  invalid_profile_content:'That profile content is not valid.',
  invalid_profile_scope:'That profile does not match this candidate and job.',
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
