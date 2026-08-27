import {assertEquals} from 'jsr:@std/assert@1'
import {
  computeConversationMetrics,
  consultantSpeechByMember,
  type MetricInputEntry,
  type SpeakerMetrics,
  type SpeakerRole,
  speakingShare,
} from '../../supabase/functions/_shared/interview-metrics.ts'

let sequence=0
const entry=(speakerId:string,speakerRole:SpeakerRole,startMs:number|null,endMs:number|null):MetricInputEntry=>
  ({speakerId,speakerRole,sequenceNumber:sequence++,startMs,endMs})
const reset=()=>{sequence=0}

/* Fails loudly rather than asserting against undefined: a missing speaker means the metric grouping
 * broke, and that should read as a clear failure instead of a confusing property comparison. */
const speaker=(metrics:{speakers:SpeakerMetrics[]},speakerId:string):SpeakerMetrics=>{
  const found=metrics.speakers.find((item)=>item.speakerId===speakerId)
  if(!found)throw new Error('no metrics for speaker '+speakerId)
  return found
}

Deno.test('measures speech per speaker and excludes the silence between turns',()=>{
  reset()
  // A ten-second gap sits between the two turns. It belongs to nobody and must not appear in either
  // speaker's total, nor inflate the denominator of the share.
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,4000),
    entry('s2','candidate',14_000,20_000),
  ])
  const consultant=speaker(metrics,'s1')
  const candidate=speaker(metrics,'s2')
  assertEquals(consultant.speechMs,4000)
  assertEquals(candidate.speechMs,6000)

  const shares=speakingShare(metrics.speakers)
  assertEquals(shares.get('s1'),0.4)
  assertEquals(shares.get('s2'),0.6)
})

Deno.test('counts a run of consecutive lines as one turn',()=>{
  reset()
  // Exporters split one spoken answer across several cues. Counting lines would report a consultant
  // who asked two questions as having taken five turns.
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,2000),
    entry('s2','candidate',2000,4000),
    entry('s2','candidate',4000,6000),
    entry('s2','candidate',6000,9000),
    entry('s1','consultant',9000,10_000),
  ])
  const candidate=speaker(metrics,'s2')
  assertEquals(candidate.turnCount,1)
  assertEquals(candidate.speechMs,7000)
  assertEquals(candidate.longestTurnMs,7000)
  const consultant=speaker(metrics,'s1')
  assertEquals(consultant.turnCount,2)
  assertEquals(consultant.averageTurnMs,1500)
})

Deno.test('reports no ratio at all when there are no timestamps',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',null,null),
    entry('s2','candidate',null,null),
  ])
  assertEquals(metrics.summary.timestampCoverage,0)
  assertEquals(metrics.summary.metricConfidence,'low')
  const shares=speakingShare(metrics.speakers)
  // null means Unavailable. Zero would be a claim about the conversation that nothing supports.
  assertEquals(shares.get('s1'),null)
  assertEquals(shares.get('s2'),null)
  // Turn counts survive: who spoke and how often is knowable without a clock.
  assertEquals(speaker(metrics,'s1').turnCount,1)
  assertEquals(speaker(metrics,'s1').averageTurnMs,null)
})

Deno.test('word count is never treated as duration',()=>{
  reset()
  // A long untimed answer and a short untimed question must be indistinguishable by duration.
  const metrics=computeConversationMetrics([
    entry('s1','consultant',null,null),
    entry('s2','candidate',null,null),
  ])
  assertEquals(metrics.speakers.every((speaker)=>speaker.speechMs===0),true)
})

Deno.test('partial timestamp coverage lowers confidence',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,2000),
    entry('s2','candidate',null,null),
    entry('s1','consultant',null,null),
    entry('s2','candidate',8000,10_000),
  ])
  assertEquals(metrics.summary.timestampCoverage,0.5)
  assertEquals(metrics.summary.metricConfidence,'low')
})

Deno.test('full coverage with clean mapping reads as high confidence',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,2000),
    entry('s2','candidate',2000,9000),
  ])
  assertEquals(metrics.summary.timestampCoverage,1)
  assertEquals(metrics.summary.metricConfidence,'high')
})

