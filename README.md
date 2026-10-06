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

Open http://localhost:3000 and sign in with the demo account, or create your own:

| Email | Password |
|---|---|
| `test@test.com` | `test-password` |

The API creates the demo account at startup from `DEMO_USER_EMAIL` and
`DEMO_USER_PASSWORD` in `.env`. These are public credentials for trying the app:
leave both empty wherever other people can reach the API. The Terraform never
sets them.

Upload a document and ask a question about it. A good first one is
[docs/CHALLENGE.md](docs/CHALLENGE.md) (the brief itself): try "Which backend
technologies are allowed?", then something it does not cover, such as "What is
the CEO's name?", to see the `not_found` status. The API listens on
http://localhost:3001/api.

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

## Scope choices

The brief offers three use cases. I chose question answering over documents
because it covers all three parts of the problem statement naturally: submit
content, interact with an assistant, and view structured output.

What I simplified, and why:

- **Each question is independent.** There is no conversation memory. This keeps
  the cost per question bounded and makes every answer reproducible.
- **Text-based PDFs only.** Scanned documents need OCR, which is a different
  problem.
- **Ingestion is synchronous.** The upload request extracts, chunks, embeds and
  stores. It caps document size at what fits in the provider's per-minute quota.

## Cost and rate limits

### What controls cost today

| Control | Where |
|---|---|
| Only the 5 most relevant passages are sent, never the whole document | `RETRIEVAL_TOP_K` |
| Output is capped | `MAX_OUTPUT_TOKENS` |
| Input is capped: question length, document size, upload size | See "Limits" |
| Per-user rate limits: 10 questions and 5 uploads per minute | `@nestjs/throttler` |
| The smallest model that does the job | `gemini-3.1-flash-lite` |
| Token counts are stored with every answer | `questions` table |

### Cost estimate

Prices are the list prices of `gemini-3.1-flash-lite`: 0.25 USD per million
input tokens and 1.50 USD per million output tokens. A request is one question:
one query embedding and one chat call. The query embedding costs less than
0.00001 USD and is left out.

| Scenario | Input tokens | Output tokens | 1k requests | 10k requests | 100k requests |
|---|---|---|---|---|---|
| Measured on 5 questions about a 4 KB document | 1,262 | 58 | 0.40 USD | 4.03 USD | 40.25 USD |
| Upper bound: 5 full passages | 1,450 | 100 | 0.51 USD | 5.13 USD | 51.25 USD |

Ingestion is a one-time cost per document. A document at the 50,000-character
limit is about 15,000 embedding tokens, which is 0.003 USD at 0.20 USD per
million tokens (the embedding price currently listed).

Infrastructure is the larger cost at low volume: the load balancer, the NAT
gateway, two small Fargate tasks and the smallest RDS instance run all month
regardless of traffic.

### What I would add in production

- **A budget per user and a global cap.** Per-user limits are fair but do not
  protect a shared provider quota. The token counts already stored make a daily
  budget a single query.
- **Caching.** Identical questions on the same document can return the stored
  answer. Provider-side context caching helps when the same passages repeat.
- **A queue for ingestion**, paced by the provider's tokens-per-minute limit.
- **Shared rate-limit storage.** The limiter keeps counters in memory, so with
  several API tasks each task counts separately. Redis fixes that.

## Data: what is stored and for how long

| Stored | Why |
|---|---|
| Email and an Argon2id password hash | Authentication |
| Document title, type, size, and the text of its chunks with their embeddings | Retrieval needs the text |
| Each question, its answer, citations, and the audit fields | History and auditability |

| Not stored | Why |
|---|---|
| The original uploaded file | Only the extracted text is needed |
| Passwords and API keys | Hashes only; keys live in the environment or in Secrets Manager |
| Prompts as sent | They can be rebuilt from the prompt version, the question and the retrieved chunk indexes |

**Retention.** Data is kept until the user deletes the document, which removes
its chunks and questions in the same transaction. There is no automatic expiry.
In production I would add a scheduled job that deletes documents older than a
configured number of days; every table already has `created_at`.

**What leaves the system.** Chunk text and questions are sent to the LLM
provider. On Gemini's free tier that content may be used to improve Google's
products, so this setup must not receive sensitive documents. The paid tier does
not use it that way.

## PII, logging and auditability

**PII.** The system does not detect or redact personal data. Documents are stored
as text and sent to the provider as they are. In production I would add a
redaction step at ingestion, before embedding, and encrypt the database at rest
(the Terraform already enables it) and in transit (the API connects to RDS with
TLS).

**Logging.** Logs are JSON, one object per line, and carry metadata only: user
ID, document ID, model, prompt version, token counts, latency and status. The
events are `question_answered`, `question_failed`, `document_ingested` and
`document_ingest_failed`. Document text, questions, answers and keys are never
logged, and tests assert it. Unexpected errors are logged without their message,
because the message of a failed database query contains its parameters.

**Auditability.** Every answer has a row in `questions` with the prompt version,
provider, model, token counts, latency and the chunks that were retrieved with
their distances. That is enough to explain why an answer was given and to
reproduce it.

### Observability

There are three kinds of data and each has one home:

| Data | Local | AWS |
|---|---|---|
| Event logs | Container output (`docker compose logs api`) | CloudWatch Logs, shipped by ECS |
| Audit records | `questions` table | The same table in RDS |
| Metrics | Queries on the audit table | CloudWatch metric filters on the logs |

