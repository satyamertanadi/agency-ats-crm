import type { ReactNode } from 'react'

/* A header is a bare string unless the column needs to say something about itself. Numeric columns
 * pass {label,align:'right'} so the heading sits over the digits it labels -- a right-aligned money
 * cell under a left-aligned header reads as a bug. Kept as a union so the existing string[] call
 * sites stay untouched.
 *
 * `width` opts a table into deliberate allocation. Without it the browser infers widths from content,
 * which is fine for short columns and actively harmful for a scanning table: a long job title wins
 * space and the identity column wraps. Supplying widths switches on table-layout:fixed, so a column
 * gets what it was given rather than what its longest cell asks for. Leave ONE column without a
 * width and it absorbs the remainder -- that should be the column you want to grow on a wide screen.
 *
 * `hideLabel` keeps the heading for assistive technology and takes it off the screen, for the columns
 * whose contents are self-describing by sight -- a checkbox column, a row-menu column. The
 * alternative authors reach for is an empty string, which produces a <th> with no accessible name:
 * the column then goes unannounced in a screen reader's table navigation, and every cell under it
 * loses the header association that makes a data table navigable at all.
 */
export type TableHeader=string|{label:string;align?:'right';width?:string;hideLabel?:boolean}
const headerParts=(header:TableHeader)=>typeof header==='string'?{label:header,align:undefined,width:undefined,hideLabel:undefined}:header

export interface TableProps {headers:TableHeader[];children:ReactNode;caption?:string;className?:string;sticky?:boolean}
export function Table({ headers, children, caption, className='', sticky=true }: TableProps) {
  const parts=headers.map(headerParts)
  /* Only tables that ask for widths change behaviour. Every other call site in the app keeps the
   * content-driven layout it was written against. */
  const allocated=parts.some((part)=>part.width)
  return <div className={`table-scroll ${sticky?'table-sticky':''} ${className}`.trim()}>
    <table className={allocated?'table-allocated':undefined}>
      {caption&&<caption>{caption}</caption>}
      {allocated&&<colgroup>{parts.map((part)=><col key={part.label} style={part.width?{width:part.width}:undefined}/>)}</colgroup>}
      <thead><tr>{parts.map(({label,align,hideLabel})=><th scope="col" key={label} className={align==='right'?'money':undefined}>{hideLabel?<span className="sr-only">{label}</span>:label}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
}
