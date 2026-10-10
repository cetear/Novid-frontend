import { describe, it, expect } from 'vitest'
import { readEventStream } from '@/shared/api/sse/readStream'
import { createChatReducer } from '@/features/chat/reducer'
import { ai } from '../fixtures'
import { aiSchema } from '@/shared/api/contracts/backend'
function frame(event: string, data: unknown, id = '1') {
  return 'id: ' + id + '\r\nevent: ' + event + '\r\ndata: ' + JSON.stringify(data) + '\r\n\r\n'
}
function streamed(text: string, fail = false) {
  const bytes = new TextEncoder().encode(text)
  let i = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < bytes.length) controller.enqueue(bytes.slice(i, i++ + 1))
        else if (fail) controller.error(new Error('connection lost'))
        else controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}
async function read(text: string, fail = false) {
  let answer = ''
  const reducer = createChatReducer((text) => {
    answer = text
  })
  await readEventStream(streamed(text, fail), reducer.event)
  return { result: reducer.finish(), answer }
}
const progress = frame('progress', { stage: 'validated' }),
  done = frame('done', ai, '4')
describe('SSE framing and business termination', () => {
  it('delivers tool document citations with no section identifier in JSON and SSE', async () => {
    const citation = { ...ai.citations[0]!, sectionId: null, headingPath: '工具文档原文' }
    const result = { ...ai, citations: [citation] }
    expect(aiSchema.parse(result).citations[0]?.sectionId).toBeNull()
    expect(
      (await read(progress + frame('citation', citation, '3') + frame('done', result, '4'))).result,
    ).toEqual(result)
  })
  it('accepts repeated processing heartbeats before validation without publishing a draft', async () => {
    const stages: string[] = []
    const reducer = createChatReducer((text, citations, stage) => {
      stages.push(stage)
      if (stage === '正在处理') {
        expect(text).toBe('')
        expect(citations).toEqual([])
      }
    })
    await readEventStream(
      streamed(
        frame('progress', { stage: 'processing' }, '10') +
          frame('progress', { stage: 'processing' }, '11') +
          progress +
          done,
      ),
      reducer.event,
    )
    expect(stages.slice(0, 2)).toEqual(['正在处理', '正在处理'])
    expect(reducer.finish()).toEqual(ai)
  })
  it('rejects a processing heartbeat after validation', async () => {
    await expect(
      read(progress + frame('progress', { stage: 'processing' }, '2')),
    ).rejects.toMatchObject({ code: 'SSE_PROTOCOL_ERROR' })
  })
  it('handles UTF-8 bytes, CRLF split boundaries and replaces deltas with final answer', async () => {
    const result = await read(
      ': comment\r\n\r\n' +
        progress +
        frame('delta', { text: '中文😀' }, '2') +
        frame('citation', ai.citations[0], '3') +
        done,
    )
    expect(result.result).toEqual(ai)
    expect(result.answer).toBe(ai.answer)
  })
  it('supports multi-line data', async () => {
    const text = 'id: 2\nevent: delta\ndata: {\ndata: "text": "中文"\ndata: }\n\n'
    expect((await read(progress + text + done)).result.answer).toBe(ai.answer)
  })
  it('does not succeed when connection breaks after done', async () => {
    await expect(read(progress + done, true)).rejects.toThrow('connection lost')
  })
  it('rejects an unfinished event after done', async () => {
    await expect(
      read(progress + done + 'event: delta\ndata: {"text":"half"}'),
    ).rejects.toMatchObject({ code: 'SSE_INCOMPLETE' })
  })
  it('rejects EOF without done', async () => {
    await expect(read(progress + frame('delta', { text: 'partial' }, '2'))).rejects.toMatchObject({
      code: 'SSE_INCOMPLETE',
    })
  })
  it('handles HTTP 200 SSE error without requiring done', async () => {
    await expect(
      read(frame('error', { code: 'MODEL_INVALID_OUTPUT', message: '结果未通过校验' })),
    ).rejects.toMatchObject({ code: 'MODEL_INVALID_OUTPUT', status: 200, retryable: false })
  })
  it('deduplicates an identical ID within this stream only', async () => {
    const delta = frame('delta', { text: 'same' }, '2')
    expect((await read(progress + delta + delta + done)).answer).toBe(ai.answer)
    expect((await read(progress + done)).result).toEqual(ai)
  })
  it.each([
    frame('done', ai, '5'),
    frame('delta', { text: 'late' }, '5'),
    frame('error', { code: 'BAD', message: 'bad' }, '5'),
  ])('rejects a second terminal or late business event', async (extra) => {
    await expect(read(progress + done + extra)).rejects.toMatchObject({
      code: 'SSE_PROTOCOL_ERROR',
    })
  })
  it('rejects delta before validation and conflicting event IDs', async () => {
    await expect(read(frame('delta', { text: 'early' }))).rejects.toMatchObject({
      code: 'SSE_PROTOCOL_ERROR',
    })
    await expect(read(progress + frame('delta', { text: 'reuse' }))).rejects.toMatchObject({
      code: 'SSE_PROTOCOL_ERROR',
    })
  })
  it('ignores unknown event instructions', async () => {
    expect(
      (await read(progress + frame('execute', { command: 'alert(1)' }, '2') + done)).result,
    ).toEqual(ai)
  })
  it('rejects invalid final result IDs', async () => {
    await expect(
      read(
        progress +
          frame(
            'done',
            {
              ...ai,
              citations: [
                { ...ai.citations[0], document: { ...ai.citations[0]!.document, id: 1e20 } },
              ],
            },
            '3',
          ),
      ),
    ).rejects.toMatchObject({ code: 'SSE_PROTOCOL_ERROR' })
  })
  it('waits for normal EOF after done', async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>,
      ended = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          body = c
        },
      }),
    )
    const reducer = createChatReducer(() => {})
    const pending = readEventStream(response, reducer.event).then(() => {
      ended = true
      return reducer.finish()
    })
    body.enqueue(new TextEncoder().encode(progress + done))
    await new Promise((r) => setTimeout(r, 10))
    expect(ended).toBe(false)
    body.close()
    expect(await pending).toEqual(ai)
  })
})
