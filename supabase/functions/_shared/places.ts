// Pure request/response shaping for Google Places API (New) Autocomplete. No Deno.* calls and no
// npm: imports -- like cv-schema.ts, this is deliberately portable so tests/unit/ can import it
// directly under Vitest/Node, while location-autocomplete/index.ts imports the same file under Deno
// at runtime. Neither the request-building nor the response-mapping logic should ever need a second,
// divergent copy for tests.

/** Indonesia's rough bounding box (Sabang to Merauke), used only as a soft `locationBias` --
 * NEVER as `locationRestriction` or `includedRegionCodes`, which would hard-filter results to
 * Indonesia and break "bias toward, but don't restrict to." A rectangle is used rather than a
 * `circle` bias because Places API (New) caps a circle's radius at 50km, far too small to lean
 * toward a whole archipelago; a rectangle viewport has no such cap and is Google's own documented
 * pattern for "prefer this region." */
const INDONESIA_BIAS_RECTANGLE={
  rectangle:{low:{latitude:-11.2,longitude:94.7},high:{latitude:6.1,longitude:141.1}},
}

export interface AutocompleteRequestBody {
  input:string
  sessionToken:string
  locationBias:typeof INDONESIA_BIAS_RECTANGLE
}

/** `sessionToken` is what lets Google bill an entire type-then-select sequence as one session rather
 * than one request per keystroke -- the caller is responsible for keeping the same token for every
 * request in one search and minting a new one once a selection is made or the field is abandoned. */
export function buildAutocompleteRequestBody(input:string,sessionToken:string):AutocompleteRequestBody{
  return {input,sessionToken,locationBias:INDONESIA_BIAS_RECTANGLE}
}

export interface PlaceSuggestion {id:string;label:string}

interface GooglePlacePrediction {placeId?:string;text?:{text?:string}}
export interface GoogleAutocompleteResponse {suggestions?:{placePrediction?:GooglePlacePrediction}[]}

/** Only `placeId` and the formatted `text` are kept -- Combobox's `options` prop only needs
 * `{id,label}`, and this app stores the location as a plain string with no companion place-id or
 * coordinate columns, so nothing else in Google's response has anywhere to go. A prediction missing
 * either field is dropped rather than rendered with a blank label or an unusable id. */
export function mapAutocompleteResponse(body:GoogleAutocompleteResponse):PlaceSuggestion[]{
  return (body.suggestions??[])
    .map((entry)=>entry.placePrediction)
    .filter((prediction):prediction is {placeId:string;text:{text:string}}=>
      Boolean(prediction?.placeId&&prediction.text?.text))
    .map((prediction)=>({id:prediction.placeId,label:prediction.text.text}))
}
