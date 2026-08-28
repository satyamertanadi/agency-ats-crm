/* Deterministic conversation metrics.
 *
 * Computed from real timestamps in code, never asked of the model. Three rules decide almost
 * everything here:
 *
 * - Silence is excluded. Speech duration is the sum of the entries themselves, never the wall-clock
 *   span from the first word to the last, because the gap between two turns belongs to nobody.
 * - A missing timestamp is missing. It never becomes zero and it is never estimated from word count:
 *   a fabricated duration produces a speaking-share ratio that looks authoritative and means nothing.
 * - Unknown speech stays visible. Time nobody could be matched to is reported as its own share rather
 *   than redistributed across the people who were identified, because redistributing it would quietly
 *   inflate whoever the mapping did recognise.
 *
 * Nothing here decides whether an interview was good. Talk/listen has no universal ideal ratio, and
 * overlap is reported as overlap -- calling it an interruption is a semantic judgement that needs the
 * transcript, not the clock.
 */

export type SpeakerRole='consultant'|'candidate'|'client'|'other'|'unknown'
export type MetricConfidence='low'|'medium'|'high'

export interface MetricInputEntry {
  speakerId:string
  speakerRole:SpeakerRole
  sequenceNumber:number
  startMs:number|null
  endMs:number|null
}

export interface SpeakerMetrics {
  speakerId:string
  speakerRole:SpeakerRole
  speechMs:number
  turnCount:number
  averageTurnMs:number|null
  longestTurnMs:number|null
}

export interface ConversationMetricSummary {
  timestampCoverage:number
  unknownSpeechMs:number
  overlapMs:number
  overlapCount:number
  metricConfidence:MetricConfidence
}

export interface ConversationMetrics {
  speakers:SpeakerMetrics[]
  summary:ConversationMetricSummary
}

export function computeConversationMetrics(entries:MetricInputEntry[]):ConversationMetrics{
  const ordered=[...entries].sort((a,b)=>{
    const left=a.startMs,right=b.startMs
    if(left===null||right===null)return a.sequenceNumber-b.sequenceNumber
    return left===right?a.sequenceNumber-b.sequenceNumber:left-right
  })

  const timed=ordered.filter(isTimed)
  const timestampCoverage=ordered.length===0?0:round3(timed.length/ordered.length)

  /* A turn is a contiguous run by one speaker, not one transcript line. Most exporters split a single
   * spoken answer across several cues, so counting lines would report a consultant who asked three
   * questions as having taken thirty turns. Runs are taken over the full ordered list -- including
   * untimed entries -- so that turn COUNT stays meaningful even when duration is not available. */
  const turns:{speakerId:string;speakerRole:SpeakerRole;durationMs:number;timed:boolean}[]=[]
  for(const entry of ordered){
    const last=turns[turns.length-1]
    const duration=isTimed(entry)?Math.max(0,entry.endMs-entry.startMs):0
    if(last&&last.speakerId===entry.speakerId){
      last.durationMs+=duration
      last.timed=last.timed||isTimed(entry)
    }else{
      turns.push({speakerId:entry.speakerId,speakerRole:entry.speakerRole,durationMs:duration,timed:isTimed(entry)})
    }
  }

  const speakers=new Map<string,SpeakerMetrics&{timedTurns:number}>()
  for(const turn of turns){
    let record=speakers.get(turn.speakerId)
    if(!record){
      record={speakerId:turn.speakerId,speakerRole:turn.speakerRole,speechMs:0,turnCount:0,averageTurnMs:null,longestTurnMs:null,timedTurns:0}
      speakers.set(turn.speakerId,record)
    }
    record.turnCount+=1
    if(turn.timed){
      record.speechMs+=turn.durationMs
      record.timedTurns+=1
      record.longestTurnMs=Math.max(record.longestTurnMs??0,turn.durationMs)
    }
  }

  const result:SpeakerMetrics[]=[]
  for(const record of speakers.values()){
    // Averaged over the turns that actually carried a duration. Dividing by every turn would drag the
    // average towards zero in proportion to how much of the file lacked timestamps.
    const averageTurnMs=record.timedTurns>0?Math.round(record.speechMs/record.timedTurns):null
    result.push({
      speakerId:record.speakerId,
      speakerRole:record.speakerRole,
      speechMs:record.speechMs,
      turnCount:record.turnCount,
      averageTurnMs,
      longestTurnMs:record.timedTurns>0?record.longestTurnMs:null,
    })
  }

  const unknownSpeechMs=result.filter((speaker)=>speaker.speakerRole==='unknown').reduce((total,speaker)=>total+speaker.speechMs,0)
  const overlap=computeOverlap(timed)

  return {
    speakers:result,
    summary:{
      timestampCoverage,
      unknownSpeechMs,
      overlapMs:overlap.overlapMs,
      overlapCount:overlap.overlapCount,
      metricConfidence:confidenceFor(timestampCoverage,unknownSpeechMs,result),
    },
  }
}

