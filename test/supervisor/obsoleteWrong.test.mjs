// B775: the obsolete check shows that it failed. An ask the person closed from "Find obsolete items" that the chat asked again
// within a day, or an incident closed that way that came back, is one finding (an incident once): the check closed something
// still needed. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseItem } from '../../src/work/item.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'

const NOW = new Date(2026, 9, 28, 20, 0).getTime()
const rule = WATCH_RULES.find(one => one.id === 'obsolete-wrong')
const item = text => parseItem(text.replace(/^ +/gm, ''))
const view = (...list) => ({ now: NOW, items: new Map(list.map(one => [one.head.get('Id'), one])) })
const closedAsk = (more = '') => item(`Id: Q1\nKind: ask\nTitle: Which spade?\nState: withdrawn\nOwner: Digger\nSince: 2026-10-28 16:01\nAsks: provide\n\n## History\n- 2026-10-28 15:00 Digger: asked\n- 2026-10-28 16:01 person: withdrawn: obsolete: the hedge is planted${more}\n`)
const again = (more = '') => item(`Id: Q9\nKind: ask\nTitle: Which spade?\nState: open\nOwner: Digger\nSince: 2026-10-28 17:30\nFiled: ${new Date(2026, 9, 28, 17, 30).getTime()}\nAsks: provide\n${more}`)

test('an ask closed from the obsolete check that its chat asked again after the close is one finding, with both ids', () => {
  const found = rule.check(view(closedAsk(), again()))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['obsolete-wrong', 'obsolete-wrong Q1', 'Digger']])
  assert.match(found[0].text, /Digger asked again what the obsolete check closed: Q1 became Q9/)
  assert.match(found[0].evidence, /Q1 "which spade\?" was withdrawn at 16:01 as obsolete \(the hedge is planted\); Q9 asks it again, still open/)
})

test('no case: asked again before the close, by another chat, another title, answered since, a close by hand, or a close older than a day', () => {
  const before = item(`Id: Q9\nKind: ask\nTitle: Which spade?\nState: open\nOwner: Digger\nSince: 2026-10-28 14:00\nFiled: ${new Date(2026, 9, 28, 14, 0).getTime()}\nAsks: provide\n`)
  assert.deepEqual(rule.check(view(closedAsk(), before)), [], 'filed before the close')
  assert.deepEqual(rule.check(view(closedAsk(), item(`Id: Q9\nKind: ask\nTitle: Which spade?\nState: open\nOwner: Mason\nSince: 2026-10-28 17:30\nFiled: ${new Date(2026, 9, 28, 17, 30).getTime()}\nAsks: provide\n`))), [], 'another chat')
  assert.deepEqual(rule.check(view(closedAsk(), item(`Id: Q9\nKind: ask\nTitle: Which rake?\nState: open\nOwner: Digger\nSince: 2026-10-28 17:30\nFiled: ${new Date(2026, 9, 28, 17, 30).getTime()}\nAsks: provide\n`))), [], 'another question')
  assert.deepEqual(rule.check(view(closedAsk(), item(`Id: Q9\nKind: ask\nTitle: Which spade?\nState: answered\nOwner: Digger\nSince: 2026-10-28 17:30\nFiled: ${new Date(2026, 9, 28, 17, 30).getTime()}\nAsks: provide\n`))), [], 'answered since')
  const byHand = item('Id: Q1\nKind: ask\nTitle: Which spade?\nState: withdrawn\nOwner: Digger\nSince: 2026-10-28 16:01\nAsks: provide\n\n## History\n- 2026-10-28 16:01 person: withdrawn: no longer needed\n')
  assert.deepEqual(rule.check(view(byHand, again())), [], 'closed by hand')
  assert.deepEqual(rule.check({ ...view(closedAsk(), again()), now: NOW + 25 * 60 * 60_000 }), [], 'older than a day')
})

test('an incident closed from the obsolete check that came back is one finding; one that did not come back, or was closed by the partner, is none', () => {
  const closed = lines => item(`Id: X4\nKind: incident\nTitle: Painter unknown\nState: came back\nSource: sweep\nSubject: Painter\nKey: k\nSince: 2026-10-28 19:00\nFirst seen: 2026-10-28 09:20\n\n## History\n${lines.join('\n')}\n`)
  const found = rule.check(view(closed(['- 2026-10-28 16:01 person: closed: obsolete: it did not come back', '- 2026-10-28 19:00 server: came back (seen 2 times)'])))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['obsolete-wrong X4', 'X4']])
  assert.match(found[0].text, /X4 was closed from the obsolete check at 16:01 and came back/)
  assert.deepEqual(rule.check(view(closed(['- 2026-10-28 16:01 person: closed: obsolete: it did not come back']))), [], 'it did not come back')
  assert.deepEqual(rule.check(view(closed(['- 2026-10-28 16:01 Partner: closed: a false alarm', '- 2026-10-28 19:00 server: came back (seen 2 times)']))), [], 'the partner closed it')
  assert.deepEqual(rule.check(view(closed(['- 2026-10-28 18:00 server: came back (seen 2 times)', '- 2026-10-28 18:30 person: closed: obsolete: gone']))), [], 'it came back before the close')
})
