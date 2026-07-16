/* The agency's accent colour, and the single default it falls back to.
 *
 * organization_settings.primary_color is a value an agency types into the Settings editor, so it can
 * genuinely be absent or malformed and every consumer has to cope. What it must not do is cope
 * DIFFERENTLY. The hex and its validating regex were copied into three places -- the app shell, the
 * settings editor, and the candidate-profile view model that feeds the DOCX and PDF exports. Three
 * copies of a default is three chances for the document sent to a client to be a different green from
 * the screen it was generated on, and nobody notices that until the client does.
 *
 * DEFAULT_ACCENT deliberately mirrors --color-accent in tokens.css. That duplication is real but
 * unavoidable: the DOCX/PDF renderers are not in a browser and cannot read a CSS custom property, so
 * they need a literal. tokens.css stays the source of truth for what the app paints; this is the
 * source of truth for the JS that has to hand a colour to something that is not CSS. If one changes,
 * change both -- there is no mechanism that will tell you.
 */
export const DEFAULT_ACCENT='#196f52'

/* Six-digit hex only. The editor writes that form, and the exporters cannot resolve anything else. */
export const isHexColor=(value:string|null|undefined):value is string=>/^#[0-9a-f]{6}$/i.test(value||'')

export const resolveAccent=(value:string|null|undefined):string=>isHexColor(value)?value:DEFAULT_ACCENT
