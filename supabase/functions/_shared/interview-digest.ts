/* Rendering the daily owner brief.
 *
 * Pure, and separate from the sender, so the thing that decides what an owner reads can be tested
 * without a database, a mail provider or an environment. The sender imports env at module load; a
 * test that had to pull it in to check a subject line would be testing the wrong thing.
 *
 * The rule this module exists to hold: the digest is counts and fixed vocabulary. No transcript
 * quotes, no candidate answers, no email, no phone, no salary, and no model-authored sentences. An
 * email is forwarded, stored unencrypted and read by whoever picks up the phone, which makes it the
 * worst possible place for a sentence about a named colleague's interview technique.
 */

export interface DigestContent {
  analysed_interviews:number
  attention_findings:number
  processing_failures:number
  themes:{dimension:string;interviews:number}[]
  candidate_fit:{band:string;interviews:number}[]
  coaching:{open:number;acknowledged:number;overdue:number}
}

export interface DigestLinks {
  organizationName:string
  reportDate:string
  /* Links into the ATS, which is where the evidence lives behind authentication. Null when the app
   * URL is not configured -- a brief with no links is still useful, and a broken link in an email
   * nobody can fix is not. */
  scorecardUrl:string|null
  todayUrl:string|null
}

const DIMENSION_LABELS:Record<string,string>={
  essential_coverage:'Essential coverage',
  question_quality:'Question quality',
  listening_balance:'Listening balance',
  role_presentation:'Role presentation',
  next_step_clarity:'Next-step clarity',
}

const BAND_LABELS:Record<string,string>={
  strong_evidence_of_fit:'Strong evidence of fit',
  promising_but_incomplete:'Promising but incomplete',
  material_concerns:'Material concerns',
  clear_mismatch:'Clear mismatch',
  insufficient_evidence:'Insufficient evidence',
}

export function dimensionLabel(value:string){return DIMENSION_LABELS[value]??value}
export function bandLabel(value:string){return BAND_LABELS[value]??value}

/* Escaped even though every value is a count or a term from a fixed vocabulary. The workspace name
 * is not: it is typed by a person, and it goes into the same HTML. */
export function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,(character)=>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[character]??character)
}

/* A subject line that says whether the brief needs opening.
 *
 * "Interview quality" alone is a subject somebody learns to ignore by the second week. The count of
 * things actually waiting on a person goes in front, so a day with nothing outstanding reads
 * differently from a day with nine in the inbox list itself. */
export function digestSubject(content:DigestContent,reportDate:string):string{
  const waiting=content.attention_findings+content.coaching.overdue
  if(waiting>0)return `Interview brief · ${waiting} needing attention · ${reportDate}`
  return `Interview brief · ${content.analysed_interviews} analysed · ${reportDate}`
}

const row=(label:string,value:number|string)=>
  `<tr><td style="padding:6px 0;color:#444">${escapeHtml(label)}</td>`
  +`<td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(String(value))}</td></tr>`

export function renderDigestHtml(content:DigestContent,links:DigestLinks):string{
  const themes=content.themes.length
    ? content.themes.map((theme)=>row(dimensionLabel(theme.dimension),`${theme.interviews} interviews`)).join('')
    : `<tr><td colspan="2" style="padding:6px 0;color:#666">No recurring themes in this period.</td></tr>`

  const bands=content.candidate_fit.length
    ? content.candidate_fit.map((entry)=>row(bandLabel(entry.band),entry.interviews)).join('')
    : `<tr><td colspan="2" style="padding:6px 0;color:#666">No candidate assessments in this period.</td></tr>`

  /* Single column, generous type, tables for layout. Read on a phone, in a mail client with no CSS
   * support worth relying on. */
  const linkLine=[
    links.scorecardUrl?`<a href="${escapeHtml(links.scorecardUrl)}" style="color:#287A72">Open the scorecard</a>`:null,
    links.todayUrl?`<a href="${escapeHtml(links.todayUrl)}" style="color:#287A72">Review what needs attention</a>`:null,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ')

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#111">
<h1 style="font-size:19px;margin:0 0 4px">Interview brief</h1>
<p style="margin:0 0 18px;color:#666;font-size:13px">${escapeHtml(links.organizationName)} · ${escapeHtml(links.reportDate)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${row('Interviews analysed',content.analysed_interviews)}
${row('Findings needing review',content.attention_findings)}
${row('Coaching actions overdue',content.coaching.overdue)}
${row('Coaching actions open',content.coaching.open+content.coaching.acknowledged)}
${row('Analyses that failed',content.processing_failures)}
</table>
<h2 style="font-size:15px;margin:22px 0 4px">Coaching themes</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">${themes}</table>
<h2 style="font-size:15px;margin:22px 0 4px">Candidate outcomes</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">${bands}</table>
${linkLine?`<p style="margin:24px 0 0;font-size:14px">${linkLine}</p>`:''}
<p style="margin:20px 0 0;color:#666;font-size:12px">
Counts only. Interview evidence, findings and candidate details stay in the ATS behind your login.
</p>
</div>`
}

/* The plain-text alternative, which some clients show instead of the HTML and every client uses for
 * the preview line. A digest with no text part gets previewed as raw markup. */
export function renderDigestText(content:DigestContent):string{
  const lines=[
    `Interviews analysed: ${content.analysed_interviews}`,
    `Findings needing review: ${content.attention_findings}`,
    `Coaching actions overdue: ${content.coaching.overdue}`,
    `Coaching actions open: ${content.coaching.open+content.coaching.acknowledged}`,
    `Analyses that failed: ${content.processing_failures}`,
  ]
  if(content.themes.length){
    lines.push('','Coaching themes:')
    for(const theme of content.themes)lines.push(`  ${dimensionLabel(theme.dimension)}: ${theme.interviews} interviews`)
  }
  if(content.candidate_fit.length){
    lines.push('','Candidate outcomes:')
    for(const entry of content.candidate_fit)lines.push(`  ${bandLabel(entry.band)}: ${entry.interviews}`)
  }
  lines.push('','Counts only. Evidence and candidate details stay in the ATS behind your login.')
  return lines.join('\n')
}
