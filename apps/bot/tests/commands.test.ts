import { describe, expect, it } from "vitest";
import { commandDefinitions } from "../src/discord/register-commands";

describe("command definitions", () => {
  it("includes required baseline commands", () => {
    const names = commandDefinitions.map((command) => command.name).sort();
    expect(names).toEqual(["ai", "help", "ping", "settings"]);
  });

  it("defines every AI administration subcommand and required option", () => {
    const ai = commandDefinitions.find((command) => command.name === "ai") as
      | { options?: Array<{ name: string; required?: boolean; options?: Array<{ name: string; required?: boolean }> }> }
      | undefined;
    const subcommands = ai?.options?.map((option) => option.name).sort();
    expect(subcommands).toEqual(["disable", "enable", "memory-clear", "retention", "status", "style"]);

    const enable = ai?.options?.find((option) => option.name === "enable");
    expect(enable?.options?.find((option) => option.name === "channel")?.required).toBe(true);
  });
});
