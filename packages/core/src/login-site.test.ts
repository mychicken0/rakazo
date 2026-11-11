import { describe, expect, it } from "vitest";
import { loginSiteVariant, sameLoginSite } from "./login-site.js";

describe("sameLoginSite", () => {
  it("treats a site and its www host as one site", () => {
    expect(sameLoginSite("https://example.test", "https://www.example.test")).toBe(true);
    expect(sameLoginSite("https://www.example.test", "https://example.test")).toBe(true);
    expect(sameLoginSite("https://example.test", "https://example.test")).toBe(true);
  });

  it("keeps other hosts, schemes and ports apart", () => {
    expect(sameLoginSite("https://example.test", "https://app.example.test")).toBe(false);
    expect(sameLoginSite("https://example.test", "https://www.other.test")).toBe(false);
    expect(sameLoginSite("https://example.test", "http://www.example.test")).toBe(false);
    expect(sameLoginSite("https://example.test", "https://www.example.test:8443")).toBe(false);
    expect(sameLoginSite("not a url", "https://example.test")).toBe(false);
  });
});

describe("loginSiteVariant", () => {
  it("adds or removes www on HTTPS origins only", () => {
    expect(loginSiteVariant("https://example.test")).toBe("https://www.example.test");
    expect(loginSiteVariant("https://www.example.test")).toBe("https://example.test");
    expect(loginSiteVariant("http://example.test")).toBeUndefined();
  });
});
