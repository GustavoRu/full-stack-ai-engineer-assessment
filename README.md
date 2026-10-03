# Document Q&A Assistant

Upload a document, ask questions about it, and get answers grounded in that
document with the passages they came from.

This is my submission for the Full Stack AI Engineer assessment. The brief is in
[docs/CHALLENGE.md](docs/CHALLENGE.md) and the full design, with every decision
and its trade-off, is in
[docs/superpowers/specs](docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md).

## Run locally

Requirements: Docker.

```bash
cp .env.example .env
# Set GEMINI_API_KEY in .env (free at https://aistudio.google.com/apikey),
# or set LLM_PROVIDER=mock to run offline with fake answers.
docker compose up --build
```

Open http://localhost:3000, create an account, upload a document and ask a
question about it. The API listens on http://localhost:3001/api.

Interactive API docs (Swagger UI) are at http://localhost:3001/api/docs. Call
`POST /auth/register`, paste the returned `accessToken` into **Authorize**, and
the other routes are ready to try.

### Try it

```bash
API=localhost:3001/api
JSON='Content-Type: application/json'

# Register and keep the token
TOKEN=$(curl -s -X POST $API/auth/register -H "$JSON" \
  -d '{"email":"you@example.com","password":"correct-horse"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')

# Upload a document: a PDF, .txt or .md file, or pasted text
curl -s -X POST $API/documents -H "Authorization: Bearer $TOKEN" -F 'file=@./my-document.pdf'

# Ask a question, using the id returned above
curl -s -X POST $API/documents/<id>/questions -H "Authorization: Bearer $TOKEN" -H "$JSON" \
  -d '{"question":"What does the document say about termination?"}'
```

### Develop without Docker

```bash
docker compose up -d db
cd apps/api
pnpm install
pnpm start:dev   # reads the root .env
pnpm test        # unit tests, no database needed
pnpm test:int    # integration tests against the Compose database

cd ../web
pnpm install
pnpm dev         # http://localhost:3000
pnpm test
```

## What the answer looks like

Every answer is a structured object, not free text:

```json
{
  "status": "answered",
  "answer": "Either party can terminate with 30 days written notice.",
  "citations": [{ "chunkIndex": 4, "content": "The service contract can be terminated..." }],
  "usage": { "inputTokens": 1843, "outputTokens": 61 },
  "model": "gemini-3.1-flash-lite",
  "promptVersion": "qa-v1"
}
```

| Status | Meaning |
|---|---|
| `answered` | The model answered and cited at least one passage that was really sent to it |
| `unverified` | The model answered but cited nothing valid, so the answer cannot be tied to the document |
| `not_found` | The model reports that the document does not cover the question |

The model is not asked how confident it is, because self-reported confidence is
poorly calibrated. Uncertainty is derived from citations, which can be checked.

## Architecture

A Next.js frontend, a modular NestJS monolith, PostgreSQL with pgvector, and
Docker Compose.

| Module | Responsibility |
|---|---|
| `auth` | Register, login, global JWT guard |
| `documents` | Upload and ingestion: extract text, chunk, embed, store |
| `questions` | The AI endpoint: retrieve, build prompt, invoke, post-process, store |
| `llm` | Ports for the chat and embedding models, with Gemini and mock adapters |
| `prompts` | Versioned prompt templates |
| `database` | Drizzle schema and migrations |

## AI design

### Three separate steps

The brief asks for a clear separation between prompt construction, model
invocation and response post-processing. Each one is its own unit:

| Step | Where | Notes |
|---|---|---|
| Prompt construction | `src/prompts/qa-v1.ts` | A pure function of the question and the retrieved passages |
| Model invocation | `src/llm/` | A `ChatModel` port; the service never imports a vendor SDK |
| Post-processing | `src/questions/answer-parser.ts` | A pure function: validates the JSON, checks citations, derives the status |

`QuestionsService.ask` runs them in order and stores an audit record with the
prompt version, provider, model, token counts, latency and the passages that
were retrieved.

### Switching providers

`LLM_PROVIDER` selects the adapter: `gemini` or `mock`. Adding a provider is one
adapter file and one case in `src/llm/llm.module.ts`.

Chat and embeddings are two ports because the swaps are not equivalent. Changing
the chat model is free. Changing the embedding model means re-embedding every
document, since vectors from different models are not comparable. Each document
records the embedding model it was indexed with, and a question against a
document indexed with a different model is refused with a clear error.

### Prompt versioning

Each prompt version is a file. `PROMPT_VERSION` selects the active one and every
stored answer records the version that produced it. A published version is never
edited: a change is a new file, and a rollback is a config change.

### Prompt injection

No single defense is complete, so there are four layers:

1. **Role separation.** Instructions live in the system instruction. The document
   passages and the question are delimited data, with an explicit rule not to
   follow instructions found there. Delimiters inside the data are escaped.
2. **Least privilege.** The model has no tools and no data access. Filtering by
   user and document happens in SQL. The worst outcome of a successful injection
   is a bad answer about the user's own document.
3. **Constrained output.** The response must match a JSON schema and is validated
   again by the API.
4. **Input limits.** Question length, document size and per-user rate limits.

### Retrieval

Documents are split recursively at paragraph, line and sentence boundaries into
chunks of about 1,000 characters with 150 characters of overlap. Pieces are at
most 300 characters, so chunks fill up and the chunk count is predictable. Each question
retrieves the 5 nearest chunks of that document by cosine distance. The search is
exact: it only scans one document's chunks, so it needs no vector index.

## Limits

| Limit | Default | Variable |
|---|---|---|
| Upload size | 5 MB | `MAX_UPLOAD_BYTES` |
| Extracted text | 50,000 characters | `MAX_DOCUMENT_CHARS` |
| Question length | 1,000 characters | `MAX_QUESTION_CHARS` |
| Retrieved chunks | 5 | `RETRIEVAL_TOP_K` |
| Output tokens | 800 | `MAX_OUTPUT_TOKENS` |

Requests are limited per user: 10 questions and 5 uploads per minute. The
defaults are sized for the Gemini free tier: embedding quota is counted per text,
so a 50,000-character document (about 60 chunks, never more than 92) uses most
of the 100 embedding requests allowed per minute.

## Frontend

A client-rendered Next.js app with four screens: sign in, sign up, the document
list with upload, and the question page of one document.

| Concern | How it is handled |
|---|---|
| Model status | A pending card shows the question and "Thinking" until the answer arrives |
| Uncertainty | Each answer carries a status badge; `unverified` adds a warning and `not_found` suggests rephrasing |
| Sources | Each answer can expand the passages it cited |
| Refine or re-ask | "Edit and ask again" copies a past question into the form |
| Errors | Every request has an error state with a retry; a rate limit has its own message and keeps the question |
| Empty states | "Upload your first document" and "Ask your first question" |
| Unsafe output | Model output is rendered as plain text, never as HTML or Markdown |

There are no partial results: without streaming the answer arrives whole, so the
UI shows "Thinking" until then.

The token is kept in `localStorage`, which is simple but readable by any script
on the page. The production alternative is an `httpOnly` cookie.
