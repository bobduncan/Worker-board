// B317, B417: what the Workers mod does with the "For you" block a chat ends its answer with. It reads none of it
// (robustness page, place 6: three readers parsed the block three ways): the board reads it once, with its one
// grammar (src/forYouGrammar.mjs), from the answer's tail the mod sends with the turn's end (`forYouTail`), files the
// items the chat filed no ask for, and answers how many it read (`asks`) and could not file (`unfiled`).

/** What of an answer's end goes with the turn's end, in characters: the block stands at its end, and the board's call takes 16 KB (JSON escapes double some characters). */
export const TAIL_CHARS = 7000

/** The start of the last line that looks like a block's title (a loose test, not a reading of the block), or -1. */
function lastTitleAt(answer: string): number {
  let at = -1
  for (const found of answer.matchAll(/^[ 	]*>[ 	]*\*{0,2}[ 	]*(?:for you|needs your attention)/gim)) at = found.index ?? at
  return at
}

/**
 * What goes with the turn's end for the board to read the block in: the answer from its last "For you" title on (so the
 * title is never cut off), at most `TAIL_CHARS`; '' when the answer names no such title, so an answer without one sends
 * nothing. The board decides what it is.
 */
export function forYouTail(answer: unknown): string {
  if (typeof answer !== 'string') return ''
  const at = lastTitleAt(answer)
  return at < 0 ? '' : answer.slice(at, at + TAIL_CHARS)
}

/**
 * True when the block, from its title to the answer's end, is longer than what `forYouTail` sends: the board cannot see
 * its end, so it files nothing; the chat asked all the same, so it is never cleared (the board's `asks` cannot say).
 */
export function isForYouCut(answer: unknown): boolean {
  if (typeof answer !== 'string') return false
  const at = lastTitleAt(answer)
  return at >= 0 && answer.length - at > TAIL_CHARS
}

/**
 * B317: the line beside the chat's next prompt, once, naming the asks the board filed from its last "For you" block,
 * so it can close one the person answers in the chat instead; null when there are none.
 */
export function blockAsksLine(ids: readonly unknown[]): string | null {
  const own = ids.filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id))
  if (own.length === 0) return null
  return `Filed on the worker board from your last "For you" block: ${own.join(', ')}. The person answers there; if they answer one here in the chat instead, close it with work answered-in-chat <id> and their words.`
}

/** B480: the most items of a block the line names as left out, each cut to its board's words. */
const LEFT_SHOWN = 9

/**
 * B480: the line beside the chat's next prompt, once, naming the items of its last "For you" block that the board left
 * out as asked already (each its start and why, as the board says it), so a chat whose new question only looked alike
 * files it with the work tool; null when there are none.
 */
export function leftOutLine(left: readonly unknown[]): string | null {
  const said = left.filter((one): one is string => typeof one === 'string' && one.trim() !== '').slice(0, LEFT_SHOWN)
  if (said.length === 0) return null
  return `Not filed on the worker board from your last "For you" block, as asked already: ${said.join('; ')}. If one of them is a new question after all, file it with work ask.`
}
