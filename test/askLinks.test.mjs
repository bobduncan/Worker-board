// B397: an ask's words carry what the person needs to decide. A Q or B id in them opens that ask or step, a page of
// the project they name opens read-only (a picture in the picture popup), and an ask that points to one other open
// ask shows that ask inline. The person, 2026-10-19, on an ask that named another: "i dont have enough information
// to make a decision. where can i find Q202, i need a link in the future". Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const context = {}
vm.runInNewContext(`${script.slice(script.indexOf('// asklinks:start'), script.indexOf('// asklinks:end'))}\nthis.askLinkPieces = askLinkPieces\nthis.pointedAsk = pointedAsk`, context)
const plain = value => JSON.parse(JSON.stringify(value))

const known = { isAsk: id => ['Q7', 'Q12'].includes(id), isStep: id => ['B3', 'B40'].includes(id) }
const pieces = text => plain(context.askLinkPieces(text, known))

test('a Q id of an ask the board knows is a link to that ask; an unknown one stays words', () => {
  assert.deepEqual(pieces('Q12 in Needs your attention: which hedge?'), [{ ask: 'Q12' }, ' in Needs your attention: which hedge?'])
  assert.deepEqual(pieces('See Q7, not Q99.'), ['See ', { ask: 'Q7' }, ', not Q99.'])
  // A word that only holds the letters is no id.
  assert.deepEqual(pieces('XQ7 and Q7b'), ['XQ7 and Q7b'])
})

test('a B id of a step the board knows is a link to that step', () => {
  assert.deepEqual(pieces('Made in B40 (after B3); B999 is gone.'), ['Made in ', { step: 'B40' }, ' (after ', { step: 'B3' }, '); B999 is gone.'])
})

test('a page of the project the words name is a link: a text page, or a picture', () => {
  assert.deepEqual(pieces('Read garden/docs/advisor/hedges-2026-10.md.'), ['Read ', { path: 'garden/docs/advisor/hedges-2026-10.md', isPicture: false }, '.'])
  assert.deepEqual(pieces('the picture (pictures/hedge/b3/side.png) and notes.txt'), ['the picture (', { path: 'pictures/hedge/b3/side.png', isPicture: true }, ') and notes.txt'])
  assert.deepEqual(pieces('`docs/plan.md`'), ['`', { path: 'docs/plan.md', isPicture: false }, '`'])
  // Inside a web address, a backslash path, a path leading out, or a file the board does not show: words.
  assert.deepEqual(pieces('http://127.0.0.1:4310/#picture=pictures/x.png'), ['http://127.0.0.1:4310/#picture=pictures/x.png'])
  assert.deepEqual(pieces('docs\\plan.md ../secret/plan.md docs/tool.exe'), ['docs\\plan.md ../secret/plan.md docs/tool.exe'])
})

test('an id inside a path, a file name or an address is no link, and a path whose folder looks like an id still is', () => {
  assert.deepEqual(pieces('http://127.0.0.1:4310/#picture=pictures/Q12-side.png'), ['http://127.0.0.1:4310/#picture=pictures/Q12-side.png'])
  assert.deepEqual(pieces('file:docs/Q12.md'), ['file:docs/Q12.md'])
  assert.deepEqual(pieces('Q12/plan.md and b3/side.png'), [{ path: 'Q12/plan.md', isPicture: false }, ' and ', { path: 'b3/side.png', isPicture: true }])
  // A longer ending is another file: no link to the shorter one.
  assert.deepEqual(pieces('docs/a.md.bak'), ['docs/a.md.bak'])
  // An id before a stop or a comma is one.
  assert.deepEqual(pieces('Q12. Then B3, done'), [{ ask: 'Q12' }, '. Then ', { step: 'B3' }, ', done'])
})

test('no words, no links', () => {
  assert.deepEqual(pieces(''), [])
  assert.deepEqual(pieces('Plant the hedge.'), ['Plant the hedge.'])
})

const ask = (workId, question, text = '') => ({ id: `work:${workId}`, workId, question, title: question, text, options: [], canAnswer: true, isClosed: false })

test('an ask that names one other open ask shows that one inline', () => {
  const asked = ask('Q12', 'Which hedge comes first? A yew, B box; I advise A')
  const pointer = ask('Q13', 'Q12 in Needs your attention: which hedge comes first; I advise A')
  assert.equal(context.pointedAsk(pointer, [asked, pointer])?.workId, 'Q12')
  // Its own id, an ask that is not open, or two asks named: nothing inline.
  assert.equal(context.pointedAsk(asked, [asked, pointer]), null)
  assert.equal(context.pointedAsk(ask('Q14', 'Like Q99?'), [asked]), null)
  assert.equal(context.pointedAsk(ask('Q15', 'Q12 or Q7?'), [asked, ask('Q7', 'Which gate?')]), null)
  // An answered ask, or a Q id inside a path, is not pointed to.
  assert.equal(context.pointedAsk(pointer, [{ ...asked, canAnswer: false }, pointer]), null)
  assert.equal(context.pointedAsk(ask('Q17', 'See docs/Q12.md'), [asked]), null)
  // The id may stand in its text too.
  assert.equal(context.pointedAsk(ask('Q16', 'Decide the hedge.', 'It is Q12, waiting.'), [asked])?.workId, 'Q12')
})
