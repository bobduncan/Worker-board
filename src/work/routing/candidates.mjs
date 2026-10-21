import {createHash,randomUUID} from 'node:crypto'
import {pathAllowed} from './contract.mjs'
import {meetsRoute,resolveRoute} from './policy.mjs'
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const binding=components=>components.map(c=>({repoKey:c.repoKey,repositoryId:c.repositoryId,targetBranch:c.targetBranch,branch:c.branch,baseSha:c.baseSha,headSha:c.headSha,treeHash:c.treeHash,paths:c.paths,manifest:c.manifest,outputHashes:c.outputHashes})).sort((a,b)=>String(a.repoKey).localeCompare(String(b.repoKey)))
export const candidateFingerprint=components=>createHash('sha256').update(JSON.stringify(binding(components))).digest('hex')
export const candidateEvidenceBinding=c=>({candidateId:c.id,fingerprint:c.fingerprint,contractHash:c.contractHash,policyHash:c.policyHash,profileHash:c.profileHash})
export function candidateEvidenceMatches(candidate,evidence){
  if(!candidate||!evidence||!Array.isArray(candidate.components)||candidate.fingerprint!==candidateFingerprint(candidate.components))return false
  return Object.entries(candidateEvidenceBinding(candidate)).every(([key,value])=>typeof value==='string'&&value.length>0&&evidence[key]===value)
}
export function candidateOfSubmission({body,contract,assignment,gitFacts,authorSessions,policy}){
  const bad=why=>({ok:false,why})
  if(!assignment||assignment.status!=='running'||assignment.contractHash!==contract?.hash)return bad('An actual, current implementation assignment is required.')
  if(!Array.isArray(authorSessions)||!authorSessions.includes(assignment.ownerSessionId))return bad('Implementation identities are incomplete.')
  if(!Array.isArray(gitFacts)||!gitFacts.length||!same([...gitFacts.map(c=>c.repoKey)].sort(),[...contract.repositories].sort()))return bad('Exact facts for every configured repository are required.')
  for(const c of gitFacts){if(!c.repositoryId||!c.targetBranch||!c.headSha||!c.baseSha||!c.treeHash||!Array.isArray(c.paths)||c.paths.some(p=>!pathAllowed(p,contract.allowedPaths[c.repoKey]??[])))return bad('Candidate destination is unknown or changed paths exceed the approved scope.');if(c.hasGitlink)return bad('Submodule changes require explicit reassessment.')}
  const chosen=resolveRoute({policy:policy?{...policy,mode:'observe'}:null,contract,changedPaths:gitFacts.flatMap(c=>c.paths),previousFloor:assignment.required,phase:'implement'})
  if(!chosen.ok||!chosen.route||!meetsRoute(assignment.actual,chosen.route,policy?.registry)||!meetsRoute(assignment.required,chosen.route,policy?.registry))return bad('Actual candidate scope requires a stronger model/effort floor; reassess and reassign.')
  return {ok:true,candidate:{id:randomUUID(),taskId:body.id,attemptId:assignment.attemptId,contractHash:contract.hash,policyHash:assignment.policyHash,profileHash:assignment.profileHash,reviewFloor:chosen.reviewFloor,components:structuredClone(gitFacts),fingerprint:candidateFingerprint(gitFacts),authorSessionIds:[...new Set(authorSessions)],checks:null,review:null,integration:null}}
}
export function validateReview({candidate,review,contract,actor,reviewFloor,registry}){
  const bad=why=>({ok:false,why})
  if(!actor?.sessionId||actor.sessionId!==review.reviewerSessionId||candidate.authorSessionIds.includes(actor.sessionId)||actor.implementationAncestor)return bad('An independently identified reviewer is required.')
  if(!meetsRoute(review.actual,reviewFloor,registry)||(candidate.reviewFloor&&!meetsRoute(review.actual,candidate.reviewFloor,registry)))return bad('Reviewer model/effort is below the required floor.')
  if(!Array.isArray(review.points))return bad('Every acceptance criterion must be checked.')
  const expected=contract.requirements.map(p=>p.id).sort(),actual=review.points.map(p=>p.id).sort()
  if(!same(expected,actual)||review.points.some(p=>p.verdict!=='pass'||typeof p.evidence!=='string'||!p.evidence.trim()))return bad('Every acceptance ID must pass exactly once with evidence.')
  if(!Array.isArray(review.findings)||review.findings.some(f=>!['minor','major','critical'].includes(f.severity)||(['critical','major'].includes(f.severity)&&!f.resolution)))return bad('Serious review findings remain unresolved.')
  return {ok:true,review:{...structuredClone(review),approved:true,...candidateEvidenceBinding(candidate)}}
}
export function candidateStatus({candidate:c,currentFacts:f}){
  const reasons=[]
  if(!c||!f)return {approved:false,reasons:['Candidate facts missing.']}
  for(const key of ['contractHash','policyHash','profileHash'])if(c[key]!==f[key])reasons.push(`${key} changed`)
  if(candidateFingerprint(c.components)!==candidateFingerprint(f.components??[]))reasons.push('Candidate or target revision changed')
  if(c.checks?.passed!==true||!candidateEvidenceMatches(c,c.checks))reasons.push('Required exact-candidate validation not passed')
  if(c.review?.approved!==true||!candidateEvidenceMatches(c,c.review))reasons.push('Independent exact-candidate review not approved')
  return {approved:reasons.length===0,reasons}
}
