import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {settingChanged,checkSetting} from '../src/boardSettings.mjs'
test('spending display distinguishes known estimates, unknown costs and empty quality samples',async()=>{
  const context={window:{},Intl,Blob,URL,setTimeout};vm.runInNewContext(await readFile(new URL('../public/spending.js',import.meta.url),'utf8'),context)
  assert.equal(context.window.BoardSpending.costLabel({knownCost:{low:0,high:0},unknownCostMessages:3}),'Unknown')
  assert.equal(context.window.BoardSpending.costLabel({knownCost:{low:1,high:1.2},unknownCostMessages:0}),'$1.00–$1.20')
  assert.equal(context.window.BoardSpending.qualityLabel({qualitySample:0,firstPassPercent:null}),'Not measured')
})
test('observe/off controls preserve the configured routing policy and cannot enable unproved execution',()=>{
  const result=settingChanged('{"name":"Garden","routing":{"r0Canary":false}}','routingMode','observe')
  assert.equal(result.ok,true)
  assert.equal(JSON.parse(result.text).routing.mode,'observe')
  assert.equal(JSON.parse(result.text).routing.r0Canary,false)
  assert.equal(checkSetting({key:'routingMode',value:'enforce'}).ok,false)
})
