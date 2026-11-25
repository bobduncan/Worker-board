// F65 (chat 1, 2026-11-25): the board's note to the main chat about a report (Via: report) carried the result cut at 200 characters,
// mid-word ("... finds Codex in th", N2414), and the main chat passed the cut words on. A report's result is long (about 1,500
// characters, at most RESULT_CHARS), so the note keeps whole sentences of it up to REPORT_NOTE_CHARS and names the step that holds the
// whole report; a first sentence longer than that is cut at a word's end, with "…". Chat 1's review: every note's one-line `Text`
// (the board page shows it) is cut at a word's end with "…" too (`wordCut`, api.mjs `makeNote`).

/** How many characters of a report's result the note to the main chat keeps (in practice its "Context: ..." and "Change: ..."). */
export const REPORT_NOTE_CHARS = 500

/** The sentences of `text`: each ends with ".", "!" or "?" (a closing quote or bracket after it belongs to it), or at the text's end. */
const sentencesOf = text => text.split(/(?<=[.!?]["')\]]?)\s+/).filter(one => one !== '')

/** `text` on one line (its spaces as one), at most `most` characters: when longer, cut at a word's end with "…" (its last character). */
export function wordCut(text, most) {
  const words = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (words.length <= most) return words
  // One character is the "…"; a word the cut falls in goes whole (one longer than the whole line is cut all the same).
  const cut = words.slice(0, most - 1)
  return `${/\s/.test(words[most - 1] ?? ' ') ? cut.trimEnd() : (cut.replace(/\s+\S*$/, '').trimEnd() || cut)}…`
}

/**
 * The words of `result` the report's note carries: the whole result when it fits in `most` characters; else its whole sentences
 * that fit, or (a first sentence longer than `most`) that sentence cut at a word's end with "…"; then " (whole report on <id>)".
 */
export function reportNoteWords(result, id, most = REPORT_NOTE_CHARS) {
  const words = wordCut(result, Infinity)
  if (words.length <= most) return words
  let kept = ''
  for (const sentence of sentencesOf(words)) {
    const next = kept === '' ? sentence : `${kept} ${sentence}`
    if (next.length > most) break
    kept = next
  }
  return `${kept === '' ? wordCut(words, most) : kept} (whole report on ${id})`
}

/** The note's line: "<id> reported [again ]by <who>: <words>" (`reportNoteWords`). */
export const reportNoteLine = ({ id, who, result, again = false }) => `${id} reported ${again ? 'again ' : ''}by ${who}: ${reportNoteWords(result, id)}`
