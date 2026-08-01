import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges Tailwind classes with later values taking precedence", () => {
    expect(cn("px-2 text-slate-500", "px-4", false && "hidden")).toContain("px-4");
    expect(cn("px-2", "px-4")).not.toContain("px-2");
  });
});
