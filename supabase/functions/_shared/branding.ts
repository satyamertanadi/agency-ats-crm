/* The agency's accent colour, for the emails this project sends.
 *
 * Mirrors src/shared/lib/branding.ts. That duplication is the same one that file already documents
 * and accepts: an edge function is not in a browser and cannot read a CSS custom property, so it needs
 * a literal. If DEFAULT_ACCENT changes there, change it here -- nothing will tell you.
 *
 * The value this replaces was a hardcoded '#236c64', a green from before the blue-slate palette, which
 * meant the one artefact a client actually receives was the one surface that never got re-skinned --
 * and an agency that set its own brand colour in Settings saw it applied everywhere except the email
 * going out under its name.
 */
export const DEFAULT_ACCENT='#1d5a94'

/* Six-digit hex only, matching the Settings editor's own validation. Anything else is treated as
 * unset rather than passed through: this string is interpolated into an inline style attribute, so a
 * value that is not a colour is both a broken button and an injection point. */
export const resolveAccent=(value:string|null|undefined):string=>
  /^#[0-9a-f]{6}$/i.test(value||'')?value as string:DEFAULT_ACCENT
