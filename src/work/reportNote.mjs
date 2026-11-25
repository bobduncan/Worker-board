// F65 (chat 1, 2026-11-25): the board's note to the main chat about a report (Via: report) carried the result cut at 200 characters,
// mid-word ("... finds Codex in th", N2414), and the main chat passed the cut words on. A report's result is long (about 1,500
// characters, at most RESULT_CHARS), so the note keeps whole sentences of it up to REPORT_NOTE_CHARS and names the step that holds the
// whole report; a first sentence longer than that is cut at a word's end, with "…".

/** How many characters of a report's result the note to the main chat keeps (in practice its "Context: ..." and "Change: ..."). */
export const REPORT_NOTE_CHARS = 500

/** The sentences of `text`: each ends with ".", "!" or "?" (a closing quote or bracket after it belongs to it), or at the text's end. */
const sentencesOf = text => text.split(/(?<=[.!?]["')\]]?)\s+/).filter(one => one !== '')

/**
 * The words of `result` the report's note carries: the whole result when it fits in `most` characters; else its whole sentences
 * that fit, or (a first sentence longer than `most`) that sentence cut at a word's end with "…"; then " (whole report on <id>)".
 */
export function reportNoteWords(result, id, most = REPORT_NOTE_CHARS) {
  const words = typeof result === 'string' ? result.replace(/\s+/g, ' ').trim() : ''
  if (words.length <= most) return words
  let kept = ''
  for (const sentence of sentencesOf(words)) {
    const next = kept === '' ? sentence : `${kept} ${sentence}`
    if (next.length > most) break
    kept = next
  }
  if (kept === '') {
    // One character is the "…".
    const cut = words.slice(0, most - 1)
    kept = `${/\s/.test(words[most - 1] ?? ' ') ? cut.trimEnd() : cut.replace(/\s+\S*$/, '').trimEnd()}…`
  }
  return `${kept} (whole report on ${id})`
}

/** The note's line: "<id> reported [again ]by <who>: <words>" (`reportNoteWords`). */
export const reportNoteLine = ({ id, who, result, again = false }) => `${id} reported ${again ? 'again ' : ''}by ${who}: ${reportNoteWords(result, id)}`
