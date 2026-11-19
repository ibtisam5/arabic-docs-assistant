# مساعد المستندات · Arabic Docs Assistant

Ask questions about your PDF files in Arabic (Gulf dialect, Modern Standard Arabic, or English) and get answers grounded in the documents, with **a citation for every claim**: the quoted passage, the file, and the page number.

> ارفع ملفات PDF (لوائح، أدلة، عقود، مناهج) واسأل عنها بالعربي. المساعد يجاوب من الملفات فقط ويذكر المصدر ورقم الصفحة.

**🔗 Live demo: [arabic-docs-assistant.vercel.app](https://arabic-docs-assistant.vercel.app)**. Try it with the sample PDF in [`samples/`](samples/training-rules-sample.pdf).

<!-- TODO: add a screenshot or GIF here -->

## Features

- **Answers grounded in your documents.** The assistant answers only from the uploaded PDFs and says so when the answer isn't there.
- **Page-level citations.** Every cited sentence links to the exact quoted passage and page.
- **Dialect-aware.** It replies in the language and dialect of the question.
- **Streaming responses.** Answers appear as they're generated.
- **Multi-document.** Ask across up to 5 PDFs at once (4 MB each).
- **Cost-aware.** Files are uploaded once (Files API) and reused by ID, and the documents are prompt-cached, so follow-up questions cost much less.
- **RTL-first UI** with dark mode and a mobile layout.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| AI | Claude API (`@anthropic-ai/sdk`): Files API, Citations, streaming, prompt caching |
| Deploy | Vercel |

## How it works

```
Browser ──PDF──▶ /api/upload ──▶ Claude Files API ──▶ file_id
Browser ──question + file_ids──▶ /api/chat ──▶ Claude Messages API (stream, citations on)
                                     │
                       NDJSON stream ◀┘  {text} {citation} {error} {done}
```

1. **Upload:** `/api/upload` checks the PDF, uploads it with the Files API (it expires after 24 hours), and returns a `file_id`.
2. **Ask:** `/api/chat` puts the documents in the first user turn with `citations: { enabled: true }` and a `cache_control` breakpoint, then streams Claude's answer.
3. **Cite:** The route turns `citations_delta` events into page citations and sends them after the text they support. The UI renders them as `[1]` markers with a "Sources" list.

The API key stays on the server. The browser only ever talks to the Next.js routes.

## Run locally

Requirements: Node.js 20+ and a Claude API key from [platform.claude.com](https://platform.claude.com).

```bash
npm install
cp .env.example .env.local   # then put your key in ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it on [vercel.com/new](https://vercel.com/new).
3. Add the `ANTHROPIC_API_KEY` environment variable and deploy.

## Roadmap

- [ ] Persist conversations and documents (Supabase / Postgres)
- [ ] User accounts
- [ ] RAG with embeddings + pgvector for large document libraries
- [ ] Evals: a test set of Arabic questions to measure answer accuracy
- [ ] Clickable citations that open the PDF at the cited page
