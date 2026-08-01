import { describe, expect, it } from "vitest";
import { commandDefinitions } from "../src/discord/register-commands";

describe("command definitions", () => {
  it("includes required baseline commands", () => {
    const names = commandDefinitions.map((command) => command.name).sort();
    expect(names).toEqual(["ai", "help", "ping", "settings"]);
  });

  it("defines every AI administration subcommand and required option", () => {
    const ai = commandDefinitions.find((command) => command.name === "ai") as
      | {
          options?: Array<{
            name: string;
            required?: boolean;
          options?: Array<{
            name: string;
            required?: boolean;
            max_length?: number;
            type?: number;
            choices?: Array<{ name: string; value: string }>;
            options?: Array<{
              name: string;
              required?: boolean;
              max_length?: number;
              choices?: Array<{ name: string; value: string }>;
            }>;
          }>;
          }>;
        }
      | undefined;
    const subcommands = ai?.options?.map((option) => option.name).sort();
    expect(subcommands).toEqual(["disable", "enable", "memory-clear", "prompt", "retention", "status"]);

    const enable = ai?.options?.find((option) => option.name === "enable");
    expect(enable?.options?.find((option) => option.name === "channel")?.required).toBe(true);

    const prompt = ai?.options?.find((option) => option.name === "prompt");
    expect(prompt?.options?.map((option) => option.name).sort()).toEqual(["reset", "set", "view"]);

    const promptSet = prompt?.options?.find((option) => option.name === "set");
    expect(promptSet?.options?.find((option) => option.name === "text")).toMatchObject({
      required: true,
      max_length: 6_000,
    });
    expect(promptSet?.options?.find((option) => option.name === "type")?.choices?.map((choice) => choice.value))
      .toEqual(["assistant", "gatekeeper"]);
  });

  it("defines owner-managed admin commands without exposing role choices", () => {
    const settings = commandDefinitions.find((command) => command.name === "settings") as any;
    const view = settings?.options?.find((option: any) => option.name === "view");
    const admin = settings?.options?.find((option: any) => option.name === "admin");
    expect(view).toBeDefined();
    expect(admin?.options?.map((option: any) => option.name).sort()).toEqual(["add", "list", "remove"]);

    for (const name of ["add", "remove"]) {
      const subcommand = admin?.options?.find((option: any) => option.name === name);
      expect(subcommand?.options).toEqual([
        expect.objectContaining({
          name: "user",
          required: true,
        }),
      ]);
    }
  });
});
