import { createStoredPreference } from "./stored-preference";

export const TOOL_ACTIVITY_STORAGE_KEY = "rakazo.showToolActivity";

/** Tool cards show unless turned off, so people can see what their bots did. */
export function normalizeToolActivityEnabled(raw: string | null | undefined): boolean {
  return raw?.trim().toLowerCase() !== "off";
}

export const toolActivityPreference = createStoredPreference({
  key: TOOL_ACTIVITY_STORAGE_KEY,
  parse: normalizeToolActivityEnabled,
  serialize: (enabled) => (enabled ? "on" : "off"),
});
