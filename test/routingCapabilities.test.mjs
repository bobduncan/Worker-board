import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAppChat } from '../src/appChats.mjs'
import { enforcementReadiness } from '../src/work/routing/capabilities.mjs'

test('the app model is exposed without guessing an absent model', () => {
  const raw = {title:'Team - Worker',cliSessionId:'transcript',sessionId:'session',model:'claude-sonnet-5-5',effort:'medium'}
  assert.equal(parseAppChat(JSON.stringify(raw)).model, 'claude-sonnet-5-5')
  delete raw.model
  assert.equal(parseAppChat(JSON.stringify(raw)).model, null)
})

test('unknown and partial bridge capabilities cannot enable cheaper execution', () => {
  assert.equal(enforcementReadiness(null).ok, false)
  assert.equal(enforcementReadiness({protocolVersion:1,canBlockExecution:true}).ok, false)
  assert.equal(enforcementReadiness({protocolVersion:1,canBlockExecution:true,canObserveActualRoute:true,canSetOtherSession:true,canAttributeChildren:false,canDisableChildren:true}).ok,true)
  assert.equal(enforcementReadiness({protocolVersion:99,canBlockExecution:true,canObserveActualRoute:true,canSetOtherSession:true,canDisableChildren:true}).ok,false)
})
