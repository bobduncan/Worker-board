// The backup focus (the person, 2026-11-24): its card on the Focus page under the focus, clicked as the person does, and the
// settings panel's "Any backlog task when idle". The state is built by the real buildState; made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const MAP = ['# Goals', 'Last id: G3', 'Focus: G1', '', '- [~] G1 Garden', '  Done when: ten visitors in a week', '  Goal definition: calm',
  '  Goal definition agreed: 2026-10-18 10:00', '- [ ] G2 Pond', '  Done when: fish swim in it', '- [ ] G3 Gate', '']
const stateOf = (lines, more = {}) => asSent({ ...build([], undefined, lines.join('\n')), goalsEdit: { canWrite: true }, ...more })
const withBackup = (...extra) => MAP.map(line => (line === 'Focus: G1' ? 'Focus: G1\nBackup: G2' : line === '  Done when: fish swim in it' ? [line, ...extra].join('\n') : line))

test('no backup: the card lists the open goals with a Done when, not the focus; Set as backup sends the one picked', async () => {
  const page = await openPage({ state: stateOf(MAP) })
  try {
    await page.click('[data-tab="advice"]')
    assert.match(page.text('.focus-backup h3'), /^Backup focus$/)
    assert.deepEqual(page.all('.focus-backup option').map(one => one.value), ['G2'])
    await page.click('[data-focus-act="backup-set"]')
    assert.deepEqual(page.sent('/api/goals').map(one => one.body), [{ command: 'backup', id: 'G2' }])
  } finally {
    await page.close()
  }
})

test('a backup without its goal definition yet: its card says the partner drafts it; Remove sends the backup away', async () => {
  const page = await openPage({ state: stateOf(withBackup()) })
  try {
    await page.click('[data-tab="advice"]')
    assert.equal(page.text('.focus-backup h3'), 'Backup focus: G2 · Pond')
    assert.match(page.find('.focus-backup').textContent, /Your partner drafts its goal definition\./)
    assert.equal(page.find('[data-focus-act="backup-vibe-agree"]').disabled, true)
    await page.click('[data-focus-act="backup-clear"]')
    assert.deepEqual(page.sent('/api/goals').map(one => one.body), [{ command: 'backup', id: null }])
  } finally {
    await page.close()
  }
})

test('a drafted goal definition is agreed on the card; Not yet opens a box whose words go as the backup\'s not yet', async () => {
  const page = await openPage({ state: stateOf(withBackup('  Goal definition: koi and lilies')) })
  try {
    await page.click('[data-tab="advice"]')
    assert.deepEqual(page.all('.focus-backup li').map(one => one.textContent), ['koi and lilies'])
    await page.click('[data-focus-act="backup-vibe-agree"]')
    await page.click('[data-focus-act="backup-vibe-not-yet"]')
    const box = page.find('#focus-backup-words')
    box.value = 'more frogs'
    box.dispatchEvent(new page.window.Event('input', { bubbles: true }))
    await page.click('[data-focus-act="backup-send-not-yet"]')
    assert.deepEqual(page.sent('/api/goals').map(one => one.body), [{ command: 'vibe-agree', id: 'G2' }, { command: 'vibe-not-yet', id: 'G2', text: 'more frogs' }])
  } finally {
    await page.close()
  }
})

test('the backup\'s work blocks: Go sends how-go for the backup; after Go the card says its tasks are made', async () => {
  const blocks = ['  Goal definition: koi', '  Goal definition agreed: 2026-10-18 11:00', '  Part: Dig the pond · about 2 h · done when: it holds water']
  const how = withBackup(...blocks)
  const page = await openPage({ state: stateOf(how) })
  try {
    await page.click('[data-tab="advice"]')
    assert.deepEqual(page.all('.focus-backup li').map(one => one.textContent), ['Dig the pond · done when: it holds water'])
    await page.click('[data-focus-act="backup-how-go"]')
    assert.deepEqual(page.sent('/api/goals').map(one => one.body), [{ command: 'how-go', id: 'G2' }])
  } finally {
    await page.close()
  }
  const run = await openPage({ state: stateOf(withBackup(...blocks, '  How agreed: 2026-10-18 12:00')) })
  try {
    await run.click('[data-tab="advice"]')
    assert.match(run.find('.focus-backup').textContent, /Go is given: your partner makes its tasks\./)
  } finally {
    await run.close()
  }
})

test('the settings panel shows "Any backlog task when idle" with Off lit by default', async () => {
  const page = await openPage({ state: stateOf(MAP, { boardSettings: { approveRebuilds: false, maxWorkers: 5, autopilot: false, handOutBeyondFocus: false, canSet: true, whyNot: null } }) })
  try {
    assert.equal(page.find('#beyond-focus').hidden, false)
    assert.equal(page.find('[data-setting="handOutBeyondFocus"][data-value="false"]').classList.contains('is-on'), true)
    await page.click('[data-setting="handOutBeyondFocus"][data-value="true"]')
    assert.deepEqual(page.sent('/api/settings').map(one => one.body), [{ key: 'handOutBeyondFocus', value: true }])
  } finally {
    await page.close()
  }
})