/* Overlap is counted once per overlapping pair of DIFFERENT speakers. Two cues from the same speaker
 * overlapping is an exporter artifact, not two people talking at once.
 *
 * The overlapping milliseconds are deliberately NOT deducted from either speaker's speech: both
 * people really were speaking, so both keep the time, and the overlap is reported separately for
 * anyone who needs to reconcile the total. */
function computeOverlap(timed:(MetricInputEntry&{startMs:number;endMs:number})[]):{overlapMs:number;overlapCount:number}{
  let overlapMs=0
  let overlapCount=0
  for(let i=0;i<timed.length;i+=1){
    const current=timed[i]
    for(let j=i+1;j<timed.length;j+=1){
      const next=timed[j]
      // Sorted by start, so once a later entry begins after this one ends, nothing after it can
      // overlap either.
      if(next.startMs>=current.endMs)break
      if(next.speakerId===current.speakerId)continue
      const shared=Math.min(current.endMs,next.endMs)-Math.max(current.startMs,next.startMs)
      if(shared>0){overlapMs+=shared;overlapCount+=1}
    }
  }
  return {overlapMs,overlapCount}
}

/* Confidence is about how much of the conversation the metrics can actually account for. Patchy
 * timestamps and a large slice of unattributed speech both mean the same thing in practice: the
 * numbers are directionally useful at best, and the interface should say so. */
function confidenceFor(coverage:number,unknownSpeechMs:number,speakers:SpeakerMetrics[]):MetricConfidence{
  if(coverage===0)return 'low'
  const totalSpeech=speakers.reduce((total,speaker)=>total+speaker.speechMs,0)
  const unknownShare=totalSpeech>0?unknownSpeechMs/totalSpeech:0
  if(coverage>=0.95&&unknownShare<=0.05)return 'high'
  if(coverage>=0.6&&unknownShare<=0.25)return 'medium'
  return 'low'
}

/* The one implementation of speaking share. Two surfaces computing this themselves is how a drawer
 * and a scorecard end up disagreeing about the denominator, so the percentage is derived here and
 * never persisted alongside the durations.
 *
 * Returns null -- meaning "Unavailable", not 0% -- when there is no measured speech at all. A
 * transcript with no timestamps has no ratio, and showing one would be an invention. */
export function speakingShare(speakers:SpeakerMetrics[]):Map<string,number|null>{
  const total=speakers.reduce((sum,speaker)=>sum+speaker.speechMs,0)
  const shares=new Map<string,number|null>()
  for(const speaker of speakers){
    shares.set(speaker.speakerId,total>0?speaker.speechMs/total:null)
  }
  return shares
}

/* Per mapped consultant, never collapsed into one figure. An interview with two consultants has two
 * performance subjects, and summing them would attribute one colleague's behaviour to the other. */
export function consultantSpeechByMember(
  speakers:SpeakerMetrics[],
  memberBySpeakerId:Map<string,string|null>,
):Map<string,number>{
  const byMember=new Map<string,number>()
  for(const speaker of speakers){
    if(speaker.speakerRole!=='consultant')continue
    const memberId=memberBySpeakerId.get(speaker.speakerId)
    if(!memberId)continue
    byMember.set(memberId,(byMember.get(memberId)??0)+speaker.speechMs)
  }
  return byMember
}

function isTimed(entry:MetricInputEntry):entry is MetricInputEntry&{startMs:number;endMs:number}{
  return entry.startMs!==null&&entry.endMs!==null&&entry.endMs>=entry.startMs
}

function round3(value:number):number{return Math.round(value*1000)/1000}
