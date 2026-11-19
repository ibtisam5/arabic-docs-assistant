import Anthropic from "@anthropic-ai/sdk";
import {
  anthropic,
  hasApiKey,
  MAX_DOCUMENTS,
  MISSING_KEY_MESSAGE,
  MODEL,
  SYSTEM_PROMPT,
} from "@/lib/anthropic";
import type { ChatTurn, Citation, StreamEvent, UploadedDoc } from "@/lib/types";

type ChatRequest = { documents: UploadedDoc[]; messages: ChatTurn[] };

function isValid(body: unknown): body is ChatRequest {
  const b = body as ChatRequest;
  return (
    Array.isArray(b?.documents) &&
    b.documents.length > 0 &&
    b.documents.length <= MAX_DOCUMENTS &&
    b.documents.every(
      (d) => typeof d.fileId === "string" && typeof d.title === "string",
    ) &&
    Array.isArray(b.messages) &&
    b.messages.length > 0 &&
    b.messages.length <= 50 &&
    b.messages.every(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length <= 8000,
    ) &&
    b.messages[0].role === "user" &&
    b.messages[b.messages.length - 1].role === "user"
  );
}

// The documents go in the first user turn, ahead of the first question, so the
// prefix (system + documents) stays identical across the conversation and is
// served from the prompt cache on every follow-up question.
function buildMessages({ documents, messages }: ChatRequest) {
  const docBlocks: Anthropic.Beta.BetaRequestDocumentBlock[] = documents.map(
    (doc, i) => ({
      type: "document",
      source: { type: "file", file_id: doc.fileId },
      title: doc.title,
      citations: { enabled: true },
      ...(i === documents.length - 1
        ? { cache_control: { type: "ephemeral" as const } }
        : {}),
    }),
  );

  return messages.map((m, i): Anthropic.Beta.BetaMessageParam =>
    i === 0
      ? { role: "user", content: [...docBlocks, { type: "text", text: m.content }] }
      : { role: m.role, content: m.content },
  );
}

export async function POST(request: Request) {
  if (!hasApiKey()) {
    return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isValid(body)) {
    return Response.json({ error: "طلب غير صالح." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        const claude = anthropic.beta.messages.stream(
          {
            model: MODEL,
            max_tokens: 16000,
            system: SYSTEM_PROMPT,
            messages: buildMessages(body),
            output_config: { effort: "medium" },
            // If a safety classifier declines, the API retries on a fallback
            // model inside the same stream instead of failing the answer.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal: request.signal },
        );

        // Citations arrive at the start of the text block they support, so we
        // hold them until the block ends and send them after its text.
        let pending: Citation[] = [];

        for await (const event of claude) {
          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              send({ type: "text", text: event.delta.text });
            } else if (
              event.delta.type === "citations_delta" &&
              event.delta.citation.type === "page_location"
            ) {
              const c = event.delta.citation;
              pending.push({
                documentTitle:
                  c.document_title ?? body.documents[c.document_index]?.title ?? "",
                startPage: c.start_page_number,
                endPage: c.end_page_number,
                quote: c.cited_text,
              });
            }
          } else if (event.type === "content_block_stop" && pending.length) {
            for (const citation of pending) send({ type: "citation", citation });
            pending = [];
          }
        }

        const final = await claude.finalMessage();
        if (final.stop_reason === "refusal") {
          send({ type: "error", message: "ما قدرت أجاوب على هذا السؤال." });
        } else if (final.stop_reason === "max_tokens") {
          send({ type: "error", message: "الإجابة طويلة وانقطعت، جرّب سؤال أدق." });
        }
        send({ type: "done" });
      } catch (error) {
        if (request.signal.aborted) return;
        console.error("chat failed", error);
        let message = "صار خطأ، حاول مرة ثانية.";
        if (error instanceof Anthropic.AuthenticationError) {
          message = "مفتاح ANTHROPIC_API_KEY غير صحيح أو غير موجود.";
        } else if (error instanceof Anthropic.NotFoundError) {
          message = "أحد الملفات انتهت صلاحيته، ارفعه مرة ثانية.";
        } else if (error instanceof Anthropic.RateLimitError) {
          message = "ضغط على الخدمة، انتظر شوي وحاول مرة ثانية.";
        }
        send({ type: "error", message });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed because the browser disconnected
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
