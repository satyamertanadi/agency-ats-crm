# Interview transcript consent

Interview Intelligence analyses what a candidate said in an interview. That is a recording of a named
individual discussing their employment history, their salary and their availability, held by an agency
they do not work for. Consent is the gate on the whole capability, and it is a product rule enforced in
the database rather than a checkbox in the interface.

## The rule

No transcript is analysed unless the most recent consent event for that interview is `granted`.

The check sits in the analysis request path and in the ingestion path, not only in the UI. A transcript
may be stored while consent is pending -- a consultant may legitimately paste one before recording the
consent conversation -- but analysis will not start, and the interface shows a consent blocker rather
than a queued run.

## A notice is not a consent

Meeting platforms display a transcription notice to participants. That notice is evidence that somebody
was *told*, not evidence that they *agreed*, and the two are recorded separately: `notice_method` and
`notice_version` capture what the candidate was shown, while `status` and `consent_method` capture what
they actually said. A platform notice alone leaves the interview un-analysable.

This is deliberately stricter than the minimum some jurisdictions impose. The asymmetry of the
situation -- an agency analysing a job-seeker's recorded answers -- makes implied consent the wrong
default, and a recruitment agency that cannot show affirmative consent has nothing to point at when a
candidate asks why their interview was processed.

## History, not a flag

Consent is an append-oriented history of events, each carrying status, method, notice details, optional
evidence, when it occurred and who recorded it. The current state is the latest event. Nothing is
updated in place.

A flag would lose the sequence that matters: a candidate who granted consent, then withdrew it, then
granted it again for a later interview is a different situation from one who never withdrew, and the
audit answer to "was this interview analysed lawfully" is the event that was current when the analysis
ran -- not the value the column happens to hold today.

Withdrawal is therefore an event like any other, and it is the event that triggers purge.

## Withdrawal and purge

Withdrawal removes the derived intelligence, not just future access. Transcript entries, speakers,
derived evidence, assessments, findings and deterministic metrics are deleted, and an analysis run
whose evidentiary basis has gone is deleted with it. Coaching actions that exist only because of a
purged finding are cancelled.

Retaining a "zombie" assessment -- a conclusion about a candidate with the evidence deleted underneath
it -- would be worse than retaining nothing, because it is exactly the artefact that cannot be
explained or challenged. Where a run drew on several transcripts and only one becomes invalid, the run
is purged rather than recomputed, since the remaining evidence does not reproduce the same analysis.

Purge runs inside the existing `scheduled-maintenance` worker alongside retention expiry and respects
`candidate_private_details.legal_hold` the same way the rest of the retention pipeline does.

## What the audit keeps

The audit record retains identifiers, the event, its timestamp, the actor or system that caused it, and
a reason code. It never retains transcript content, candidate answers or evidence excerpts. An audit
trail that quotes the interview would recreate the data the purge just deleted, in a table with longer
retention and broader access.

## Retention

Independently of consent, transcripts expire on the workspace's `transcript_retention_days` setting --
90 days by default, bounded to between 7 and 365. Expiry runs the same purge path as withdrawal. A
workspace cannot set retention to unlimited: the bound is part of what makes the consent conversation
truthful.

## What this does not decide

Whether recording and analysing a given interview is lawful in a given jurisdiction is an external
compliance question. The system records the consent that was obtained, enforces its own rule against
that record, and makes the history available -- it does not advise on, or adjudicate, the underlying
legal position. Agencies operating across jurisdictions are expected to set their notice version and
consent practice accordingly.