Deno.test('keeps unknown speech visible instead of redistributing it',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,2000),
    entry('s2','candidate',2000,4000),
    entry('s3','unknown',4000,10_000),
  ])
  assertEquals(metrics.summary.unknownSpeechMs,6000)
  const shares=speakingShare(metrics.speakers)
  // The unknown speaker holds its own share, so the identified pair are not flattered by it.
  assertEquals(shares.get('s3'),0.6)
  assertEquals(shares.get('s1'),0.2)
  // A large unattributed slice is exactly when the numbers should not read as authoritative.
  assertEquals(metrics.summary.metricConfidence,'low')
})

Deno.test('counts overlap without deducting it from either speaker',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,5000),
    entry('s2','candidate',3000,8000),
  ])
  assertEquals(metrics.summary.overlapCount,1)
  assertEquals(metrics.summary.overlapMs,2000)
  // Both people really were speaking, so both keep the full duration.
  assertEquals(speaker(metrics,'s1').speechMs,5000)
  assertEquals(speaker(metrics,'s2').speechMs,5000)
})

Deno.test('does not count two cues from the same speaker as overlap',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,5000),
    entry('s1','consultant',4000,8000),
  ])
  assertEquals(metrics.summary.overlapCount,0)
  assertEquals(metrics.summary.overlapMs,0)
})

Deno.test('handles a zero-duration segment without distorting the average',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',1000,1000),
    entry('s2','candidate',2000,6000),
  ])
  const consultant=speaker(metrics,'s1')
  assertEquals(consultant.speechMs,0)
  assertEquals(consultant.turnCount,1)
  assertEquals(consultant.averageTurnMs,0)
})

Deno.test('orders out-of-order entries before measuring',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s2','candidate',5000,9000),
    entry('s1','consultant',0,2000),
  ])
  // Sorted by start, so these are two separate turns rather than one merged run.
  assertEquals(metrics.speakers.length,2)
  assertEquals(metrics.summary.overlapCount,0)
})

Deno.test('an empty transcript produces no speakers and no ratio',()=>{
  reset()
  const metrics=computeConversationMetrics([])
  assertEquals(metrics.speakers.length,0)
  assertEquals(metrics.summary.timestampCoverage,0)
  assertEquals(metrics.summary.metricConfidence,'low')
})

Deno.test('reports a long monologue as the longest turn',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,1000),
    entry('s2','candidate',1000,4000),
    entry('s1','consultant',4000,124_000),
  ])
  const consultant=speaker(metrics,'s1')
  assertEquals(consultant.longestTurnMs,120_000)
})

Deno.test('measures two consultants separately rather than as one subject',()=>{
  reset()
  // Collapsing these would attribute one colleague's behaviour to the other, which is exactly what
  // the multi-consultant rule forbids.
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,3000),
    entry('s2','consultant',3000,4000),
    entry('s3','candidate',4000,10_000),
  ])
  const byMember=consultantSpeechByMember(metrics.speakers,new Map([['s1','member-a'],['s2','member-b'],['s3',null]]))
  assertEquals(byMember.get('member-a'),3000)
  assertEquals(byMember.get('member-b'),1000)
  assertEquals(byMember.size,2)
})

Deno.test('ignores an unmapped consultant rather than crediting the wrong member',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,3000),
    entry('s2','consultant',3000,4000),
  ])
  const byMember=consultantSpeechByMember(metrics.speakers,new Map([['s1','member-a']]))
  assertEquals(byMember.get('member-a'),3000)
  assertEquals(byMember.size,1)
})

Deno.test('a client participant is measured but is not a consultant subject',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',0,2000),
    entry('s2','client',2000,5000),
    entry('s3','candidate',5000,10_000),
  ])
  assertEquals(speaker(metrics,'s2').speechMs,3000)
  const byMember=consultantSpeechByMember(metrics.speakers,new Map([['s1','member-a'],['s2','member-b']]))
  assertEquals(byMember.size,1)
})

Deno.test('an inverted timespan is treated as untimed rather than negative',()=>{
  reset()
  const metrics=computeConversationMetrics([
    entry('s1','consultant',5000,1000),
    entry('s2','candidate',6000,8000),
  ])
  assertEquals(speaker(metrics,'s1').speechMs,0)
  assertEquals(metrics.summary.timestampCoverage,0.5)
})
