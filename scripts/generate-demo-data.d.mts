export type DemoRow=Record<string,string|number>
export type DemoData=Record<string,DemoRow[]>&{
  contacts:DemoRow[]
  candidates:DemoRow[]
  interviews:DemoRow[]
}
export const IMPORT_ORDER:string[]
export const ROLLBACK_ORDER:string[]
export const EXPECTED_COUNTS:Record<string,number>
export function generateDemoData(input:{anchorDate?:string;owners:string[]}):DemoData
export function validateDemoData(data:DemoData,owners:string[]):boolean
export function writeDemoData(input:{data:DemoData;outputDirectory:string;anchorDate:string}):Promise<Record<string,unknown>>
