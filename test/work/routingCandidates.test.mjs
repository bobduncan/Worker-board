import test from 'node:test'
import assert from 'node:assert/strict'
import {candidateOfSubmission,validateReview,candidateStatus} from '../../src/work/routing/candidates.mjs'
const contract={hash:'c',requirements:[{id:'AC1'},{id:'AC2'}],allowedPaths:{board:['src/**']},repositories:['board']}
const assignment={id:'a',attemptId:'attempt',contractHash:'c',policyHash:'p',profileHash:'v',ownerSessionId:'author',status:'running'}
const facts=[{repoKey:'board',branch:'feature',baseSha:'base',headSha:'head',treeHash:'tree',paths:['src/one.mjs']}]
const registry={haiku:{model:'h',efforts:['low','medium','high']},sonnet:{model:'s',efforts:['low','medium','high']},opus:{model:'o',efforts:['low','medium','high']}}
const make=()=>candidateOfSubmission({body:{id:'B1'},contract,assignment,gitFacts:facts,authorSessions:['author','child']}).candidate
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
  const candidate={...make(),checks:{passed:true,head:'head'},review:{approved:true}}
  assert.equal(candidateStatus({candidate,currentFacts:{contractHash:'c',policyHash:'p',profileHash:'v',components:facts}}).approved,true)
  assert.equal(candidateStatus({candidate,currentFacts:{contractHash:'c',policyHash:'p',profileHash:'v',components:[{...facts[0],headSha:'new'}]}}).approved,false)
  assert.equal(candidateStatus({candidate,currentFacts:{contractHash:'changed',policyHash:'p',profileHash:'v',components:facts}}).approved,false)
})
