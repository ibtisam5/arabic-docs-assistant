"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatTurn, Citation, StreamEvent, UploadedDoc } from "@/lib/types";

const MAX_DOCUMENTS = 5;

type Part = { kind: "text"; text: string } | { kind: "cite"; n: number };

type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; parts: Part[]; citations: Citation[]; error?: string };

const SUGGESTIONS = [
  "لخّص لي أهم النقاط في الملف",
  "وش الشروط المطلوبة؟",
  "هل فيه مواعيد أو تواريخ مهمة؟",
];

function assistantText(m: Extract<Message, { role: "assistant" }>) {
  return m.parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
}

export default function Home() {
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    const room = MAX_DOCUMENTS - docs.length;
    if (files.length > room) {
      setUploadError(`تقدر ترفع ${MAX_DOCUMENTS} ملفات كحد أقصى.`);
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "تعذّر رفع الملف.");
        setDocs((d) => [...d, data as UploadedDoc]);
      }
      // A new document set starts a new conversation.
      setMessages([]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "تعذّر رفع الملف.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function removeDoc(fileId: string) {
    setDocs((d) => d.filter((x) => x.fileId !== fileId));
    setMessages([]);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy || docs.length === 0) return;

    const history: ChatTurn[] = [
      ...messages.flatMap((m): ChatTurn[] =>
        m.role === "user"
          ? [{ role: "user", content: m.text }]
          : assistantText(m)
            ? [{ role: "assistant", content: assistantText(m) }]
            : [],
      ),
      { role: "user", content: q },
    ];

    setInput("");
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q },
      { role: "assistant", parts: [], citations: [] },
    ]);

    const update = (fn: (m: Extract<Message, { role: "assistant" }>) => void) =>
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role !== "assistant") return prev;
        const copy = { ...last, parts: [...last.parts], citations: [...last.citations] };
        fn(copy);
        next[next.length - 1] = copy;
        return next;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: docs, messages: history }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "صار خطأ، حاول مرة ثانية.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "text") {
            update((m) => {
              const lastPart = m.parts[m.parts.length - 1];
              if (lastPart?.kind === "text") {
                m.parts[m.parts.length - 1] = { kind: "text", text: lastPart.text + event.text };
              } else {
                m.parts.push({ kind: "text", text: event.text });
              }
            });
          } else if (event.type === "citation") {
            update((m) => {
              m.citations.push(event.citation);
              m.parts.push({ kind: "cite", n: m.citations.length });
            });
          } else if (event.type === "error") {
            update((m) => {
              m.error = event.message;
            });
          }
        }
      }
    } catch (e) {
      update((m) => {
        m.error = e instanceof Error ? e.message : "صار خطأ، حاول مرة ثانية.";
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Documents panel */}
      <aside className="flex shrink-0 flex-col gap-3 border-b md:gap-4 border-border bg-surface p-4 md:w-80 md:border-b-0 md:border-l md:p-5">
        <div>
          <h1 className="text-lg font-bold">مساعد المستندات</h1>
          <p className="mt-1 hidden text-sm text-muted md:block">
            ارفع ملفات PDF واسأل عنها بالعربي. كل إجابة تجيك مع المصدر ورقم الصفحة.
          </p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading || docs.length >= MAX_DOCUMENTS}
          className="rounded-xl border-2 border-dashed border-border px-4 py-3 text-sm md:py-5 font-medium text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? "جاري الرفع..." : "+ ارفع ملف PDF"}
        </button>
        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}

        <ul className="flex flex-col gap-2">
          {docs.map((d) => (
            <li
              key={d.fileId}
              className="flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm"
            >
              <span className="truncate" dir="auto" title={d.title}>
                📄 {d.title}
              </span>
              <button
                onClick={() => removeDoc(d.fileId)}
                aria-label={`حذف ${d.title}`}
                className="shrink-0 text-muted hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Chat */}
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-10">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.length === 0 && (
              <div className="mt-10 text-center text-muted">
                {docs.length === 0 ? (
                  <p>ابدأ برفع ملف PDF من القائمة.</p>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <p>جاهز! اسأل أي سؤال عن ملفاتك، أو جرّب:</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => ask(s)}
                          className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground hover:border-accent"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="self-start max-w-[85%] rounded-2xl bg-accent px-4 py-3 text-white dark:text-black" dir="auto">
                  {m.text}
                </div>
              ) : (
                <div key={i} className="self-end w-full max-w-[95%] rounded-2xl border border-border bg-surface px-4 py-3">
                  <div className="whitespace-pre-wrap leading-8" dir="auto">
                    {m.parts.length === 0 && !m.error && (
                      <span className="animate-pulse text-muted">يقرأ الملفات...</span>
                    )}
                    {m.parts.map((p, j) =>
                      p.kind === "text" ? (
                        <span key={j}>{p.text}</span>
                      ) : (
                        <sup key={j} className="mx-0.5 font-semibold text-accent">
                          [{p.n}]
                        </sup>
                      ),
                    )}
                  </div>
                  {m.error && <p className="mt-2 text-sm text-red-600">{m.error}</p>}
                  {m.citations.length > 0 && (
                    <details className="mt-3 border-t border-border pt-2 text-sm">
                      <summary className="cursor-pointer text-muted">
                        المصادر ({m.citations.length})
                      </summary>
                      <ol className="mt-2 flex flex-col gap-2">
                        {m.citations.map((c, k) => (
                          <li key={k} className="rounded-lg bg-background p-2">
                            <div className="font-medium text-accent">
                              [{k + 1}] {c.documentTitle} · صفحة {c.startPage}
                              {c.endPage - 1 > c.startPage ? `–${c.endPage - 1}` : ""}
                            </div>
                            <blockquote className="mt-1 text-muted" dir="auto">
                              «{c.quote.trim()}»
                            </blockquote>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              ),
            )}
            <div ref={bottom} />
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="border-t border-border bg-surface p-3 md:p-4"
        >
          <div className="mx-auto flex max-w-3xl gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={docs.length ? "اكتب سؤالك هنا..." : "ارفع ملف أول"}
              disabled={docs.length === 0}
              maxLength={2000}
              dir="auto"
              className="min-w-0 flex-1 rounded-xl border border-border bg-background px-4 py-3 outline-none focus:border-accent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || docs.length === 0}
              className="rounded-xl bg-accent px-5 py-3 font-medium text-white disabled:opacity-40 dark:text-black"
            >
              {busy ? "..." : "اسأل"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
