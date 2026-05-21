import { describe, expect, it } from "vitest";
import { hasControlCommand } from "./command-detection.js";

describe("hasControlCommand", () => {
  it("detects basic commands", () => {
    expect(hasControlCommand("/help")).toBe(true);
    expect(hasControlCommand("/status")).toBe(true);
    expect(hasControlCommand("/model")).toBe(true);
    expect(hasControlCommand("/kill")).toBe(true);
  });

  it("handles case insensitivity", () => {
    expect(hasControlCommand("/Help")).toBe(true);
    expect(hasControlCommand("/STATUS")).toBe(true);
    expect(hasControlCommand("/mOdEl")).toBe(true);
  });

  it("detects commands with arguments", () => {
    expect(hasControlCommand("/model gpt-4")).toBe(true);
    expect(hasControlCommand("/kill all")).toBe(true);
    // /help does not accept args
    expect(hasControlCommand("/help me")).toBe(false);
  });

  it("rejects invalid inputs", () => {
    expect(hasControlCommand(undefined)).toBe(false);
    expect(hasControlCommand("")).toBe(false);
    expect(hasControlCommand("   ")).toBe(false);
    expect(hasControlCommand("/unknown")).toBe(false);
    expect(hasControlCommand("hello /help")).toBe(false);
    expect(hasControlCommand("/")).toBe(false);
  });

  it("handles normalization (colon syntax)", () => {
    expect(hasControlCommand("/model: gpt-4")).toBe(true);
    expect(hasControlCommand("/kill: all")).toBe(true);
    expect(hasControlCommand("/help:")).toBe(true);
  });

  it("handles normalization (bot mentions)", () => {
    const options = { botUsername: "openclaw" };
    expect(hasControlCommand("/help@openclaw", undefined, options)).toBe(true);
    expect(hasControlCommand("/model@openclaw gpt-4", undefined, options)).toBe(true);

    // Different bot username should be ignored/preserved depending on normalization logic
    expect(hasControlCommand("/help@otherbot", undefined, options)).toBe(false);
  });

  it("respects config-dependent commands", () => {
    const enabledConfig = { commands: { config: true, debug: true, bash: true } };
    const disabledConfig = { commands: { config: false, debug: false, bash: false } };

    // Without config, all commands are enabled by default in listChatCommands()
    expect(hasControlCommand("/config")).toBe(true);
    expect(hasControlCommand("/debug")).toBe(true);
    expect(hasControlCommand("/bash")).toBe(true);

    // With disabled config
    expect(hasControlCommand("/config", disabledConfig)).toBe(false);
    expect(hasControlCommand("/debug", disabledConfig)).toBe(false);
    expect(hasControlCommand("/bash", disabledConfig)).toBe(false);

    // With enabled config
    expect(hasControlCommand("/config", enabledConfig)).toBe(true);
    expect(hasControlCommand("/debug", enabledConfig)).toBe(true);
    expect(hasControlCommand("/bash", enabledConfig)).toBe(true);
  });

  it("handles partial matches correctly", () => {
    // Command prefixes shouldn't match if they are part of another word
    expect(hasControlCommand("/helper")).toBe(false);
    expect(hasControlCommand("/statusfoo")).toBe(false);
  });

  it("handles aliases", () => {
    // /id is an alias for /whoami
    expect(hasControlCommand("/id")).toBe(true);
    expect(hasControlCommand("/whoami")).toBe(true);

    // /t is an alias for /think
    expect(hasControlCommand("/t")).toBe(true);
    expect(hasControlCommand("/thinking")).toBe(true);
    expect(hasControlCommand("/think")).toBe(true);
  });
});