Grafana is the visualization layer and stores nothing itself. Locally, an
optional profile starts it with a dashboard already loaded:

```bash
docker compose --profile observability up -d
# http://localhost:3002
```

The dashboard reads the audit table (the cost panel counts Gemini questions only): questions per hour, answers by status,
latency p50 and p95, tokens, estimated cost, and a comparison by model and prompt
version. On AWS the same dashboard would run on Amazon Managed Grafana with two
data sources, CloudWatch and PostgreSQL. The Terraform creates the log groups,
three metric filters and a failure alarm; it does not create the Grafana
workspace, which needs an identity provider.

## Evaluation and reliability

This is not built. It is how I would do it.

**Measuring quality.** A golden set per document type: questions with their
expected answer and the passage that supports it, including questions the
document does not answer. Four measures:

| Measure | What it catches |
|---|---|
| Retrieval recall at 5: is the supporting passage among the retrieved ones? | Chunking and embedding problems |
| Citation precision: do the cited passages support the answer? | Answers that cite the wrong source |
| Answer correctness, graded by a stronger model against the expected answer | Wrong or incomplete answers |
| Refusal accuracy on the unanswerable questions | Hallucination when the document is silent |

**Detecting regressions.** A prompt change is a new version file and a model
change is a config change, so both are easy to run against the golden set before
they go live. The run would be a CI job that fails when a measure drops beyond a
threshold. In production, the dashboard's table by model and prompt version shows
the share of `not_found` and `unverified` answers, which moves when quality
moves.

**Handling a wrong answer.** A feedback control on each answer (not built) would
flag it. The audit row then shows the exact prompt version, model and retrieved
passages, which tells whether retrieval or generation failed. The case joins the
golden set, the fix ships as a new prompt version, and rolling back is a config
change.

## Infrastructure

The Terraform in [infra/](infra/) describes the deployment on AWS. It is
validated with `terraform validate` and has never been applied.

```
Internet -> ALB --/api/*--> API tasks (Fargate, private subnets) --> RDS PostgreSQL
                \--else---> Web tasks (Fargate, private subnets)
API tasks --> NAT gateway --> Gemini API
```

**Why ECS on Fargate.** The brief asks to show deployment on ECS, EKS or
serverless and to explain scaling under bursts. Fargate runs the same images as
local Compose, scales horizontally, injects secrets declaratively, and rolls back
a failed deployment. For a real MVP with few users a single EC2 instance running
Docker Compose would be cheaper, and I would start there.

**Secrets.** The API key and the JWT secret live in AWS Secrets Manager. Terraform
creates the secrets without values, which are set by hand, so they never reach the
repository or the Terraform state. The database password is generated and stored
by RDS. ECS injects all three when a task starts, and the task's execution role
can read only those three. Locally the key lives in `.env`, which git ignores.

**Rotation.** Create a new key at the provider, store it as a new secret version,
and force a new deployment. New tasks read the new value while old ones drain, so
there is no downtime, and the old key is revoked afterwards. The database password
can use the rotation RDS provides.

**Config versus code.** Provider, model names, prompt version and limits are
environment variables fed from Terraform variables. The same image runs in every
environment. The one exception is the frontend's API address, which Next.js
inlines at build time: the production image is built with
`NEXT_PUBLIC_API_URL=/api`.

**Scaling under bursty AI usage.**

- The API scales on requests per task, not CPU. A task waiting for the model is
  idle, so CPU does not reflect load.
- The real ceiling is the provider's quota, not our compute. More tasks do not
  help once the quota is reached; the answer there is a queue with backpressure
  and a clear "try again" to the user, which the API already returns as a 429.
- Requests are long. A question took about 10 seconds on average in my
  measurements, and up to about 96 seconds with retries, so the load balancer's
  idle timeout is 120 seconds.
- Cost follows tokens, not requests, so budgets must be counted in tokens.

## Trade-offs and known limitations

The design document lists every decision with the alternative I rejected and what
it costs: see
[section 13](docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md).
The main ones:

| Decision | What it costs |
|---|---|
| RAG with pgvector instead of sending the whole document | Retrieval can miss the relevant passage |
| Own ports and adapters instead of LangChain | I maintain the chunker, retries and adapters |
| Independent questions | No follow-up questions |
| Status derived from citations | A valid citation shows the source was retrieved, not that the answer is faithful to it |
| Token in `localStorage` | A script on the page could read it |
| ECS Fargate | More moving parts and cost than one EC2 instance |

Known limitations:

- **Answer completeness.** An idea split across two chunks can produce an
  incomplete answer with a valid citation. Sending neighbouring chunks is the
  first improvement I would make.
- **Free tier.** About 500 questions per day and one large document per minute.
  Content sent may be used to improve Google's products.
- **Documents.** Text-based PDFs only. Tables and multi-column layouts extract
  poorly. PDF parsing runs on the request thread.
- **Sessions.** No refresh token; the session lasts one hour. A token for a
  deleted user is not rejected until it expires.
- **Rate limits.** Counters are in memory per task. Sign-in and sign-up are
  limited per IP address, so people behind one shared address share a limit.
  Login timing and the sign-up error reveal whether an email is registered.
- **Frontend.** No partial results without streaming. No security headers or
  content security policy. Long unbroken text can overflow an answer card. An
  oversized file is uploaded fully before the server rejects it.
- **Not built.** PII redaction, automatic data expiry, an evaluation suite, HTTPS
  on the load balancer (it needs a domain).
