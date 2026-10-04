import { createParser, type EventSourceMessage } from 'eventsource-parser'
import { ApiError } from '../errors'

// Parsing is transport-only; business termination belongs to the chat reducer.
export async function readEventStream(
  response: Response,
  onEvent: (event: EventSourceMessage) => void,
) {
  if (!response.body) throw new ApiError('流式响应没有正文', 0, 'INVALID_RESPONSE')
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0,
    line = '',
    frameOpen = false,
    pendingCR = false
  const endLine = () => {
    if (line === '') frameOpen = false
    else if (!line.startsWith(':')) frameOpen = true
    line = ''
  }
  const track = (text: string) => {
    for (const char of text) {
      if (pendingCR) {
        endLine()
        pendingCR = false
        if (char === '\n') continue
      }
      if (char === '\r') pendingCR = true
      else if (char === '\n') endLine()
      else line += char
    }
  }
  const parser = createParser({
    onEvent,
    onError: (error) => {
      if (error.type !== 'unknown-field')
        throw new ApiError('流式事件格式异常', 0, 'SSE_PROTOCOL_ERROR')
    },
    maxBufferSize: 16 * 1024 * 1024,
  })
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > 24 * 1024 * 1024)
        throw new ApiError('流式响应超过读取上限', 0, 'RESPONSE_TOO_LARGE')
      const text = decoder.decode(part.value, { stream: true })
      track(text)
      parser.feed(text)
    }
    const last = decoder.decode()
    track(last)
    parser.feed(last)
    if (pendingCR) endLine()
    if (frameOpen || line.trim())
      throw new ApiError('传输未完整结束，结果需核对', 0, 'SSE_INCOMPLETE')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
