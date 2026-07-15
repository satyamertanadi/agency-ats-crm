import type { ReactNode } from 'react'

export interface TableProps {headers:string[];children:ReactNode;caption?:string;className?:string;sticky?:boolean}
export function Table({ headers, children, caption, className='', sticky=true }: TableProps) { return <div className={`table-scroll ${sticky?'table-sticky':''} ${className}`.trim()}><table>{caption&&<caption>{caption}</caption>}<thead><tr>{headers.map((header)=><th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div> }
