# Testing the board's page by clicking it (B415)

`test/pageHarness.mjs` loads `public/index.html` and `public/board.js` in happy-dom, the board's first npm dependency
(dev only), with a fake `fetch`. A test hands the page the state the board would send, clicks and types like the person,
and reads the page and the requests it made. It never matches the page's source text: a reworded line cannot fail it, a
wrong behaviour cannot hide behind the words.

```js
import { openPage, reply, TOKEN } from './pageHarness.mjs'

test('Undo takes the answer back', async () => {
  const page = await openPage({ state })               // state: what GET /api/state answers (plain JSON)
  try {
    await page.click('[data-decided="toggle"]')        // a real click; the page's handlers see it bubble
    await page.click('[data-take-back="Q5"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'undo', id: 'Q5' }])
    assert.equal(page.text('.decided-for-you h3'), '...')
  } finally { await page.close() }                     // always: it stops the page's timers
})
```

- **The state:** build it with the real `buildState` (see `test/partnerState.mjs`, `asSent` makes it plain JSON). The
  board adds fields the state builder does not (`goalsEdit`, ...): add them by hand, as the server does.
- **Answers:** `openPage({ answers: request => reply('refused words', 409) })` answers every request except
  `/api/state`; the default is `200 {}`. `page.requests` holds every request (`url`, `method`, `headers`, parsed `body`);
  `page.sent(url, action?)` filters the POSTs.
- **Acting:** `page.click(selector)`, `page.change(selector, checked)`; each waits until the page's promises settled.
  `page.find`, `page.all`, `page.text` read the page. `page.constants` holds the page's own `MIN`, `HOUR`, `STATES` and
  `KINDS`: use them, do not copy them.
- **Not simulated:** layout, CSS, scrolling, real timers (a read every 30 s). Test those with a view function or by
  hand. A page test that needs a tab other than Overview clicks it: `page.click('[data-tab="advice"]')`.
- **Migrating a file:** replace each `assert.match(script, /.../)` by what the line makes happen: the request body, the
  text, the class. `test/partnerAnswersPage.test.mjs` is the model.
