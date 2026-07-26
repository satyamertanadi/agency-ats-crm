/* The manual add form submitted `salary_currency` while rendering no input for it, so an expected
 * salary typed by a consultant in an IDR workspace was stored under whatever the schema default
 * happened to be -- a silent, unreviewable wrong number on a private field. Fixing that needs a real
 * picker, and a real picker needs a list.
 *
 * Deliberately a short list of the currencies an agency in this market actually quotes in, not the
 * ISO-4217 table: a 180-option select is a worse control than a 20-option one, and an agency that
 * needs a missing code gets it via `currencyOptions`, which always includes the workspace's own base
 * currency whether or not it is listed here. */
export interface CurrencyOption {code:string;name:string}

export const COMMON_CURRENCIES:readonly CurrencyOption[]=[
  {code:'IDR',name:'Indonesian rupiah'},
  {code:'SGD',name:'Singapore dollar'},
  {code:'MYR',name:'Malaysian ringgit'},
  {code:'USD',name:'US dollar'},
  {code:'AUD',name:'Australian dollar'},
  {code:'EUR',name:'Euro'},
  {code:'GBP',name:'Pound sterling'},
  {code:'HKD',name:'Hong Kong dollar'},
  {code:'JPY',name:'Japanese yen'},
  {code:'PHP',name:'Philippine peso'},
  {code:'THB',name:'Thai baht'},
  {code:'VND',name:'Vietnamese dong'},
  {code:'INR',name:'Indian rupee'},
  {code:'CNY',name:'Chinese yuan'},
  {code:'KRW',name:'South Korean won'},
  {code:'NZD',name:'New Zealand dollar'},
  {code:'AED',name:'UAE dirham'},
  {code:'CAD',name:'Canadian dollar'},
  {code:'CHF',name:'Swiss franc'},
]

/** The list to render, with the workspace's base currency first (and present even if unlisted). */
export function currencyOptions(baseCurrency?:string|null):CurrencyOption[]{
  const base=baseCurrency?.trim().toUpperCase()
  if(!base)return [...COMMON_CURRENCIES]
  const known=COMMON_CURRENCIES.find((option)=>option.code===base)
  return [known??{code:base,name:'Workspace currency'},...COMMON_CURRENCIES.filter((option)=>option.code!==base)]
}
