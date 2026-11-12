type PayloadHook = (payload: unknown, model: never) => unknown;

const LONE_SURROGATE_SOURCE =
  "[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]";
const LONE_SURROGATE = new RegExp(LONE_SURROGATE_SOURCE);
const LONE_SURROGATE_ALL = new RegExp(LONE_SURROGATE_SOURCE, "g");

/**
 * The value with every string made well-formed UTF-16, or the same value when nothing changed.
 * Text cut at a character limit can split an emoji's surrogate pair; providers that parse JSON
 * strictly reject the whole request ("Bad Request") over the half character left behind.
 */
export function wellFormedValue<T>(value: T): T {
  if (typeof value === "string") {
    return (LONE_SURROGATE.test(value) ? value.replace(LONE_SURROGATE_ALL, "\uFFFD") : value) as T;
  }
  if (Array.isArray(value)) {
    let changed: unknown[] | undefined;
    value.forEach((item, index) => {
      const next = wellFormedValue(item);
      if (next !== item) {
        changed ??= [...value];
        changed[index] = next;
      }
    });
    return (changed ?? value) as T;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    let changed: Record<string, unknown> | undefined;
    for (const [key, item] of Object.entries(value)) {
      const next = wellFormedValue(item);
      if (next !== item) {
        changed ??= { ...(value as Record<string, unknown>) };
        changed[key] = next;
      }
    }
    return (changed ?? value) as T;
  }
  return value;
}

/** Stream options whose request body is made well-formed after any onPayload hook already there. */
export function withWellFormedPayload<O extends object>(options: O | undefined): O {
  const previous = (options as { onPayload?: PayloadHook } | undefined)?.onPayload;
  return {
    ...(options ?? {}),
    onPayload: async (payload: unknown, model: never) => {
      const replaced = previous ? await previous(payload, model) : undefined;
      const body = replaced ?? payload;
      const clean = wellFormedValue(body);
      return clean === body ? replaced : clean;
    },
  } as O;
}
