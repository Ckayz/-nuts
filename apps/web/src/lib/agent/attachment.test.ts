/**
 * C#7. Conversation context vs position attachment.
 */
import { describe, expect, test } from "bun:test";
import { attachmentFor } from "./attachment";

describe("attachmentFor (C#7)", () => {
	test("no post in the conversation: nothing to attach, nothing to explain", () => {
		expect(attachmentFor(null, null)).toEqual({ attach: null, note: null });
	});

	test("a TEXT post is context, not an attachment — the fill is standalone and says so", () => {
		const result = attachmentFor("t1", { id: "t1", underlyingAsset: null });
		expect(result.attach).toBeNull();
		expect(result.note).toContain("does not back the post");
	});

	test("a post that names an instrument is still attached to", () => {
		expect(attachmentFor("t1", { id: "t1", underlyingAsset: "ETH" })).toEqual({ attach: "t1", note: null });
	});

	test("an unreadable post is forwarded so the shared path refuses it by name", () => {
		// PRD 8.4: a substitution dressed up as a courtesy is still a substitution.
		expect(attachmentFor("t1", null)).toEqual({ attach: "t1", note: null });
	});

	test("a post about ANOTHER market is forwarded, never quietly made standalone", () => {
		expect(attachmentFor("t1", { id: "t1", underlyingAsset: "BTC" }).attach).toBe("t1");
	});
});

describe("C#7: the execution tool forwards the ATTACHMENT, not the conversation id", () => {
	test("prepareTradeFor and the client payload both receive attachment.attach", async () => {
		const source = await Bun.file(new URL("./execute.ts", import.meta.url)).text();
		expect(source).toContain("const attachment = await resolveThesisAttachment(thesisId);");
		expect(source.match(/thesisId: attachment\.attach,/g)?.length).toBe(2);
		// The raw conversation id must no longer be handed to either.
		expect(source).not.toContain("\n\t\t\t\tthesisId,\n");
	});
});
