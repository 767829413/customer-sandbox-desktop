// Generic SSE line-stream parser. The browser EventSource API is
// off-limits because we need to send a `Authorization: Bearer ...`
// header, which EventSource doesn't support. We instead drive a
// `fetch` body's ReadableStream and split it ourselves per
// https://html.spec.whatwg.org/multipage/server-sent-events.html
//
// Yields one event per `data:`-bearing block. We surface the SSE
// `id:` field so callers can implement Last-Event-ID resume.
//
// We keep this intentionally minimal: no `event:` field handling
// (the AG-UI endpoint puts the event type inside the JSON payload),
// no retry hint parsing.

export interface SseFrame {
  id?: string;
  data: string;
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let currentId: string | undefined;
  const dataLines: string[] = [];

  const flush = (): SseFrame | null => {
    if (dataLines.length === 0) {
      // SSE spec: an "event" with no data lines is dropped, but an
      // `id:` field on its own still updates the event-id. We don't
      // emit, so the next yielded frame will carry it (or get
      // overwritten).
      return null;
    }
    const data = dataLines.join("\n");
    const frame: SseFrame = { data };
    if (currentId !== undefined) frame.id = currentId;
    dataLines.length = 0;
    return frame;
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      // Process any final buffered line. Per spec we don't dispatch
      // a partial event at stream end, but we should still flush a
      // complete one if the upstream forgot the final blank line.
      if (buffer.length > 0) {
        // Treat residual buffer as a final field line followed by
        // the implicit blank line.
        const line = buffer;
        buffer = "";
        ingestLine(line, dataLines, (id) => (currentId = id));
        const frame = flush();
        if (frame) yield frame;
      }
      return;
    }
    buffer += decoder.decode(value, { stream: true });

    // SSE separates events by blank line. Split on \n and walk
    // line-by-line; both \n and \r\n are accepted.
    let nlIdx: number;
    while ((nlIdx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nlIdx);
      buffer = buffer.slice(nlIdx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        const frame = flush();
        if (frame) yield frame;
        continue;
      }
      ingestLine(line, dataLines, (id) => (currentId = id));
    }
  }
}

function ingestLine(
  line: string,
  dataLines: string[],
  setId: (v: string) => void,
): void {
  // Lines beginning with ":" are SSE comments (and used as keep-alives
  // by axum's KeepAlive::default()) — discard.
  if (line.startsWith(":")) return;
  const colon = line.indexOf(":");
  let field: string;
  let value: string;
  if (colon === -1) {
    field = line;
    value = "";
  } else {
    field = line.slice(0, colon);
    // Per spec: a single leading space after the colon is stripped.
    value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
  }
  if (field === "data") {
    dataLines.push(value);
  } else if (field === "id") {
    setId(value);
  }
  // event:, retry: ignored on purpose.
}
