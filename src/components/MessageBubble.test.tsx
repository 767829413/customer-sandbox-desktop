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

  it("strips a2ui markdown payload when structured A2UI messages exist", () => {
    const message = makeAssistantMessage({
      content: "```a2ui\n{\"version\":\"v0.9\",\"createSurface\":{\"surfaceId\":\"main\"}}\n```",
      a2uiMessages: [
        {
          version: "v0.9",
          createSurface: { surfaceId: "main", catalogId: "basic" },
        },
      ],
    });

    render(() => <MessageBubble threadId="thread_1" message={message} agent="zeptoclaw" />);

    expect(screen.queryByText("createSurface")).toBeNull();
    expect(screen.queryByText("(empty)")).toBeNull();
  });
});
