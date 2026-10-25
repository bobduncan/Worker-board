// Redesign Part 2 (2026-10-25): the reconciler runs at every refresh and the moment a chat reports idle (principle 1: a
// free worker gets its task at once). Two reasons at once must neither run it twice side by side nor lose the later one
// (principle 5): a call while it runs makes exactly one more run after it, however many calls came meanwhile.

/** `run` wrapped: one run at a time; a call during a run makes one more run after it. Answers when its run is done. */
export function coalesce(run) {
  let running = null
  let again = null
  const start = () => {
    running = Promise.resolve().then(run).catch(() => {}).finally(() => {
      running = null
    })
    return running
  }
  return () => {
    if (running === null) return start()
    if (again === null) {
      again = running.then(() => {
        again = null
        return start()
      })
    }
    return again
  }
}
