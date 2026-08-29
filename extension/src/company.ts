// The pure half of client capture: what a company URL means, and which of the page's near-identical
// numbers is a headcount.
//
// Deliberately imports nothing. scrape.ts pulls in dom.ts, which reads location.href at module load
// so it can watch for SPA navigation -- importing it drags a live document into anything that only
// wants to parse a string, and the unit tests run in node.

/* A LinkedIn company URL, reduced to the form used as a dedup key.
 *
 * LinkedIn serves the same company under /company/<slug>, /company/<slug>/about/, /life/, /jobs/ and
 * with tracking parameters, so the raw href is not comparable. The slug is, and it is what the ATS
 * stores -- two captures of the same company from different tabs must recognise each other. */
export function canonicalCompanyUrl(href:string):string|null{
  let path:string
  try{path=new URL(href,'https://www.linkedin.com').pathname}
  catch{return null}
  const match=path.match(/\/company\/([^/]+)/)
  return match?`https://www.linkedin.com/company/${match[1].toLowerCase()}/`:null
}

export const isCompanyPage=(href:string):boolean=>canonicalCompanyUrl(href)!==null

/* The company sidebar prints industry, size, headquarters and followers as separate localised lines.
 * Each is read on its own and anything unrecognised is left empty rather than guessed at: an empty
 * field the user fills is recoverable, and "51-200 employees" filed as an industry is not. */
export function parseCompanySize(text:string):string{
  // "11-50 employees", "1,001-5,000 employees", "10,001+ employees"
  const match=text.match(/([\d,.]+K?\s*[-–]\s*[\d,.]+K?|[\d,]+\+)\s*employees/i)
  return match?`${match[1].replace(/\s+/g,'')} employees`:''
}

/* Follower counts and employee counts sit beside each other and read almost identically -- "274
 * followers" next to "51-200 employees". Mistaking one for the other puts a wildly wrong headcount on
 * a client record, which then gets quoted back to that client. */
export function looksLikeFollowerCount(text:string):boolean{
  return /followers?/i.test(text)
}
