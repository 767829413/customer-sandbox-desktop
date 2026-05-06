import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";

import type { Message } from "../lib/storage";
import MessageBubble from "./MessageBubble";

function makeAssistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    role: "assistant",
    content: "ok",
    createdAtMs: Date.now(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("MessageBubble", () => {
  it("renders unknown custom timeline item as fallback row", () => {
    const message = makeAssistantMessage({
      timeline: [
        {
          kind: "custom_event",
          name: "ui:fake_thing",
          preview: "{\"foo\":\"bar\"}",
        },
      ],
    });

    render(() => <MessageBubble threadId="thread_1" message={message} agent="zeptoclaw" />);

    expect(screen.queryByText("Runtime timeline · 1 events")).not.toBeNull();
    expect(screen.queryByText("ui:fake_thing")).not.toBeNull();
    expect(screen.queryByText("{\"foo\":\"bar\"}")).not.toBeNull();
  });
});
