import { describe, expect, it } from "vitest";
import { attachmentPickerAccept } from "./attachment-picker-accept.js";

describe("attachmentPickerAccept", () => {
  it("offers every file, since any type can be attached", () => {
    expect(attachmentPickerAccept()).toBe("*/*");
  });
});
