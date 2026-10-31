// B856: the Bugs tab's page, clicked through the DOM harness (B415): a tab beside Design, a screenshot added, what is wrong,
// where, "Report bug" sending the report, and "Your reports so far" with each report's state. Made-up samples only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage, reply } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const places = [{ id: 'game', name: 'Lava Tactics' }, { id: 'board', name: 'Worker board' }]
const bugs = (more = {}) => ({ canSend: true, why: null, limits: { wrong: 300, expected: 300, pictures: 5 }, places, reports: [], ...more })
const report = (id, state, more = {}) => ({ id, wrong: 'Half move squares', expected: '', where: 'game', state, picture: null, pictures: [], ...more })
const stateWith = more => asSent({ ...build([]), goalsEdit: { canWrite: true }, ...more })
const PATH = 'art-inbox/bugs/_new/0123456789abcdef.png'

/** A page whose Bugs tab is open, and whose board takes pictures and reports. */
async function open(state, answers) {
  const page = await openPage({ state, hash: 'bugs', answers: request => {
    const own = answers?.(request)
    if (own !== undefined) return own
    if (request.url === '/api/bugs/picture') return reply({ path: PATH })
    if (request.url === '/api/bugs') return reply({ step: 'B900' })
    return reply({})
  } })
  return page
}
const file = (page, name = 'screen.png', type = 'image/png') => new page.window.File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type })
/** The person picks a file from disk: the file input holds it and says it changed. */
async function pick(page, ...files) {
  Object.defineProperty(page.find('#bugs-file'), 'files', { value: files, configurable: true })
  await page.change('#bugs-file', false)
}
/** The person pastes with Ctrl+V: the clipboard holds these entries ({ kind, type, getAsFile }). */
async function paste(page, items, target = page.document) {
  target.dispatchEvent(new page.window.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: { items } }))
  await new Promise(done => setTimeout(done, 5))
}

test('the Bugs tab sits beside Design; the Design tab stays; the address #bugs opens it', async () => {
  const page = await openPage({ state: stateWith({ bugs: bugs() }), hash: 'bugs' })
  try {
    const tabs = page.all('.tab').map(one => one.dataset.tab)
    assert.ok(tabs.indexOf('bugs') === tabs.indexOf('design') + 1, tabs.join())
    assert.equal(page.find('#view-bugs').hidden, false)
    assert.equal(page.find('#view-design').hidden, true)
    await page.click('[data-tab="design"]')
    assert.deepEqual([page.find('#view-bugs').hidden, page.find('#view-design').hidden], [true, false])
    await page.click('[data-tab="bugs"]')
    assert.equal(page.find('#view-bugs').hidden, false)
    assert.equal(page.window.location.hash, '#bugs')
    // The two places are the project's own name and the board.
    assert.deepEqual(page.all('#bugs-where [data-where]').map(one => [one.dataset.where, one.textContent]), [['game', 'Lava Tactics'], ['board', 'Worker board']])
  } finally { await page.close() }
})

test('"Report bug" needs what is wrong and where, and sends nothing until both are said', async () => {
  const page = await open(stateWith({ bugs: bugs() }))
  try {
    await page.click('#bugs-report')
    assert.equal(page.text('#bugs-problem'), 'Say what is wrong, in one line.')
    await page.type('#bugs-wrong', 'The lane flickers')
    await page.click('#bugs-report')
    assert.equal(page.text('#bugs-problem'), 'Say where it is wrong: Lava Tactics or Worker board.')
    assert.deepEqual(page.sent('/api/bugs'), [])
  } finally { await page.close() }
})

test('a screenshot is kept by the board, shown as a thumbnail with a way to leave it out, and goes with the report', async () => {
  const page = await open(stateWith({ bugs: bugs() }))
  try {
    await pick(page, file(page))
    const kept = page.sent('/api/bugs/picture')
    assert.equal(kept.length, 1)
    assert.equal(kept[0].headers['Content-Type'], 'image/png')
    assert.equal(page.all('#bugs-pictures .design-reference').length, 1)
    // Leaving it out empties the row again; adding it once more, the report carries it.
    await page.click('#bugs-pictures [data-remove-shot="0"]')
    assert.equal(page.all('#bugs-pictures .design-reference').length, 0)
    await paste(page, [{ kind: 'file', type: 'image/png', getAsFile: () => file(page) }])
    assert.equal(page.sent('/api/bugs/picture').length, 2)
    assert.equal(page.all('#bugs-pictures .design-reference').length, 1)
    await page.type('#bugs-wrong', '  The move squares are\n cut in half ')
    await page.type('#bugs-expected', 'Whole squares')
    await page.click('#bugs-where [data-where="board"]')
    await page.click('#bugs-report')
    assert.deepEqual(page.sent('/api/bugs').map(one => one.body), [{ action: 'report', wrong: 'The move squares are cut in half', expected: 'Whole squares', where: 'board', pictures: [PATH] }])
    // It answers with the step, linked; the form is empty for the next report.
    assert.equal(page.text('#bugs-sent').startsWith('Reported as B900'), true)
    assert.equal(page.find('#bugs-sent a').getAttribute('href'), '#details=B900')
    assert.deepEqual([page.find('#bugs-wrong').value, page.find('#bugs-expected').value, page.all('#bugs-pictures .design-reference').length], ['', '', 0])
  } finally { await page.close() }
})

