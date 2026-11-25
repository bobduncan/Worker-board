// F65 (chat 1, 2026-11-25): the note to the main chat about a report kept the result cut at 200 characters, mid-word (N2414, N2416,
// N2423). It keeps whole sentences now and names the step that holds the whole report.

import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORT_NOTE_CHARS, reportNoteLine, reportNoteWords } from '../../src/work/reportNote.mjs'

/** B1311's result as Worker 5 reported it on 2026-11-25 at 10:58 (N2414 carried "... The board now also finds Codex in th"). */
const B1311 = 'Context: The Codex app now updates itself as a Microsoft Store package, so the board could not find it and picture requests stopped with "Codex not found". Change: The board now also finds Codex in the Store package by its name, and a Codex path in the settings that is gone falls back to that search; the check says which Codex it uses and when the set path is gone. Details: Landed ef13c367 on both boards (src/codex.mjs findStoreCodex + findCodex order: set path, Codex app folder, PATH, Store on Windows only; src/providers/codex.mjs check detail; README item 9; tests in codex, providers, providersChoose). Real case on this PC: with LOCALAPPDATA and PATH on an empty folder, findCodex found the Store codex.exe, it answers --version and login status. Tests bite: Store lookup taken out in a copy → the Store-package test failed; gone set path returning null again → the fallback assertions failed; windowsHide dropped → the hidden-call assertion failed; timeout dropped → the time-limit assertion failed; platform check dropped → the Mac/Linux never-asked test failed. Chat 1\x27s nit (a PC with no Codex at all starts a hidden PowerShell per check; keep a short "not found" too) is left for a later step. (merged ef13c367) (merged ef13c367)'

/** Every word of `kept` (its last one before the "…" or the pointer too) is a whole word of `whole`. */
const wholeWords = (kept, whole) => {
  const words = new Set(whole.split(/\s+/))
  return kept.replace(/ \(whole report on B\d+\)$/, '').replace(/…$/, '').split(/\s+/).every(word => words.has(word))
}

test('F65, the real N2414: whole sentences (Context and Change), no word cut in half, and the step that holds the whole report', () => {
  const line = reportNoteLine({ id: 'B1311', who: 'Worker 5', result: B1311 })
  assert.ok(line.startsWith('B1311 reported by Worker 5: Context: The Codex app now updates itself as a Microsoft Store package,'), line)
  assert.ok(line.endsWith(' (whole report on B1311)'), line)
  assert.ok(line.includes('Change: The board now also finds Codex in the Store package by its name,'), line)
  assert.ok(line.includes('when the set path is gone. (whole report on B1311)'), 'it ends at the Change sentence\'s end')
  assert.ok(!line.includes('Details:'), 'the details stay on the step')
  const words = reportNoteWords(B1311, 'B1311')
  assert.ok(words.length <= REPORT_NOTE_CHARS + ' (whole report on B1311)'.length, String(words.length))
  assert.ok(wholeWords(words, B1311), words)
  assert.ok(B1311.startsWith(words.replace(/ \(whole report on B1311\)$/, '')), 'a start of the result, as written')
})

test('F65: a result that fits is carried whole, with no pointer; "again" and the spaces as before', () => {
  assert.equal(reportNoteLine({ id: 'B1', who: 'Board', result: 'The strip  shows on\nthe board.' }), 'B1 reported by Board: The strip shows on the board.')
  assert.equal(reportNoteLine({ id: 'B1', who: 'Board', result: 'Done.', again: true }), 'B1 reported again by Board: Done.')
  const fits = 'a'.repeat(REPORT_NOTE_CHARS)
  assert.equal(reportNoteWords(fits, 'B2'), fits)
})

test('F65: a first sentence longer than the note is cut at a word\'s end with "…"; a quote closing a sentence stays with it', () => {
  // Words of 7 letters: the note's last character (the 499th) falls inside a word, which goes whole.
  const long = `${'Codexes '.repeat(80).trim()}.`
  const words = reportNoteWords(long, 'B7')
  assert.equal(words, `${'Codexes '.repeat(62).trim()}… (whole report on B7)`)
  assert.ok(wholeWords(words, long), words)
  assert.ok(words.length <= REPORT_NOTE_CHARS + ' (whole report on B7)'.length)
  // The cut falling on a space keeps the word before it.
  const even = `${'Codexes '.repeat(62)}abc more.`
  assert.equal(reportNoteWords(even, 'B9'), `${'Codexes '.repeat(62)}abc… (whole report on B9)`)
  const quoted = `It said "stop." ${'x '.repeat(300)}`
  assert.equal(reportNoteWords(quoted, 'B8'), 'It said "stop." (whole report on B8)')
})
