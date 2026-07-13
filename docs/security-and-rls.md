# Security and RLS

- RLS is enabled on every application table and access defaults to denied.
- `is_organization_member` and `has_permission` evaluate `auth.uid()` against active memberships.
- Anonymous callers receive no direct table grants. Public review uses token-scoped RPCs with hashed, expiring, revocable tokens.
- Candidate private details and commercial terms have separate permission boundaries.
- Storage buckets are private and paths begin with organization ID.
- Security-definer functions set a fixed search path and perform explicit authorization.
- Cross-organization SELECT, INSERT, UPDATE, DELETE, RPC, and storage behavior is tested.