test('a report the board refuses shows its words, and keeps what was typed', async () => {
  const page = await open(stateWith({ bugs: bugs() }), request => (request.url === '/api/bugs' ? reply('This board only shows.', 409) : undefined))
  try {
    await page.type('#bugs-wrong', 'The lane flickers')
    await page.click('#bugs-where [data-where="game"]')
    await page.click('#bugs-report')
    assert.equal(page.text('#bugs-problem'), 'Not done: This board only shows.')
    assert.equal(page.find('#bugs-wrong').value, 'The lane flickers')
  } finally { await page.close() }
})

test('a picture that is no PNG, JPEG or WebP is not sent; a board that cannot file says why and takes no report', async () => {
  const page = await open(stateWith({ bugs: bugs({ canSend: false, why: 'This is the demo: it files nothing.' }) }))
  try {
    assert.equal(page.find('#bugs-note').hidden, false)
    assert.equal(page.text('#bugs-note'), 'This is the demo: it files nothing.')
    assert.equal(page.find('#bugs-report').disabled, true)
    await pick(page, file(page, 'a.svg', 'image/svg+xml'))
    assert.equal(page.text('#bugs-problem'), 'A screenshot is a PNG, JPEG or WebP picture.')
    await paste(page, [{ kind: 'file', type: 'image/gif', getAsFile: () => file(page, 'a.gif', 'image/gif') }])
    assert.equal(page.text('#bugs-problem'), 'A screenshot is a PNG, JPEG or WebP picture.')
    assert.deepEqual(page.sent('/api/bugs/picture'), [])
  } finally { await page.close() }
})

test('"Your reports so far": each report with its words, where, its state in plain words and a link to its step', async () => {
  const reports = [
    report('B903', 'waiting', { wrong: 'The lane flickers', where: 'board' }),
    report('B902', 'fixing', { expected: 'Whole squares', picture: 'art-inbox/bugs/B902/picture-1.png', pictures: ['art-inbox/bugs/B902/picture-1.png'] }),
    report('B901', 'fixed'),
    report('B900', 'dropped'),
  ]
  const page = await open(stateWith({ bugs: bugs({ reports }) }))
  try {
    assert.equal(page.find('#bugs-empty').hidden, true)
    const rows = page.all('#bugs-list .bugs-report')
    assert.deepEqual(rows.map(one => [one.querySelector('.bugs-id').textContent, one.querySelector('.bugs-id').getAttribute('href'), one.querySelector('.design-badge').textContent]),
      [['B903', '#details=B903', 'Waiting'], ['B902', '#details=B902', 'Being fixed'], ['B901', '#details=B901', 'Fixed'], ['B900', '#details=B900', 'Dropped']])
    assert.equal(rows[0].querySelector('.bugs-words .muted').textContent, 'Worker board')
    assert.equal(rows[1].querySelector('.bugs-words .muted').textContent, 'Lava Tactics · expected: Whole squares')
    assert.equal(rows[1].querySelector('.picture') !== null || rows[1].querySelector('img') !== null, true)
    assert.equal(rows[0].querySelector('.bugs-nopicture') !== null, true)
    assert.equal(rows[0].querySelector('.bugs-words b').textContent, 'The lane flickers')
  } finally { await page.close() }
  const none = await open(stateWith({ bugs: bugs() }))
  try { assert.equal(none.find('#bugs-empty').hidden, false) } finally { await none.close() }
})

test('a board without the Bugs part says so and takes nothing', async () => {
  const page = await open(stateWith({}))
  try {
    assert.equal(page.find('#bugs-note').hidden, false)
    assert.match(page.text('#bugs-note'), /no Bugs part yet/)
    assert.equal(page.find('#bugs-report').disabled, true)
    assert.equal(page.find('#bugs-wrong').disabled, true)
  } finally { await page.close() }
})

test('Ctrl+V on the tab: text pasted into a field stays text; a clipboard without a picture says so; other tabs are left alone', async () => {
  const page = await open(stateWith({ bugs: bugs() }))
  try {
    const field = page.find('#bugs-wrong')
    await paste(page, [{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/png', getAsFile: () => file(page) }], field)
    assert.deepEqual(page.sent('/api/bugs/picture'), [])
    await paste(page, [{ kind: 'string', type: 'text/plain' }])
    assert.equal(page.text('#bugs-problem'), 'The clipboard holds no picture: copy one, or add one from disk.')
    // Two pictures at once are both taken (up to the limit).
    await paste(page, [{ kind: 'file', type: 'image/png', getAsFile: () => file(page) }, { kind: 'file', type: 'image/jpeg', getAsFile: () => file(page, 'b.jpg', 'image/jpeg') }])
    assert.equal(page.sent('/api/bugs/picture').length, 2)
    await page.click('[data-tab="design"]')
    await paste(page, [{ kind: 'file', type: 'image/png', getAsFile: () => file(page) }])
    assert.equal(page.sent('/api/bugs/picture').length, 2)
  } finally { await page.close() }
})
