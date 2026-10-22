import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

const BOARD = {
  points: [100, 200],
  categories: [
    {
      id: 1,
      name: 'Geography',
      questions: {
        100: { id: 11, question: 'Longest river in Africa?', answer: 'The Nile', image: null },
        200: { id: 12, question: 'Which flag is this?', answer: 'Japan', image: 'img/questions/jp.svg' },
      },
    },
    {
      id: 2,
      name: 'Science',
      questions: {
        100: { id: 21, question: 'Chemical symbol for gold?', answer: 'Au', image: null },
        200: { id: 22, question: 'Closest planet to the Sun?', answer: 'Mercury', image: null },
      },
    },
  ],
}

const ANSWERS: Record<number, string> = { 11: 'The Nile', 21: 'Au', 22: 'Mercury' }

/** Everything beneath the mod: store, clock, commands, status line, the site, the engine's band. */
function world(on: On, { isOnline = true } = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  const statuses: (string | undefined)[] = []
  const bodies: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const reply = (status: number, text: string) => ({ value: { status, ok: status < 300, headers: {}, text } })
  on('http.fetch', ($, e) => {
    if (!isOnline) {
      return reply(503, '')
    }
    if (e.url.includes('categories.php')) {
      return reply(200, JSON.stringify([{ id: 1 }, { id: 2 }]))
    }
    // Like the site, each draw holds questions not shown before: ids move up by 100 per draw.
    bodies.push(e.init?.body ?? '')
    const shift = 100 * bodies.length
    const board = {
      ...BOARD,
      categories: BOARD.categories.map(c => ({
        ...c,
        questions: Object.fromEntries(Object.entries(c.questions).map(([p, q]) => [p, { ...q, id: q.id + shift }])),
      })),
    }
    return reply(200, JSON.stringify(board))
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="engine">
        <Text>engine</Text>
      </Box>
    )
  })
  return { clock, statuses, bodies }
}

const band = (isWorking: boolean) => ({
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
})

async function start($: Engine, clock: MockClock) {
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

test('the band stays out of the way while Claude is idle', async ($, on) => {
  const { clock } = world(on)
  await start($, clock)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'brainrush-trivia', surface, ...band(false) })
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    expect(await ui.find({ key: 'reveal' })).toBeUndefined()
    await ui.unmount()
  }
})

test('while working it asks a text question, reveals it, and scores it', async ($, on) => {
  const { clock } = world(on)
  await start($, clock)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'brainrush-trivia', surface, ...band(true) })
    expect(await ui.find({ key: 'engine' })).toBeUndefined()
    expect(await ui.find({ text: 'Which flag is this?' })).toBeUndefined()
    expect(await ui.find({ key: 'answer' })).toBeUndefined()

    await ui.press({ key: 'reveal' })
    const answer = await ui.find({ key: 'answer' })
    expect(answer).toBeDefined()
    expect(Object.values(ANSWERS).some(a => answer?.text.includes(a))).toBe(true)

    await ui.press({ key: 'right' })
    await clock.settle()
    expect((await ui.find({ key: 'score' }))?.text).toContain('1/1')
    expect(await ui.find({ key: 'reveal' })).toBeDefined()

    await ui.press({ key: 'reveal' })
    await ui.press({ key: 'wrong' })
    await clock.settle()
    expect((await ui.find({ key: 'score' }))?.text).toContain('1/2')
    await ui.unmount()
    await $.command.run({ command: 'trivia', args: 'reset', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  }
})

test('shown questions are sent back as seen on the next draw', async ($, on) => {
  const { clock, bodies } = world(on)
  await start($, clock)
  const ui = await $.ui.mount({ plugin: 'brainrush-trivia', surface: 'terminal', ...band(true) })
  await ui.press({ key: 'skip' })
  await clock.settle()
  expect(bodies.length).toBeGreaterThan(1)
  const seen = JSON.parse(bodies[bodies.length - 1] ?? '{}').seen as number[]
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.every(id => id % 100 in ANSWERS)).toBe(true)
  await ui.unmount()
})

test('offline: no band, and the status line says so', async ($, on) => {
  const { clock, statuses } = world(on, { isOnline: false })
  await start($, clock)
  const ui = await $.ui.mount({ plugin: 'brainrush-trivia', surface: 'terminal', ...band(true) })
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(statuses).toContain('BrainRush trivia: offline')
  await ui.unmount()
})

test('/trivia off hides the band and /trivia on brings it back', async ($, on) => {
  const { clock } = world(on)
  await start($, clock)
  const run = (args: string) =>
    $.command.run({ command: 'trivia', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect((await run('off')).text).toContain('is off')
  const ui = await $.ui.mount({ plugin: 'brainrush-trivia', surface: 'terminal', ...band(true) })
  expect(await ui.find({ key: 'reveal' })).toBeUndefined()
  expect((await run('on')).text).toContain('is on')
  expect(await ui.find({ key: 'reveal' })).toBeDefined()
  await ui.unmount()
})
