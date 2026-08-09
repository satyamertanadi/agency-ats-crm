import {z} from 'zod'

// Row-shape schema for OrganizationProvider's membership bootstrap query (X1, F17). organization_id
// is organization_settings' own primary key (verified against production: organization_settings_pkey
// is PRIMARY KEY (organization_id)), so this embed is a genuine 1:1 -- but the existing code already
// defensively unwraps both an array and a bare object, so this preserves that same union rather than
// assuming PostgREST always resolves the 1:1 cardinality the same way.
const organizationSettingsEmbed=z.union([
  z.object({primary_color:z.string(),logo_path:z.string().nullable(),settings:z.record(z.string(),z.unknown()).optional()}),
  z.array(z.object({primary_color:z.string(),logo_path:z.string().nullable(),settings:z.record(z.string(),z.unknown()).optional()})),
]).nullable().optional()

export const membershipRowSchema=z.object({
  id:z.string(),organization_id:z.string(),user_id:z.string(),status:z.enum(['invited','active','suspended']),
  organizations:z.object({
    id:z.string(),name:z.string(),slug:z.string(),base_currency:z.string(),
    salary_period:z.enum(['annual','monthly']).nullable().optional(),timezone:z.string(),
    pilot_status:z.enum(['preparing','uat','pilot','active','suspended','closed']),
    organization_settings:organizationSettingsEmbed,
  }),
})
