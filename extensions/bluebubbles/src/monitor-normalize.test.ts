import { describe, expect, it } from "vitest";
import {
  buildMessagePlaceholder,
  formatGroupMembers,
  formatReplyTag,
  normalizeWebhookMessage,
  normalizeWebhookReaction,
  parseTapbackText,
  resolveGroupFlagFromChatGuid,
  resolveTapbackContext,
} from "./monitor-normalize.js";

describe("monitor-normalize", () => {
  describe("normalizeWebhookMessage", () => {
    it("should normalize a simple direct message", () => {
      const payload = {
        type: "new-message",
        data: {
          guid: "msg-123",
          text: "Hello world",
          handle: { address: "+15551234567" },
          isFromMe: false,
          isGroup: false,
          date: 1672531200000,
        },
      };

      const result = normalizeWebhookMessage(payload);

      expect(result).not.toBeNull();
      expect(result).toEqual(
        expect.objectContaining({
          text: "Hello world",
          senderId: "+15551234567",
          messageId: "msg-123",
          fromMe: false,
          isGroup: false,
          isTapback: undefined,
        })
      );
    });

    it("should normalize a group message with participants", () => {
      const payload = {
        type: "new-message",
        data: {
          guid: "msg-456",
          text: "Group chat message",
          handle: { address: "+15551234567" },
          isFromMe: false,
          isGroup: true,
          chatGuid: "iMessage;+;chat-guid-1",
          chatName: "Family Group",
          participants: [
            { address: "+15551234567", displayName: "Alice" },
            { address: "+15559876543", displayName: "Bob" },
          ],
        },
      };

      const result = normalizeWebhookMessage(payload);

      expect(result).not.toBeNull();
      expect(result).toEqual(
        expect.objectContaining({
          text: "Group chat message",
          senderId: "+15551234567",
          isGroup: true,
          chatGuid: "iMessage;+;chat-guid-1",
          chatName: "Family Group",
          participants: expect.arrayContaining([
            { id: "+15551234567", name: "Alice" },
            { id: "+15559876543", name: "Bob" },
          ]),
        })
      );
    });

    it("should handle nested message structure (BlueBubbles server v1+)", () => {
      const payload = {
        type: "new-message",
        data: {
          message: {
            guid: "msg-nested",
            text: "Nested message",
            handle: { address: "+15551234567" },
          },
        },
      };

      const result = normalizeWebhookMessage(payload);

      expect(result).toEqual(
        expect.objectContaining({
          text: "Nested message",
          messageId: "msg-nested",
          senderId: "+15551234567",
        })
      );
    });

    it("should extract attachments", () => {
      const payload = {
        type: "new-message",
        data: {
          guid: "msg-att",
          text: "",
          handle: { address: "+15551234567" },
          attachments: [
            {
              guid: "att-1",
              mimeType: "image/jpeg",
              totalBytes: 1024,
              transferName: "photo.jpg",
            },
          ],
        },
      };

      const result = normalizeWebhookMessage(payload);

      expect(result?.attachments).toHaveLength(1);
      expect(result?.attachments?.[0]).toEqual(
        expect.objectContaining({
          guid: "att-1",
          mimeType: "image/jpeg",
          totalBytes: 1024,
          transferName: "photo.jpg",
        })
      );
    });

    it("should normalize reply metadata", () => {
      const payload = {
        type: "new-message",
        data: {
          guid: "msg-reply",
          text: "This is a reply",
          handle: { address: "+15551234567" },
          replyTo: {
            guid: "msg-original",
            text: "Original message",
            handle: { address: "+15559876543" },
          },
        },
      };

      const result = normalizeWebhookMessage(payload);

      expect(result).toEqual(
        expect.objectContaining({
          replyToId: "msg-original",
          replyToBody: "Original message",
          replyToSender: "+15559876543",
        })
      );
    });

    it("should handle tapback/reaction fields in message payload", () => {
      const payload = {
        type: "new-message",
        data: {
          guid: "msg-tapback",
          handle: { address: "+15551234567" },
          associatedMessageGuid: "msg-original",
          associatedMessageType: 2001, // Thumbs up
          isTapback: true,
        },
      };

      const result = normalizeWebhookMessage(payload);

      expect(result).toEqual(
        expect.objectContaining({
          isTapback: true,
          associatedMessageGuid: "msg-original",
          associatedMessageType: 2001,
        })
      );
    });

    it("should return null if message payload is missing", () => {
      expect(normalizeWebhookMessage({})).toBeNull();
    });

    it("should throw if data field contains invalid JSON string", () => {
      expect(() => normalizeWebhookMessage({ data: "invalid-json" })).toThrow();
    });

    it("should normalize sender handle", () => {
      const payload = {
        data: {
          text: "test",
          handle: { address: "user@example.com " }, // Extra space
        },
      };
      const result = normalizeWebhookMessage(payload);
      expect(result?.senderId).toBe("user@example.com");
    });
  });

  describe("normalizeWebhookReaction", () => {
    it("should normalize an added reaction", () => {
      const payload = {
        type: "message-reaction",
        data: {
          associatedMessageGuid: "msg-original",
          associatedMessageType: 2000, // Heart added
          handle: { address: "+15551234567" },
          isFromMe: false,
          date: 1672531200000,
        },
      };

      const result = normalizeWebhookReaction(payload);

      expect(result).toEqual(
        expect.objectContaining({
          action: "added",
          emoji: "❤️",
          senderId: "+15551234567",
          messageId: "msg-original",
        })
      );
    });

    it("should normalize a removed reaction", () => {
      const payload = {
        type: "message-reaction",
        data: {
          associatedMessageGuid: "msg-original",
          associatedMessageType: 3000, // Heart removed
          handle: { address: "+15551234567" },
          isFromMe: false,
        },
      };

      const result = normalizeWebhookReaction(payload);

      expect(result).toEqual(
        expect.objectContaining({
          action: "removed",
          emoji: "❤️",
          senderId: "+15551234567",
          messageId: "msg-original",
        })
      );
    });

    it("should fallback to resolving type if mapping not found", () => {
      // Assuming 2099 is unknown but follows added pattern (2xxx)
      const payload = {
        type: "message-reaction",
        data: {
          associatedMessageGuid: "msg-original",
          associatedMessageType: 2099,
          handle: { address: "+15551234567" },
        },
      };

      const result = normalizeWebhookReaction(payload);

      expect(result).toEqual(
        expect.objectContaining({
          action: "added",
          emoji: "reaction:2099",
          messageId: "msg-original",
        })
      );
    });

    it("should use explicit emoji if provided (e.g. from newer server versions)", () => {
      const payload = {
        type: "message-reaction",
        data: {
          associatedMessageGuid: "msg-original",
          associatedMessageType: 2000,
          associatedMessageEmoji: "💜", // Custom/Explicit emoji
          handle: { address: "+15551234567" },
        },
      };

      const result = normalizeWebhookReaction(payload);

      expect(result).toEqual(
        expect.objectContaining({
          emoji: "💜",
        })
      );
    });

    it("should return null if required fields are missing", () => {
      expect(
        normalizeWebhookReaction({
          data: {
            handle: { address: "+15551234567" },
            // missing associatedMessageGuid and Type
          },
        })
      ).toBeNull();
    });
  });

  describe("parseTapbackText", () => {
    it('should parse "Loved..." pattern', () => {
      const result = parseTapbackText({ text: 'Loved "Hello"' });
      expect(result).toEqual({
        emoji: "❤️",
        action: "added",
        quotedText: "Hello",
      });
    });

    it('should parse "Liked..." pattern', () => {
      const result = parseTapbackText({ text: 'Liked "Nice"' });
      expect(result).toEqual({
        emoji: "👍",
        action: "added",
        quotedText: "Nice",
      });
    });

    it('should parse "Disliked..." pattern', () => {
      const result = parseTapbackText({ text: 'Disliked "Bad"' });
      expect(result).toEqual({
        emoji: "👎",
        action: "added",
        quotedText: "Bad",
      });
    });

    it('should parse "Laughed at..." pattern', () => {
      const result = parseTapbackText({ text: 'Laughed at "Funny"' });
      expect(result).toEqual({
        emoji: "😂",
        action: "added",
        quotedText: "Funny",
      });
    });

    it('should parse "Emphasized..." pattern', () => {
      const result = parseTapbackText({ text: 'Emphasized "Important"' });
      expect(result).toEqual({
        emoji: "‼️",
        action: "added",
        quotedText: "Important",
      });
    });

    it('should parse "Questioned..." pattern', () => {
      const result = parseTapbackText({ text: 'Questioned "Really?"' });
      expect(result).toEqual({
        emoji: "❓",
        action: "added",
        quotedText: "Really?",
      });
    });

    it("should parse removal patterns", () => {
      const result = parseTapbackText({ text: 'Removed a heart from "Hello"' });
      expect(result).toEqual({
        emoji: "❤️",
        action: "removed",
        quotedText: "Hello",
      });
    });

    it("should handle mixed case", () => {
      const result = parseTapbackText({ text: 'LOVED "Hello"' });
      expect(result).toEqual({
        emoji: "❤️",
        action: "added",
        quotedText: "Hello",
      });
    });

    it("should handle fancy quotes", () => {
      const result = parseTapbackText({ text: 'Loved “Hello”' });
      expect(result).toEqual({
        emoji: "❤️",
        action: "added",
        quotedText: "Hello",
      });
    });

    it('should parse "Reacted [emoji] to..." pattern', () => {
      const result = parseTapbackText({ text: 'Reacted 🚀 to "Launch"' });
      expect(result).toEqual({
        emoji: "🚀",
        action: "added",
        quotedText: "Launch",
      });
    });

    it('should parse "Removed [emoji] from..." pattern', () => {
      const result = parseTapbackText({ text: 'Removed 🚀 from "Launch"' });
      expect(result).toEqual({
        emoji: "🚀",
        action: "removed",
        quotedText: "Launch",
      });
    });

    it("should return null for non-tapback text", () => {
      expect(parseTapbackText({ text: "Just a normal message" })).toBeNull();
    });

    it("should return null if quoted text is required but missing", () => {
      expect(
        parseTapbackText({ text: "Loved something", requireQuoted: true })
      ).toBeNull();
    });

    it("should use hints if emoji is not in text", () => {
      const result = parseTapbackText({
        text: 'Reacted to "message"',
        emojiHint: "🔥",
      });
      expect(result).toEqual({
        emoji: "🔥",
        action: "added",
        quotedText: "message",
      });
    });
  });

  describe("resolveTapbackContext", () => {
    it("should resolve context from message fields", () => {
      const message = {
        associatedMessageType: 2000, // Heart
        associatedMessageGuid: "msg-original",
      } as any;

      const result = resolveTapbackContext(message);
      expect(result).toEqual({
        emojiHint: "❤️",
        actionHint: "added",
        replyToId: "msg-original",
      });
    });

    it("should return null if no tapback context found", () => {
      const message = {
        text: "normal message",
      } as any;
      expect(resolveTapbackContext(message)).toBeNull();
    });

    it("should resolve context from explicit emoji", () => {
      const message = {
        isTapback: true,
        associatedMessageEmoji: "🔥",
        replyToId: "msg-original",
      } as any;

      const result = resolveTapbackContext(message);
      expect(result).toEqual({
        emojiHint: "🔥",
        actionHint: undefined,
        replyToId: "msg-original",
      });
    });
  });

  describe("Formatting Helpers", () => {
    describe("buildMessagePlaceholder", () => {
      it("should return empty string for empty message", () => {
        expect(buildMessagePlaceholder({} as any)).toBe("");
      });

      it("should return placeholder for image attachments", () => {
        const message = {
          attachments: [{ mimeType: "image/jpeg" }, { mimeType: "image/png" }],
        } as any;
        expect(buildMessagePlaceholder(message)).toBe("<media:image> (2 images)");
      });

      it("should return placeholder for video attachments", () => {
        const message = {
          attachments: [{ mimeType: "video/mp4" }],
        } as any;
        expect(buildMessagePlaceholder(message)).toBe("<media:video> (1 video)");
      });

      it("should return sticker placeholder for balloon messages", () => {
        const message = {
          balloonBundleId: "com.apple.messages.sticker",
        } as any;
        expect(buildMessagePlaceholder(message)).toBe("<media:sticker>");
      });
    });

    describe("formatReplyTag", () => {
      it("should return reply tag", () => {
        expect(formatReplyTag({ replyToId: "msg-123" })).toBe(
          "[[reply_to:msg-123]]"
        );
      });

      it("should return null if no reply id", () => {
        expect(formatReplyTag({})).toBeNull();
      });
    });

    describe("formatGroupMembers", () => {
      it("should format list of participants", () => {
        const participants = [
          { id: "+15551234567", name: "Alice" },
          { id: "+15559876543" }, // No name
        ];
        expect(formatGroupMembers({ participants })).toBe(
          "Alice (+15551234567), +15559876543"
        );
      });

      it("should deduplicate participants by ID", () => {
        const participants = [
          { id: "+15551234567", name: "Alice" },
          { id: "+15551234567", name: "Alice Duplicate" },
        ];
        expect(formatGroupMembers({ participants })).toBe("Alice (+15551234567)");
      });

      it("should return undefined for empty list", () => {
        expect(formatGroupMembers({})).toBeUndefined();
      });
    });

    describe("resolveGroupFlagFromChatGuid", () => {
      it("should resolve group flag from chat guid", () => {
        expect(resolveGroupFlagFromChatGuid("iMessage;+;chat1")).toBe(true);
        expect(resolveGroupFlagFromChatGuid("iMessage;-;chat1")).toBe(false);
      });

      it("should fallback to checking content for group/dm markers", () => {
        expect(resolveGroupFlagFromChatGuid("group;+;123")).toBe(true);
        expect(resolveGroupFlagFromChatGuid("dm;-;123")).toBe(false);
        // The implementation checks parts[1] specifically or inclusion of ;+; or ;-;
        expect(resolveGroupFlagFromChatGuid("some;thing;+;else")).toBe(true);
      });

      it("should return undefined if indecisive", () => {
        expect(resolveGroupFlagFromChatGuid("invalid-guid")).toBeUndefined();
      });
    });
  });
});
