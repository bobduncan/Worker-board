import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalContract, contractHash, validateContract, pathAllowed, contractOf } from '../../src/work/routing/contract.mjs'
import { readRoutingRecord, writeRoutingSections } from '../../src/work/routing/records.mjs'
import { parseItem } from '../../src/work/item.mjs'

export const exampleContract = () => ({version:1,goal:'Fix the label',requirements:[{id:'AC1',behaviour:'Show the approved label',checks:['label-test']}],nonGoals:['Change no behaviour'],repositories:['board'],allowedPaths:{board:['public/**','test/**']},interfaces:[],risk:{class:'R1',factors:[],why:'One known pattern'},implementationFiles:1,validationProfile:'board',evidence:['test output'],reviewFloor:{family:'sonnet',effort:'medium'},implementationPlan:null})
test('canonical approval binds content while ignoring audit timestamps', () => {
  const c=exampleContract()
  assert.equal(contractHash(c),contractHash(Object.fromEntries(Object.entries(c).reverse())))
  assert.equal(contractHash({...c,approvedAt:99,hash:'old'}),contractHash(c))
  assert.notEqual(contractHash({...c,nonGoals:[]}),contractHash(c))
  assert.ok(canonicalContract(c).includes('AC1'))
})
test('requirements and allowed paths cannot silently widen', () => {
  const c=exampleContract()
  assert.equal(validateContract(c).ok,true)
  assert.equal(validateContract({...c,requirements:[...c.requirements,...c.requirements]}).ok,false)
  assert.equal(validateContract({...c,allowedPaths:{board:['../outside/**']}}).ok,false)
  assert.equal(validateContract({...c,allowedPaths:{board:['public/*.js']}}).ok,false)
  assert.equal(pathAllowed('public/view.js',['public/**']),true)
  assert.equal(pathAllowed('public/../private.json',['public/**']),false)
  assert.equal(pathAllowed('publicity/a',['public/**']),false)
})
test('routing sections round trip without touching existing history and fail closed on corruption', () => {
  const item=parseItem('Id: B1\nKind: step\nTitle: Test\nState: refined\nSince: today\n\n## History\n- existing\n')
  const c=exampleContract(); c.hash=contractHash(c)
  const updated=writeRoutingSections(item,{contract:c,managed:true,assignments:[],candidates:[],repair:null})
  assert.equal(contractOf(updated).ok,true)
  assert.equal(readRoutingRecord(updated).record.managed,true)
  assert.deepEqual(updated.sections.get('History'),['- existing'])
  updated.sections.set('Routing',['{broken'])
  assert.equal(readRoutingRecord(updated).ok,false)
})
