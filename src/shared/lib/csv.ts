import Papa from 'papaparse'

/* CSV export for list views.
 *
 * Papa.unparse rather than hand-joining commas: names, job titles and addresses in this product
 * routinely contain commas, quotes and newlines, and a hand-rolled join silently corrupts exactly
 * the rows a recruiter cares about most. The import center already depends on Papa for the same
 * reason, so this adds no new dependency. */
export function toCsv(rows:Array<Record<string,unknown>>,columns?:string[]){
  if(rows.length===0)return columns?.length?`${columns.join(',')}\n`:''
  return Papa.unparse(rows,{columns:columns?.length?columns:undefined})
}

export function downloadCsv(filename:string,content:string){
  // A BOM so Excel opens UTF-8 correctly. Without it, Indonesian and other non-ASCII names arrive
  // mojibaked in the tool most agencies will actually open this in.
  const blob=new Blob(['﻿',content],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  anchor.href=url
  anchor.download=filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const csvFilename=(prefix:string,now=new Date())=>`${prefix}-${now.toISOString().slice(0,10)}.csv`
