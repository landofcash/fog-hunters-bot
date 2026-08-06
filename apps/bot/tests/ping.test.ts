import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePingCommand } from "../src/commands/public/ping";
import { APP_VERSION } from "../src/lib/app-version";
import { createInteractionMock } from "./helpers/fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ping command", () => {
  it("reports latency and the running bot version", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_012);
    const interaction = createInteractionMock({ createdTimestamp: 1_000 });

    await handlePingCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: `Pong! 12ms · v${APP_VERSION}`,
    });
  });
});
