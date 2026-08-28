import assert from 'node:assert/strict'
import {
  bandLabel,digestSubject,dimensionLabel,escapeHtml,renderDigestHtml,renderDigestText,
  type DigestContent,
} from '../../supabase/functions/_shared/interview-digest.ts'

/* What an owner actually receives.
 *
 * The assertions that matter here are about what is NOT in the email. A digest is forwarded, stored
 * unencrypted and read by whoever picks up the phone, so a sentence about a named colleague's
 * technique or a line a candidate said is a disclosure that cannot be taken back.
 */

const content=(over:Partial<DigestContent>={}):DigestContent=>({
  analysed_interviews:6,
  attention_findings:2,
  processing_failures:1,
  themes:[{dimension:'listening_balance',interviews:4},{dimension:'question_quality',interviews:2}],
  candidate_fit:[{band:'promising_but_incomplete',interviews:3},{band:'material_concerns',interviews:1}],
  coaching:{open:2,acknowledged:1,overdue:3},
  ...over,
})

Deno.test('renders counts and fixed vocabulary, never a model-authored sentence',()=>{
  const html=renderDigestHtml(content(),{
    organizationName:'Northstar Recruitment',reportDate:'2027-03-04',
    scorecardUrl:'https://app.example/app/northstar/scorecard',
    todayUrl:'https://app.example/app/northstar/today',
  })
  assert.ok(html.includes('Interviews analysed'))
  assert.ok(html.includes('Listening balance'))
  assert.ok(html.includes('Promising but incomplete'))
  // The shape of the payload is the guarantee: there is no field a summary could arrive in.
  assert.ok(!('summary' in content()))
  assert.ok(!('findings' in content()))
})

Deno.test('links back into the ATS rather than restating the evidence',()=>{
  const html=renderDigestHtml(content(),{
    organizationName:'Northstar',reportDate:'2027-03-04',
    scorecardUrl:'https://app.example/app/northstar/scorecard',
    todayUrl:'https://app.example/app/northstar/today',
  })
  assert.ok(html.includes('https://app.example/app/northstar/scorecard'))
  assert.ok(html.includes('behind your login'))
})

Deno.test('omits the links rather than printing a broken one',()=>{
  /* APP_URL is not configured in every environment. A brief with no links is still useful; a link to
   * "undefined/app" in somebody's inbox is not fixable after the fact. */
  const html=renderDigestHtml(content(),{
    organizationName:'Northstar',reportDate:'2027-03-04',scorecardUrl:null,todayUrl:null,
  })
  assert.ok(!html.includes('href'))
  assert.ok(!html.includes('undefined'))
  assert.ok(!html.includes('null'))
})

Deno.test('escapes a workspace name that contains markup',()=>{
  /* Every count is a number and every label comes from a fixed map, but the workspace name is typed
   * by a person and lands in the same HTML. */
  const html=renderDigestHtml(content(),{
    organizationName:'<script>alert(1)</script> & Co',reportDate:'2027-03-04',
    scorecardUrl:null,todayUrl:null,
  })
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('&amp; Co'))
})

Deno.test('leads the subject with what is waiting on somebody',()=>{
  /* "Interview quality" alone is a subject people learn to ignore by the second week. */
  assert.deepStrictEqual(
    digestSubject(content(),'2027-03-04'),
    'Interview brief · 5 needing attention · 2027-03-04')
})

Deno.test('says how much was analysed when nothing is waiting',()=>{
  const quiet=content({attention_findings:0,coaching:{open:0,acknowledged:0,overdue:0}})
  assert.deepStrictEqual(
    digestSubject(quiet,'2027-03-04'),
    'Interview brief · 6 analysed · 2027-03-04')
})

Deno.test('says so plainly when a section has nothing in it',()=>{
  /* An empty table with no words in it reads as a rendering failure rather than as a quiet period. */
  const html=renderDigestHtml(content({themes:[],candidate_fit:[]}),{
    organizationName:'Northstar',reportDate:'2027-03-04',scorecardUrl:null,todayUrl:null,
  })
  assert.ok(html.includes('No recurring themes in this period.'))
  assert.ok(html.includes('No candidate assessments in this period.'))
})

Deno.test('carries a plain-text alternative so the preview is not raw markup',()=>{
  const text=renderDigestText(content())
  assert.ok(text.includes('Interviews analysed: 6'))
  assert.ok(text.includes('Listening balance: 4 interviews'))
  assert.ok(!text.includes('<'))
})

Deno.test('passes an unrecognised term through rather than rendering undefined',()=>{
  // A later prompt version adding a dimension must not blank a row.
  assert.deepStrictEqual(dimensionLabel('something_new'),'something_new')
  assert.deepStrictEqual(bandLabel('another_band'),'another_band')
})

Deno.test('escapes the five characters that matter and leaves the rest alone',()=>{
  assert.deepStrictEqual(escapeHtml('a<b>&"\''),'a&lt;b&gt;&amp;&quot;&#39;')
  assert.deepStrictEqual(escapeHtml('Ratih & Søren — 5 interviews'),'Ratih &amp; Søren — 5 interviews')
})
