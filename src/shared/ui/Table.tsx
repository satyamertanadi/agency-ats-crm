import type { ReactNode } from 'react'

/* A header is a bare string unless the column needs to say something about itself. Numeric columns
 * pass {label,align:'right'} so the heading sits over the digits it labels -- a right-aligned money
 * cell under a left-aligned header reads as a bug. Kept as a union so the existing string[] call
 * sites stay untouched. */
export type TableHeader=string|{label:string;align:'right'}
const headerParts=(header:TableHeader)=>typeof header==='string'?{label:header,align:undefined}:header

export interface TableProps {headers:TableHeader[];children:ReactNode;caption?:string;className?:string;sticky?:boolean}
export function Table({ headers, children, caption, className='', sticky=true }: TableProps) { return <div className={`table-scroll ${sticky?'table-sticky':''} ${className}`.trim()}><table>{caption&&<caption>{caption}</caption>}<thead><tr>{headers.map((header)=>{const {label,align}=headerParts(header);return <th scope="col" key={label} className={align==='right'?'money':undefined}>{label}</th>})}</tr></thead><tbody>{children}</tbody></table></div> }
