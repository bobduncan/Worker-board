import test from 'node:test'
import assert from 'node:assert/strict'
import {candidateOfSubmission,validateReview,candidateStatus,candidateFingerprint} from '../../src/work/routing/candidates.mjs'
import {parseRoutingPolicy} from '../../src/work/routing/policy.mjs'
const contract={hash:'c',requirements:[{id:'AC1'},{id:'AC2'}],risk:{class:'R2',factors:[]},allowedPaths:{board:['src/one.mjs']},repositories:['board']}
const assignment={id:'a',attemptId:'attempt',contractHash:'c',policyHash:'p',profileHash:'v',ownerSessionId:'author',status:'running',required:{family:'sonnet',model:'s',effort:'medium'},actual:{model:'s',effort:'medium'}}
const facts=[{repoKey:'board',repositoryId:'repository-board',targetBranch:'main',branch:'feature',baseSha:'base',headSha:'head',treeHash:'tree',paths:['src/one.mjs']}]
const registry={haiku:{model:'h',efforts:['low','medium','high']},sonnet:{model:'s',efforts:['low','medium','high']},opus:{model:'o',efforts:['low','medium','high']}}
const policy={...parseRoutingPolicy().policy,registry:Object.fromEntries(Object.entries(registry).map(([k,v])=>[k,{...v,verified:true}]))}
const make=()=>candidateOfSubmission({body:{id:'B1'},contract,assignment,gitFacts:facts,authorSessions:['author','child'],policy}).candidate
const evidence=c=>({candidateId:c.id,fingerprint:c.fingerprint,contractHash:c.contractHash,policyHash:c.policyHash,profileHash:c.profileHash})
const review=()=>({reviewerSessionId:'reviewer',actual:{model:'s',effort:'medium'},points:[{id:'AC1',verdict:'pass',evidence:'test'},{id:'AC2',verdict:'pass',evidence:'picture'}],findings:[]})
test('scope drift and unknown Git facts cannot submit a candidate',()=>{
  assert.equal(candidateOfSubmission({body:{id:'B1'},contract,assignment,gitFacts:[{...facts[0],paths:['private/config']}],authorSessions:['author']}).ok,false)
  assert.equal(candidateOfSubmission({body:{id:'B1'},contract,assignment,gitFacts:[],authorSessions:['author']}).ok,false)
  assert.equal(make().contractHash,'c')
})
test('independent review requires every AC, model floor and no unresolved serious findings',()=>{
  const candidate=make();const check=r=>validateReview({candidate,review:r,contract,actor:{sessionId:r.reviewerSessionId},reviewFloor:{family:'sonnet',effort:'medium'},registry})
  assert.equal(check(review()).ok,true)
  assert.equal(check({...review(),reviewerSessionId:'child'}).ok,false)
  assert.equal(check({...review(),points:[review().points[0]]}).ok,false)
  assert.equal(check({...review(),points:[review().points[0],review().points[0]]}).ok,false)
  assert.equal(check({...review(),actual:{model:'h',effort:'high'}}).ok,false)
  assert.equal(check({...review(),findings:[{severity:'major',text:'Lost state',resolution:null}]}).ok,false)
})
test('revision and policy changes invalidate exact-candidate approval',()=>{
  const candidate=make();candidate.checks={passed:true,...evidence(candidate)};candidate.review={approved:true,...evidence(candidate)}
  assert.equal(candidateStatus({candidate,currentFacts:{contractHash:'c',policyHash:'p',profileHash:'v',components:facts}}).approved,true)
  assert.equal(candidateStatus({candidate,currentFacts:{contractHash:'c',policyHash:'p',profileHash:'v',components:[{...facts[0],headSha:'new'}]}}).approved,false)
  assert.equal(candidateStatus({candidate,currentFacts:{contractHash:'changed',policyHash:'p',profileHash:'v',components:facts}}).approved,false)
})

test('target branch and repository identity are approval inputs',()=>{
  assert.notEqual(candidateFingerprint(facts),candidateFingerprint([{...facts[0],targetBranch:'another'}]))
  assert.notEqual(candidateFingerprint(facts),candidateFingerprint([{...facts[0],repositoryId:'another'}]))
})

test('actual protected changes cannot submit below their required floor',()=>{
  const scoped={...contract,allowedPaths:{board:['src/**']}}
  const changed=[{...facts[0],paths:['src/work/routing/policy.mjs']}]
  const result=candidateOfSubmission({body:{id:'B1'},contract:scoped,assignment,gitFacts:changed,authorSessions:['author'],policy})
  assert.equal(result.ok,false)
  assert.match(result.why,/floor|route/i)
})

test('approval evidence must bind the current candidate and destination',()=>{
  const candidate=make(),currentFacts={contractHash:'c',policyHash:'p',profileHash:'v',components:facts}
  candidate.checks={passed:true,candidateId:'old',fingerprint:'old',profileHash:'old'}
  candidate.review={approved:true,candidateId:'old'}
  assert.equal(candidateStatus({candidate,currentFacts}).approved,false)
  const changed={...facts[0],targetBranch:'another-target'}
  candidate.checks={passed:true,candidateId:candidate.id,fingerprint:candidate.fingerprint,contractHash:'c',policyHash:'p',profileHash:'v'}
  candidate.review={...candidate.checks,approved:true}
  assert.equal(candidateStatus({candidate,currentFacts:{...currentFacts,components:[changed]}}).approved,false)
})
