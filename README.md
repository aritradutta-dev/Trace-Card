# TraceCard

TraceCard turns a noisy error log into a focused explanation, a likely cause, the relevant file and line, and a minimal fix. The landing page now follows the supplied [Minimaze reference](https://minimaze-template.framer.website/): a sparse dark gallery, oversized editorial type, and a wall of varied analysis cards. There is no account or login flow; reports are per-browser, as required by the PRD and technical architecture.

## Run locally

Requirements: Node.js 22 or later and npm.

```sh
npm install
cp .env.example .env.local
```

Add your Google AI Studio key to `.env.local`:

```sh
GEMINI_API_KEY=your_key_here
```

Then start the development server:

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without a key, TraceCard still trims and masks text locally and provides a limited local parser. Live Gemini diagnosis, screenshot understanding, and grounded research require the server-side key.

## Deployment

Deploy the project to Vercel using the Next.js preset. Set `GEMINI_API_KEY` as a server environment variable in the deployment settings. Do not add it to a `NEXT_PUBLIC_` variable or commit `.env.local`.

Model IDs are centralized in `.env.example` and can be overridden by deployment variables:

```text
GEMINI_MODEL_QUICK=gemini-3.6-flash
GEMINI_MODEL_DEEP=gemini-3.6-flash
```

Confirm model access, quotas, and feature compatibility in Google AI Studio before a live demo. The default flow makes a separate Google Search research pass for version-sensitive traces and a structured diagnosis pass afterward.

## Product flow

1. Paste a trace, add a `.log`/`.txt` file, attach a supported screenshot, or include source in the optional context field. Source context can be reviewed on its own.
2. The browser trims oversized traces and masks common credentials, JWTs, emails, IPs, and local usernames. The server applies the same masking again before model calls.
3. Review the payload before sending. Screenshots need an extra confirmation because their pixels cannot be redacted locally.
4. The Next.js Route Handler runs bounded, structured passes: local trace triage, Hunter candidate review, Skeptic counter-review, then a Referee verdict. Version-sensitive traces can also request grounded Google Search references.
5. The report includes the verdict, evidence, counter-evidence, severity, manual-review items, diagnosis, and suggested fix. Markdown export and browser-only history are available.

## Audit scope and safety

The [Bug Hunter repository](https://github.com/codexstar69/bug-hunter) is an AI-agent skill, not a hosted backend API. TraceCard adapts its adversarial review roles to the evidence pasted into this app. It does not clone a GitHub repository, inspect a complete working tree, execute submitted code, run tests, edit files, or commit changes. Verification is always reported as `NOT_RUN`; provide relevant source and a reproducible trigger for a defensible code finding. Runs are read-only, and inconclusive findings remain `MANUAL_REVIEW`.

Each live run makes three sequential Gemini calls for Hunter, Skeptic, and Referee, plus an optional documentation search. Quick and Deep modes default to Gemini 3.6 Flash; Deep raises reasoning for the Referee. A configured Deep model that is unavailable automatically falls back to the Quick model. Individual calls have a 45-second timeout, and the complete stream is bounded to 170 seconds with retries disabled. Disconnecting the browser cancels the upstream request instead of leaving analysis work running.

## Gemini feature map

| Capability | Where it appears |
| --- | --- |
| Adversarial review | Separate Hunter, Skeptic, and Referee structured passes |
| Fail-closed verdicts | Unsupported claims remain `MANUAL_REVIEW`; verification is never implied |
| Server-side masking | Repeats the browser redaction pass before model calls |
| Structured JSON output | Report schema and typed report display |
| System instructions | Root-cause focus, uncertainty, and untrusted-log handling |
| Streaming | Stage progress and Referee summary appear during the review |
| Model routing and thinking controls | Quick and Deep mode |
| Google Search grounding | Separate research pass for version-sensitive errors, with sources shown in the report |
| Multimodal input | Optional screenshot attachment |
| Browser persistence | Preferences and up to ten masked reports saved on-device |

## Privacy notes

- Masking is best-effort and runs in both the browser and server. Check the preview before sending.
- TraceCard does not keep requests in server-side report storage. History and preferences use this browser's local storage; browser history expires after 180 days and can be cleared in the History panel.
- When configured, masked text and any confirmed screenshot are sent to Google's Gemini API. Screenshot pixels are not locally redacted.
- Google's data handling depends on the account and service tier. On unpaid Gemini API quota, Google may use submitted prompts and responses to improve products and may have human reviewers process them. Do not submit confidential or personal information to unpaid services. Read the current [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) and [Google Privacy Policy](https://policies.google.com/privacy).
- The local parser is a convenience fallback, not an AI diagnosis. It does not OCR screenshots and avoids a diagnosis when it cannot detect an error signal.

## Stack

Next.js App Router, React, strict TypeScript, Tailwind CSS, Framer Motion, Lucide React, `react-syntax-highlighter`, and the pinned official `@google/genai` SDK. Gemini credentials remain in server environment variables.
