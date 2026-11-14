"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import DotGridBackground from "@/components/DotGridBackground";
import NeuralBrainDecoration from "@/components/NeuralBrainDecoration";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  FileCode2,
  FileImage,
  Gauge,
  History,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Orbit,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ClipboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Confidence = "high" | "medium" | "low";
type Mode = "quick" | "deep";
type Source = { title: string; url: string };
type AuditReview = {
  verdict: "REAL_BUG" | "NOT_A_BUG" | "MANUAL_REVIEW";
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  claim: string;
  runtime_trigger: string;
  evidence: string[];
  skeptic_status: "supports" | "disputes" | "unresolved" | "not_applicable";
  counter_evidence: string[];
  rationale: string;
  manual_review: string[];
  verification_status: "NOT_RUN";
  verification_reason: string;
};
type Report = {
  summary: string;
  root_cause: string;
  where_to_look: { file: string; line: number; detail: string };
  fix: { explanation: string; code_before: string; code_after: string };
  confidence: Confidence;
  alternative_causes: string[];
  needs_more_info: string[];
  is_actually_an_error: boolean;
  sources: Source[];
  audit?: AuditReview;
};
type ImageAttachment = { name: string; mimeType: string; data: string; previewUrl: string };
type ConversationMessage = { role: "user" | "assistant"; text: string };
type AnalyzePayload = {
  trace: string;
  context?: string;
  followUp?: string;
  priorReport?: Report;
  conversation?: ConversationMessage[];
  language: string;
  mode: Mode;
  beginner: boolean;
  versionSensitive: boolean;
  image?: { name: string; mimeType: string; data: string } | null;
};
type SavedReport = { id: string; createdAt: number; report: Report; trace: string; language: string; model: string; mode: Mode };
type AnalyzeResult = { report: Report; model?: string; features?: string[] };
type Modal = "review" | "history" | "privacy" | "saved-report" | null;

const MAX_INPUT = 60_000;
const HISTORY_KEY = "tracecard.history.v1";
const PREF_KEY = "tracecard.preferences.v1";
const MAX_HISTORY_AGE = 180 * 24 * 60 * 60 * 1000;

const SAMPLE = `TypeError: Cannot read properties of undefined (reading 'name')
    at UserCard (src/components/UserCard.jsx:42:18)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom-client.development.js:5528:20)
    at updateFunctionComponent (node_modules/react-dom/cjs/react-dom-client.development.js:8897:16)
    at beginWork (node_modules/react-dom/cjs/react-dom-client.development.js:10522:14)
    at runWithFiberInDEV (node_modules/react-dom/cjs/react-dom-client.development.js:1570:30)

// The API response sometimes has no profile for guest sessions.
const user = { id: "u_72", role: "guest" };
return <h2>{user.profile.name}</h2>;`;

const SECRET_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, label: "PRIVATE_KEY" },
  { regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, label: "JWT" },
  { regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{20,}|sk-(?:ant-api\d{2}-)?[A-Za-z0-9_-]{18,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})\b/g, label: "SECRET" },
  { regex: /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, label: "TOKEN" },
];

function maskSecrets(value: string) {
  let masked = value;
  let count = 0;
  const replace = (regex: RegExp, label: string) => {
    masked = masked.replace(regex, () => { count += 1; return `[MASKED_${label}]`; });
  };
  for (const pattern of SECRET_PATTERNS) replace(pattern.regex, pattern.label);
  masked = masked.replace(/(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s]+:([^@\s]+)@/gi, (full, pass: string) => {
    count += 1;
    return full.replace(`:${pass}@`, ":[MASKED_DB_PASSWORD]@");
  });
  masked = masked.replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|auth[_-]?token)\s*([:=])\s*["']?([^\s,;"'<>]+)/gi, (_match, key: string, separator: string) => {
    count += 1;
    return `${key}${separator}[MASKED_CREDENTIAL]`;
  });
  replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "EMAIL");
  replace(/\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g, "IP");
  masked = masked.replace(/(?:\/Users\/|\/home\/|C:\\Users\\)([^/\\\s]+)/g, (full, user: string) => {
    count += 1;
    return full.replace(user, "[MASKED_USERNAME]");
  });
  replace(/\b(?=[A-Za-z0-9+/=_-]{32,}\b)(?=[A-Za-z0-9+/=_-]*[a-z])(?=[A-Za-z0-9+/=_-]*[A-Z])(?=[A-Za-z0-9+/=_-]*\d)[A-Za-z0-9+/=_-]{32,}\b/g, "HIGH_ENTROPY");
  return { text: masked, count };
}

function trimTrace(value: string) {
  const source = value.trim();
  if (source.length <= MAX_INPUT) return { text: source, trimmed: false, omittedLines: 0 };
  const lines = source.split(/\r?\n/);
  const keep = new Set<number>();
  const addRange = (start: number, end: number) => {
    for (let index = Math.max(0, start); index <= Math.min(lines.length - 1, end); index += 1) keep.add(index);
  };
  addRange(0, 54);
  addRange(lines.length - 55, lines.length - 1);
  lines.forEach((line, index) => {
    if (/error|exception|traceback|caused by|uncaught|failed|fatal/i.test(line)) addRange(index - 5, index + 8);
  });
  const selected = [...keep].sort((a, b) => a - b);
  while (selected.length > 1 && selected.reduce((sum, index) => sum + lines[index].length + 1, 0) > MAX_INPUT - 200) {
    selected.splice(Math.floor(selected.length / 2), 1);
  }
  let output = "";
  let previous = -2;
  for (const index of selected) {
    if (index > previous + 1) output += `\n… ${index - previous - 1} lines omitted …\n`;
    output += `${lines[index]}\n`;
    previous = index;
  }
  return { text: output.slice(0, MAX_INPUT), trimmed: true, omittedLines: Math.max(0, lines.length - selected.length) };
}

function detectLanguage(value: string) {
  if (/Traceback \(most recent call last\)|File ".+", line \d+|ModuleNotFoundError|ImportError|\.py:\d+/i.test(value)) return "Python";
  if (/\b(?:TypeError|ReferenceError|SyntaxError):|node_modules\/|\bat .*\.m?js:\d+/i.test(value)) return "JavaScript / Node";
  if (/\b(?:Exception|Error):.*\n\s+at [\w.$]+\([^)]*\.java:\d+\)|\.java:\d+\)/i.test(value)) return "Java";
  if (/\.tsx?:\d+|\.jsx?:\d+/.test(value)) return "JavaScript / Node";
  return "Unknown / general";
}

function detectFramework(value: string) {
  const entries: [RegExp, string][] = [
    [/next(?:\.js)?/i, "Next.js"], [/react/i, "React"], [/django/i, "Django"], [/flask/i, "Flask"], [/spring/i, "Spring"], [/express/i, "Express"], [/vite/i, "Vite"], [/fastapi/i, "FastAPI"], [/pytest/i, "pytest"], [/webpack/i, "webpack"],
  ];
  return entries.find(([pattern]) => pattern.test(value))?.[1] || "";
}

function detectLocation(value: string) {
  const candidates: { file: string; line: number; lineIndex: number }[] = [];
  const lines = value.split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    let match = line.match(/File "([^\"]+)", line (\d+)/);
    if (!match) match = line.match(/(?:\(|at )((?:[A-Za-z]:)?[^\s()]+\.[cm]?[jt]sx?):(\d+)(?::\d+)?\)?/);
    if (!match) match = line.match(/\(([^()]+\.java):(\d+)\)/);
    if (!match) return;
    const file = match[1];
    if (/node_modules|site-packages|dist-packages|\/react-dom\/|\/internal\//i.test(file)) return;
    candidates.push({ file, line: Number(match[2]), lineIndex });
  });
  return candidates.at(-1) || candidates[0] || null;
}

function findErrorLine(value: string) {
  return value.split(/\r?\n/).find((line) => /(?:TypeError|ReferenceError|SyntaxError|RangeError|Error|Exception|Traceback|ModuleNotFoundError|ImportError|NullPointerException|IndexOutOfBounds|KeyError|ValueError|ConnectionRefused|failed|fatal)/i.test(line))?.trim() || "";
}

function isErrorInput(value: string) {
  return /\b(?:error|exception|traceback|uncaught|failed|fatal|panic|segmentation fault|cannot find module|not found|undefined|nullpointer|caused by)\b/i.test(value);
}

function localReport(trace: string, language: string, imageAttached = false): Report {
  const errorLine = findErrorLine(trace);
  const location = detectLocation(trace);
  const hasError = isErrorInput(trace);
  const normalized = errorLine.toLowerCase();
  let summary = "The local parser found a software error, but it needs Gemini for a reliable root cause.";
  let rootCause = "The trace contains an error signal. Review the highlighted frame and confirm the surrounding inputs and versions.";
  let explanation = "Check the highlighted user-code frame and compare the failing value with the assumptions in that code.";
  let before = "";
  let after = "";
  let confidence: Confidence = "low";
  const alternatives: string[] = ["A missing or unexpected input may have triggered the failure."];

  if (!hasError && imageAttached) {
    return {
      summary: "A screenshot was attached, but the image reader needs Gemini to inspect it.",
      root_cause: "The local fallback can trim and mask text, but it does not run OCR on screenshots. No diagnosis has been invented.",
      where_to_look: { file: "Screenshot", line: 0, detail: "Retry with Gemini or paste the visible error text into the trace box." },
      fix: { explanation: "Paste the error text for a local trace read, or retry after Gemini is configured.", code_before: "", code_after: "" },
      confidence: "low", alternative_causes: [], needs_more_info: ["Can you paste the error text visible in the screenshot?"], is_actually_an_error: false, sources: [],
    };
  }
  if (!hasError) {
    return {
      summary: "This text doesn't clearly look like a software error, so TraceCard won't invent a diagnosis.",
      root_cause: "No clear exception, failure signal, or stack trace was detected in the supplied text.",
      where_to_look: { file: "Not detected", line: 0, detail: "Try pasting the exception message and its surrounding stack frames." },
      fix: { explanation: "Paste the error output or a screenshot of the error to continue.", code_before: "", code_after: "" },
      confidence: "low", alternative_causes: [], needs_more_info: [], is_actually_an_error: false, sources: [],
    };
  }
  if (/cannot read propert|undefined \(reading|undefined is not an object/i.test(normalized)) {
    summary = "A value is missing before `.name` is read; the guest user has no `profile` object.";
    rootCause = "The render path assumes every user has a profile. For this guest session, `user.profile` is undefined, so reading `user.profile.name` throws before React can finish rendering.";
    explanation = "Guard the optional profile before reading its name. Keep a useful guest fallback so the component can render when profile data is absent.";
    before = "return <h2>{user.profile.name}</h2>;";
    after = "return <h2>{user.profile?.name ?? \"Guest\"}</h2>;";
    confidence = "medium";
    alternatives.splice(0, 1, "The profile request may have failed and left the user object partially populated.");
  } else if (/modulenotfounderror|cannot find module|no module named/i.test(normalized)) {
    const match = errorLine.match(/(?:No module named|Cannot find module) ["']?([^"']+)/i);
    summary = `A dependency${match?.[1] ? ` (${match[1]})` : ""} could not be resolved by the current runtime.`;
    rootCause = "The runtime cannot resolve a package referenced by the application. It may be missing from the active environment or installed in a different workspace.";
    explanation = "Install the missing dependency in the environment that runs this app, then restart the process.";
    confidence = "medium";
    alternatives.splice(0, 1, "The package may be installed under a different Python interpreter or Node workspace.");
  } else if (/nullpointerexception/i.test(normalized)) {
    summary = "Java tried to use a reference that is currently null.";
    rootCause = "A required object was null at the failing user-code frame. The local trace cannot identify which upstream assignment or lookup produced it.";
    explanation = "Check the reported line and validate the object before dereferencing it. Confirm the constructor or lookup that should provide the value.";
    confidence = "low";
  } else if (/nameerror/i.test(normalized)) {
    const match = errorLine.match(/name ['\"]?([^'\" ]+)/i);
    summary = `Python cannot find the name${match?.[1] ? ` ${match[1]}` : ""} in the current scope.`;
    rootCause = "The referenced identifier is not defined where this line runs. Check spelling, imports, and the scope in which it is created.";
    explanation = "Define or import the name before use, or correct the reference to the intended variable.";
    confidence = "medium";
  }

  return {
    summary,
    root_cause: rootCause,
    where_to_look: { file: location?.file || "Not detected", line: location?.line || 0, detail: location ? "Local parser selected the deepest visible user-code frame." : "No user-code frame could be isolated locally." },
    fix: { explanation, code_before: before, code_after: after },
    confidence,
    alternative_causes: alternatives,
    needs_more_info: language.includes("Unknown") ? ["Which language and runtime version produced this trace?"] : [],
    is_actually_an_error: true,
    sources: [],
  };
}

function redactTextNodes(text: string) {
  const pieces = text.split(/(\[MASKED_[^\]]+\])/g);
  return pieces.map((piece, index) => piece.startsWith("[MASKED_")
    ? <span className="redaction-pill" key={`${piece}-${index}`}>{piece}</span>
    : <span key={`plain-${index}`}>{piece}</span>);
}

function safeUrl(url: string) {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

function makeMarkdown(report: Report, trace: string) {
  const lines = [
    `# ${report.summary}`, "", `**Confidence:** ${report.confidence.toUpperCase()}`, "",
    "## Root cause", report.root_cause, "",
    "## Where to look", `${report.where_to_look.file}${report.where_to_look.line ? `:${report.where_to_look.line}` : ""} — ${report.where_to_look.detail}`, "",
    "## Fix", report.fix.explanation,
  ];
  if (report.fix.code_before) lines.push("", "### Before", "```", report.fix.code_before, "```");
  if (report.fix.code_after) lines.push("", "### After", "```", report.fix.code_after, "```");
  if (report.alternative_causes.length) lines.push("", "## Alternative causes", ...report.alternative_causes.map((item) => `- ${item}`));
  if (report.audit) {
    lines.push("", "## Adversarial review", `**Verdict:** ${report.audit.verdict}`, `**Severity:** ${report.audit.severity}`, report.audit.rationale, "", "### Hunter evidence", ...(report.audit.evidence.length ? report.audit.evidence.map((item) => `- ${item}`) : ["- No source evidence was confirmed."]), "", "### Skeptic counter-evidence", ...(report.audit.counter_evidence.length ? report.audit.counter_evidence.map((item) => `- ${item}`) : ["- No counter-evidence was recorded."]), "", `**Verification:** ${report.audit.verification_status} — ${report.audit.verification_reason}`);
    if (report.audit.manual_review.length) lines.push("", "### Manual review", ...report.audit.manual_review.map((item) => `- ${item}`));
  }
  if (report.sources.length) lines.push("", "## Sources", ...report.sources.filter((source) => safeUrl(source.url)).map((source) => `- [${source.title}](${source.url})`));
  lines.push("", "## Masked trace", "```text", trace, "```");
  return lines.join("\n");
}

async function readImage(file: File): Promise<ImageAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
  const [, data = ""] = dataUrl.split(",");
  return { name: file.name, mimeType: file.type, data, previewUrl: dataUrl };
}

async function requestAnalysis(payload: AnalyzePayload, callbacks: {
  onProgress: (stage: string) => void;
  onSummary: (summary: string) => void;
}): Promise<AnalyzeResult> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = "Gemini is unavailable right now.";
    try { message = (await response.json() as { error?: string }).error || message; } catch { /* keep fallback message */ }
    throw new Error(message);
  }
  if (!response.body) throw new Error("The analysis stream was empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: AnalyzeResult | null = null;
  let streamError = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const events = pending.split("\n\n");
    pending = events.pop() || "";
    for (const event of events) {
      const eventName = event.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
      const dataLine = event.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const data = JSON.parse(dataLine.slice(5).trim()) as { stage?: string; text?: string; error?: string; report?: Report; model?: string; features?: string[] };
      if (eventName === "progress" && data.stage) callbacks.onProgress(data.stage);
      if (eventName === "summary") callbacks.onSummary(data.text || "");
      if (eventName === "result" && data.report) result = { report: data.report, model: data.model, features: data.features };
      if (eventName === "error") streamError = data.error || "Gemini could not complete the request.";
    }
  }
  if (result) return result;
  throw new Error(streamError || "Gemini ended without a complete report.");
}

function IconMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function TraceGallery() {
  return (
    <div className="trace-gallery" aria-label="TraceCard analysis gallery">
      <motion.article className="gallery-tile gallery-tile-trace" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <div className="gallery-tile-top"><span>01 / THE TRACE</span><b>JS</b></div>
        <div className="gallery-code-lines">
          <div><i>38</i><code>at renderWithHooks(…)</code></div>
          <div><i>39</i><code>at UserCard (…)</code></div>
          <div className="signal-line"><i>42</i><code>user.profile.name</code></div>
          <div><i>43</i><code>at updateComponent(…)</code></div>
          <div><i>44</i><code>at beginWork(…)</code></div>
        </div>
        <div className="gallery-tile-foot"><span>LIBRARY NOISE REMOVED</span><strong>FRAME 42</strong></div>
      </motion.article>
      <motion.article className="gallery-tile gallery-tile-cause" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }}>
        <div className="gallery-tile-top"><span>02 / THE ROOT CAUSE</span><b>FOUND</b></div>
        <div className="cause-content"><span className="cause-orbit">∅</span><p><small>THE VALUE IS MISSING</small><strong><code>profile</code> is undefined.</strong><em>The failing read assumes a profile exists for every user.</em></p></div>
      </motion.article>
      <motion.article className="gallery-tile gallery-tile-fix" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.6 }}>
        <div className="gallery-tile-top"><span>03 / A SMALLER FIX</span><b>PATCH</b></div>
        <div className="mini-diff"><div><i>−</i><code>user.profile.name</code></div><div><i>+</i><code>user.profile?.name</code></div><div><i>+</i><code>?? &quot;Guest&quot;</code></div></div>
        <div className="gallery-tile-foot"><span>BEFORE / AFTER</span><strong>EXPLAINED</strong></div>
      </motion.article>
      <motion.article className="gallery-tile gallery-tile-privacy" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.6 }}>
        <div className="gallery-tile-top"><span>04 / YOUR DATA</span><b>LOCAL</b></div>
        <div className="mask-preview"><span>api_key</span><i>=</i><s>••••••••••</s><b>[MASKED]</b></div>
        <div className="gallery-tile-foot"><span>REVIEW BEFORE SEND</span><strong>PRIVATE FIRST</strong></div>
      </motion.article>
      <motion.article className="gallery-tile gallery-tile-modes" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.6 }}>
        <div className="gallery-tile-top"><span>05 / YOUR PACE</span><b>MODE</b></div>
        <div className="mode-samples"><strong>QUICK <small>fast first read</small></strong><i /><strong>DEEP <small>more reasoning</small></strong></div>
      </motion.article>
    </div>
  );
}

function ReportContent({ report, trace, language, model, mode, features, onCopy, onDownload, onRetry, canRetry, conversation, onFollowUp, followUp, setFollowUp, busy }: {
  report: Report;
  trace: string;
  language: string;
  model: string;
  mode: Mode;
  features: string[];
  onCopy: (text: string, label: string) => void;
  onDownload: () => void;
  onRetry: () => void;
  canRetry: boolean;
  conversation: ConversationMessage[];
  onFollowUp: (event: FormEvent<HTMLFormElement>) => void;
  followUp: string;
  setFollowUp: (value: string) => void;
  busy: boolean;
}) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [copied, setCopied] = useState(false);
  const spotlight = (event: MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
  };
  const languageForCode = language.toLowerCase().includes("python") ? "python" : language.toLowerCase().includes("java") ? "java" : "javascript";
  const codeStyle = { ...oneDark, 'pre[class*="language-"]': { background: "transparent", margin: 0, padding: 0 }, 'code[class*="language-"]': { fontFamily: "var(--font-mono)", fontSize: "12px", lineHeight: "1.8" } };
  const copyFix = async () => {
    const fix = report.fix.code_after;
    await onCopy(fix || report.fix.explanation, "Fix copied");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const traceLines = trace.split(/\r?\n/).filter(Boolean);
  const userFile = report.where_to_look.file;
  const isRelevant = (line: string) => userFile !== "Not detected" && line.includes(userFile) && (report.where_to_look.line === 0 || line.includes(String(report.where_to_look.line)));
  const hiddenCount = traceLines.filter((line) => /node_modules|site-packages|dist-packages|react-dom/i.test(line)).length;
  const visibleLines = showTrace ? traceLines : traceLines.filter((line) => !/node_modules|site-packages|dist-packages|react-dom/i.test(line));
  const audit = report.audit;

  return (
    <motion.div className="report-stack" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
      <div className="report-topbar"><div className="report-status"><span className="report-status-dot" /> REPORT READY <span className="report-divider">/</span> {mode.toUpperCase()} MODE</div><div className="report-actions"><button type="button" className="report-action" onClick={onDownload}><ArrowDownToLine size={14} /> Export .md</button>{canRetry && <button type="button" className="report-action" onClick={onRetry}><RotateCcw size={14} /> Retry Gemini</button>}</div></div>

      <motion.article className={`diagnosis-card confidence-${report.confidence}`} onMouseMove={spotlight} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="diagnosis-card-top"><div className="diagnosis-eyebrow"><span>THE SHORT ANSWER</span><span className="model-chip"><Sparkles size={12} /> {model || "Local parser"}</span></div><span className={`confidence-badge ${report.confidence}`}><span className="confidence-ring" /> {report.confidence} confidence</span></div>
        <h2 className="diagnosis-summary">{report.summary}</h2>
        <div className="diagnosis-context"><span className="context-icon"><Search size={16} /></span><div><b>{report.is_actually_an_error ? "Root cause" : "Input check"}</b><p>{report.root_cause}</p></div></div>
        <div className="diagnosis-card-bottom"><div className="location-readout"><span>WHERE TO LOOK</span><strong><FileCode2 size={14} /> {report.where_to_look.file}{report.where_to_look.line ? <b>:{report.where_to_look.line}</b> : null}</strong><small>{report.where_to_look.detail}</small></div><div className="diagnosis-footnote"><Gauge size={13} /> Confidence is a signal, not a guarantee.</div></div>
      </motion.article>

      {audit && <section className={`audit-trail audit-${audit.verdict.toLowerCase()}`} aria-labelledby="audit-trail-title">
        <div className="audit-trail-heading"><div><span className="panel-kicker">HUNTER · SKEPTIC · REFEREE</span><h3 id="audit-trail-title">Adversarial review</h3></div><span className="audit-verdict">{audit.verdict.replaceAll("_", " ")}</span></div>
        <p className="audit-claim">{audit.claim || audit.rationale}</p>
        <p className="audit-rationale">{audit.rationale}</p>
        <div className="audit-columns">
          <div><span className="audit-label">HUNTER EVIDENCE</span>{audit.evidence.length ? <ul>{audit.evidence.map((item, index) => <li key={`evidence-${index}`}>{item}</li>)}</ul> : <p>No source evidence was confirmed.</p>}</div>
          <div><span className="audit-label">SKEPTIC CHECK · {audit.skeptic_status.toUpperCase()}</span>{audit.counter_evidence.length ? <ul>{audit.counter_evidence.map((item, index) => <li key={`counter-${index}`}>{item}</li>)}</ul> : <p>No counter-evidence was recorded.</p>}</div>
        </div>
        {audit.runtime_trigger && <p className="audit-trigger"><b>Runtime trigger</b> {audit.runtime_trigger}</p>}
        {audit.manual_review.length > 0 && <div className="audit-manual"><b>Needs manual review</b><ul>{audit.manual_review.map((item, index) => <li key={`manual-${index}`}>{item}</li>)}</ul></div>}
        <div className="audit-verification"><LockKeyhole size={15} /><span><b>Verification not run</b>{audit.verification_reason}</span></div>
      </section>}

      {!report.is_actually_an_error && <div className="not-error-note"><CircleHelp size={16} /><div><b>No diagnosis was invented.</b><span>Paste a stack trace, build error, or screenshot to get a root cause.</span></div></div>}

      <div className="report-grid">
        <section className="report-panel fix-panel">
          <div className="panel-heading"><div><span className="panel-kicker">THE NEXT MOVE</span><h3>Start here</h3></div><span className="panel-icon"><TerminalSquare size={16} /></span></div>
          <p className="fix-explanation">{report.fix.explanation}</p>
          {report.fix.code_before || report.fix.code_after ? <div className="diff-block"><div className="diff-labels"><span className="before-label"><i>−</i> BEFORE</span><span className="after-label"><i>+</i> AFTER</span></div>{report.fix.code_before && <div className="code-row before"><span className="line-sign">−</span><SyntaxHighlighter language={languageForCode} style={codeStyle} customStyle={{ background: "transparent" }}>{report.fix.code_before}</SyntaxHighlighter></div>}{report.fix.code_after && <div className="code-row after"><span className="line-sign">+</span><SyntaxHighlighter language={languageForCode} style={codeStyle} customStyle={{ background: "transparent" }}>{report.fix.code_after}</SyntaxHighlighter></div>}</div> : <div className="safe-fix-note"><ShieldCheck size={15} /><span>TraceCard needs more context before suggesting a code edit.</span></div>}
          <button type="button" className="copy-fix-button" onClick={copyFix}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : report.fix.code_after ? "Copy the fix" : "Copy explanation"}<span>⌘ C</span></button>
        </section>

        <section className="report-panel trace-panel">
          <div className="panel-heading"><div><span className="panel-kicker">YOUR TRACE, CLEANED UP</span><h3>Signal in the stack</h3></div><span className="frame-count">{traceLines.length} <small>lines</small></span></div>
          <div className="trace-window"><div className="trace-window-top"><span><i /> <i /> <i /></span><span>{language || "Detected trace"}</span><button type="button" onClick={() => onCopy(trace, "Masked trace copied")} aria-label="Copy masked trace"><Copy size={13} /></button></div><div className="trace-code">{visibleLines.slice(0, 90).map((line, index) => <div className={`trace-line ${isRelevant(line) ? "relevant" : /error|exception|traceback/i.test(line) ? "error-line" : ""}`} key={`${index}-${line}`}><span className="trace-number">{index + 1}</span><code>{line}</code></div>)}</div></div>
          {hiddenCount > 0 && <button className="expand-trace" type="button" onClick={() => setShowTrace((value) => !value)}>{showTrace ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{showTrace ? "Hide library frames" : `Show ${hiddenCount} hidden library frames`}</button>}
        </section>
      </div>

      {(report.alternative_causes.length > 0 || report.needs_more_info.length > 0) && <section className="report-panel alternatives-panel"><button className="alternatives-toggle" type="button" onClick={() => setShowAlternatives((value) => !value)}><span className="alternatives-symbol">↗</span><span><span className="panel-kicker">STAY CURIOUS</span><strong>What else could it be?</strong></span><span className="alternatives-count">{report.alternative_causes.length || report.needs_more_info.length} {showAlternatives ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span></button><AnimatePresence>{showAlternatives && <motion.div className="alternatives-list" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}><div>{report.alternative_causes.map((item, index) => <motion.div className="alternative-item" key={item} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.08 }}><span>{String(index + 1).padStart(2, "0")}</span>{item}</motion.div>)}{report.needs_more_info.map((item, index) => <motion.div className="alternative-item question-item" key={item} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: (index + report.alternative_causes.length) * 0.08 }}><span>?</span>{item}</motion.div>)}</div></motion.div>}</AnimatePresence></section>}

      {report.sources.some((source) => safeUrl(source.url)) && <section className="sources-panel"><div className="sources-heading"><span className="source-globe">◎</span><div><span className="panel-kicker">GROUNDED IN CURRENT DOCS</span><h3>Worth a look</h3></div><span className="source-count">{report.sources.filter((source) => safeUrl(source.url)).length} SOURCES</span></div><div className="sources-list">{report.sources.filter((source) => safeUrl(source.url)).map((source, index) => <a href={source.url} target="_blank" rel="noreferrer" className="source-link" key={source.url}><span>{String(index + 1).padStart(2, "0")}</span><strong>{source.title}</strong><ArrowUpRight size={14} /></a>)}</div></section>}

      <section className="feature-proof"><div className="feature-proof-title"><span className="panel-kicker">WHAT POWERED THIS REPORT</span><span>Transparent by design</span></div><div className="feature-chips">{(features.length ? features : ["Local parsing", "Client-side masking", "No diagnosis without an error signal"]).map((feature) => <span key={feature}><CheckCheck size={12} /> {feature}</span>)}</div></section>

      <section className="chat-panel"><div className="chat-header"><div className="chat-avatar"><Orbit size={17} /></div><div><span className="panel-kicker">KEEP THE THREAD</span><h3>Still stuck?</h3></div><span className="chat-private"><LockKeyhole size={12} /> Masked before send</span></div>{conversation.length > 0 && <div className="conversation-list">{conversation.map((item, index) => <div className={`conversation-message ${item.role}`} key={`${index}-${item.text}`}><span>{item.role === "user" ? "YOU" : "TRACECARD"}</span><p>{item.text}</p></div>)}</div>}<form className="followup-form" onSubmit={onFollowUp}><label className="sr-only" htmlFor="follow-up-input">Ask a follow-up question</label><input id="follow-up-input" value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder="Ask a follow-up or share what you tried…" maxLength={2000} /><button type="submit" disabled={busy || !followUp.trim()} aria-label="Review follow-up"><span>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}</span></button></form><div className="chat-footnote">This follow-up is masked locally and shown in the review before it is sent.</div></section>
    </motion.div>
  );
}

export default function TraceCardApp() {
  const reduceMotion = useReducedMotion();
  const [trace, setTrace] = useState("");
  const [context, setContext] = useState("");
  const [languageOverride, setLanguageOverride] = useState("Auto detect");
  const [mode, setMode] = useState<Mode>("quick");
  const [beginner, setBeginner] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [image, setImage] = useState<ImageAttachment | null>(null);
  const [imageConsent, setImageConsent] = useState(false);
  const [dialog, setDialog] = useState<Modal>(null);
  const [pendingPayload, setPendingPayload] = useState<AnalyzePayload | null>(null);
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [model, setModel] = useState("Local parser");
  const [features, setFeatures] = useState<string[]>([]);
  const [localFallbackReason, setLocalFallbackReason] = useState("");
  const [activeStage, setActiveStage] = useState("trim");
  const [streamSummary, setStreamSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [history, setHistory] = useState<SavedReport[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<SavedReport | null>(null);
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [readingLocalFile, setReadingLocalFile] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const heroInputRef = useRef<HTMLElement>(null);
  const timerRef = useRef<number | null>(null);

  const autoLanguage = useMemo(() => detectLanguage(trace), [trace]);
  const detectedFramework = useMemo(() => detectFramework(trace), [trace]);
  const outputLanguage = languageOverride === "Auto detect" ? autoLanguage : languageOverride;
  const trimmedPreview = useMemo(() => trimTrace(trace), [trace]);
  const maskedPreview = useMemo(() => maskSecrets(trimmedPreview.text), [trimmedPreview.text]);
  const versionSensitive = useMemo(() => /\b(?:v?\d+\.\d+(?:\.\d+)?|deprecated|deprecation|removed in|breaking change|requires node|python\s+\d)/i.test(trace), [trace]);
  const characterCount = trace.length.toLocaleString();

  useEffect(() => {
    try {
      const rawHistory = localStorage.getItem(HISTORY_KEY);
      if (rawHistory) setHistory((JSON.parse(rawHistory) as SavedReport[]).filter((item) => Date.now() - item.createdAt < MAX_HISTORY_AGE));
      const rawPrefs = localStorage.getItem(PREF_KEY);
      if (rawPrefs) {
        const prefs = JSON.parse(rawPrefs) as { mode?: Mode; beginner?: boolean; theme?: "dark" | "light" };
        if (prefs.mode) setMode(prefs.mode);
        if (typeof prefs.beginner === "boolean") setBeginner(prefs.beginner);
        if (prefs.theme) setTheme(prefs.theme);
      }
    } catch { /* browser storage may be disabled */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ mode, beginner, theme })); } catch { /* preferences stay in memory */ }
  }, [mode, beginner, theme]);

  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10))); } catch { /* history stays in memory */ }
  }, [history]);

  useEffect(() => {
    if (!toast) return;
    timerRef.current = window.setTimeout(() => setToast(""), 2600);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [toast]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (analysisStarted) return;
        beginReview();
      }
      if (event.key === "Escape" && dialog) setDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addHistory = useCallback((nextReport: Report, usedModel: string, payload: AnalyzePayload) => {
    const entry: SavedReport = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      createdAt: Date.now(), report: nextReport, trace: payload.trace,
      language: payload.language, model: usedModel, mode: payload.mode,
    };
    setHistory((previous) => [entry, ...previous.filter((item) => item.trace !== entry.trace)].slice(0, 10));
  }, []);

  const openFile = async (file: File) => {
    if (file.type.startsWith("image/")) {
      if (!/image\/(png|jpeg|webp)/.test(file.type)) { setToast("Use a PNG, JPG, or WebP screenshot."); return; }
      if (file.size > 5 * 1024 * 1024) { setToast("Keep screenshots under 5 MB."); return; }
      setReadingLocalFile(true);
      setToast("Reading screenshot locally…");
      try {
        const nextImage = await readImage(file);
        setImage(nextImage);
        setImageConsent(false);
        setToast("Screenshot ready. Review its privacy note before sending.");
      } catch { setToast("That screenshot could not be opened."); }
      finally { setReadingLocalFile(false); }
      return;
    }
    if (!/\.(txt|log)$/i.test(file.name) && file.type !== "text/plain") { setToast("Choose a .log or .txt file."); return; }
    setReadingLocalFile(true);
    setToast("Reading trace locally…");
    try {
      const text = await file.text();
      setTrace(text.slice(0, 1_000_000));
      if (text.length > 1_000_000) setToast("File was capped at one million characters before local trimming.");
      else setToast("Log added. It will be trimmed and masked locally.");
    } catch { setToast("That log file could not be read."); }
    finally { setReadingLocalFile(false); }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) void openFile(selected);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false);
    const selected = event.dataTransfer.files?.[0];
    if (selected) void openFile(selected);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(event.clipboardData.items).find((clipboardItem) => clipboardItem.type.startsWith("image/"));
    if (!item) return;
    const pasted = item.getAsFile();
    if (pasted) { event.preventDefault(); void openFile(new File([pasted], `pasted-screenshot.${pasted.type.split("/")[1] || "png"}`, { type: pasted.type })); }
  };

  function buildPayload(followUpText?: string): AnalyzePayload {
    const preparedTrace = maskSecrets(trimTrace(trace).text);
    return {
      trace: preparedTrace.text,
      context: maskSecrets(context).text,
      followUp: followUpText ? maskSecrets(followUpText).text : "",
      language: outputLanguage,
      mode,
      beginner,
      versionSensitive,
      image: image ? { name: image.name, mimeType: image.mimeType, data: image.data } : null,
    };
  }

  const previewObject = useMemo(() => {
    if (!pendingPayload) return null;
    return {
      masked_trace: pendingPayload.trace,
      optional_source_context: pendingPayload.context || "",
      language: pendingPayload.language,
      analysis_mode: pendingPayload.mode,
      beginner_mode: pendingPayload.beginner,
      follow_up: pendingPayload.followUp || "",
      prior_report: pendingPayload.priorReport || undefined,
      conversation: pendingPayload.conversation || undefined,
      screenshot: pendingPayload.image ? { file_name: pendingPayload.image.name, mime_type: pendingPayload.image.mimeType, pixel_data: "Attached image bytes (not redacted locally)" } : undefined,
    };
  }, [pendingPayload]);
  const previewText = useMemo(() => previewObject ? JSON.stringify(previewObject, null, 2) : "", [previewObject]);
  const redactionCount = useMemo(() => (previewText.match(/\[MASKED_[^\]]+\]/g) || []).length, [previewText]);

  function beginReview() {
    if (readingLocalFile) return;
    if (!trace.trim() && !context.trim() && !image) { setToast("Paste a trace, add source code, or attach a screenshot to get started."); textAreaRef.current?.focus(); return; }
    if (trace.length > 1_000_000) { setToast("That input is too large. Trim it to under one million characters first."); return; }
    if (context.length > 40_000) { setToast("Keep source context under 40,000 characters for a focused review."); return; }
    setPendingPayload(buildPayload());
    setIsFollowUp(false);
    setImageConsent(false);
    setDialog("review");
  }

  function reviewFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!followUp.trim() || !report) return;
    const maskedFollowUp = maskSecrets(followUp).text;
    const nextConversation = [...conversation, { role: "user" as const, text: maskedFollowUp }].slice(-12);
    const base = pendingPayload || buildPayload();
    setPendingPayload({ ...base, followUp: maskedFollowUp, priorReport: report, conversation: nextConversation });
    setIsFollowUp(true);
    setImageConsent(false);
    setDialog("review");
  }

  async function runAnalysis(payload: AnalyzePayload, isQuestion: boolean) {
    setDialog(null);
    setAnalysisStarted(true);
    setBusy(true);
    setReport(null);
    setLocalFallbackReason("");
    setStreamSummary("");
    setActiveStage("trim");
    setFeatures([]);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const result = await requestAnalysis(payload, {
        onProgress: setActiveStage,
        onSummary: setStreamSummary,
      });
      setReport(result.report);
      setModel(result.model || "Gemini");
      setFeatures(result.features || []);
      if (isQuestion) {
        const userMessage = payload.followUp || "Follow-up question";
        setConversation((previous) => [...previous, { role: "user" as const, text: userMessage }, { role: "assistant" as const, text: result.report.summary }].slice(-12));
        setFollowUp("");
      }
      addHistory(result.report, result.model || "Gemini", payload);
    } catch (reason) {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      const fallback = localReport(payload.trace, payload.language, !!payload.image);
      setReport(fallback);
      setModel("Local parser");
      setFeatures(["Client-side masking", "Local trace parsing", "Browser-only fallback"]);
      const message = reason instanceof Error ? reason.message : "Gemini is unavailable.";
      setLocalFallbackReason(message);
      if (isQuestion) {
        setConversation((previous) => [...previous, { role: "user" as const, text: payload.followUp || "Follow-up question" }, { role: "assistant" as const, text: "I couldn't reach Gemini, so I kept this report local. Check the highlighted frame or add more context and retry." }].slice(-12));
        setFollowUp("");
      }
      addHistory(fallback, "Local parser", payload);
    } finally {
      setActiveStage("done");
      setBusy(false);
    }
  }

  function confirmReview() {
    if (!pendingPayload) return;
    if (pendingPayload.image && !imageConsent) { setToast("Confirm the screenshot privacy note before sending it."); return; }
    const payload = pendingPayload;
    const question = isFollowUp;
    void runAnalysis(payload, question);
  }

  async function copyText(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setToast(label); }
    catch { setToast("Clipboard access is unavailable in this browser."); }
  }

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([makeMarkdown(report, pendingPayload?.trace || maskedPreview.text)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tracecard-report.md";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    setToast("Markdown report downloaded.");
  }

  function retryGemini() {
    if (!pendingPayload) { setToast("Run a new analysis to retry Gemini."); return; }
    void runAnalysis(pendingPayload, false);
  }

  function loadHistory(item: SavedReport) {
    setSelectedHistory(item);
    setReport(item.report);
    setModel(item.model);
    setTrace(item.trace);
    setConversation([]);
    setPendingPayload({ trace: item.trace, context: "", language: item.language, mode: item.mode, beginner, versionSensitive: false, image: null });
    setFeatures(["Saved in this browser", "Masked trace"]);
    setAnalysisStarted(true);
    setDialog(null);
    setTimeout(() => document.getElementById("report-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function clearHistory() {
    setHistory([]); setSelectedHistory(null);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* no-op */ }
    setToast("Browser history cleared.");
  }

  function resetWorkspace() {
    setAnalysisStarted(false); setReport(null); setLocalFallbackReason(""); setStreamSummary(""); setConversation([]); setFollowUp("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const onTextareaKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); beginReview(); }
  };

  const displayProgress = (stage: string) => {
    if (stage === "done" || stage === "verification" || stage === "referee") return 4;
    if (stage === "skeptic") return 3;
    if (stage === "hunter") return 2;
    return 1;
  };
  const progressStep = displayProgress(activeStage);
  const reportTrace = pendingPayload?.trace || maskedPreview.text;

  return (
    <div className="site-root" data-theme={theme}>
      <DotGridBackground />
      <header className="topbar shell">
        <a className="brand" href="#top" aria-label="TraceCard home"><IconMark /><span>Trace<span>Card</span></span></a>
        <nav className="topnav" aria-label="Main navigation"><a href="#workspace">Workspace</a><a href="#how-it-works">How it works</a></nav>
        <div className="top-actions"><button className="history-button" type="button" onClick={() => setDialog("history")}><History size={15} /><span>History</span><b>{history.length}</b></button><button className="theme-button" type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button><a className="top-cta" href="#workspace">Start debugging <ArrowUpRight size={14} /></a></div>
      </header>

      {!analysisStarted ? <main className="shell" id="top">
        <section className="entry-hero minimaze-hero">
          <NeuralBrainDecoration />
          <div className="entry-copy">
            <div className="eyebrow"><span className="eyebrow-line" />TRACECARD / A CLEARER READ</div>
            <div className="entry-heading-row">
              <h1>THE ANSWER<br />IS IN THE <span>TRACE.</span></h1>
              <div className="entry-aside">
                <p className="hero-description">A stack trace is only the start. Find the line that matters, understand why it failed, and leave with a fix you can trust.</p>
                <div className="hero-actions"><a className="hero-cta" href="#workspace">Enter the workspace <ArrowRight size={16} /></a><a className="hero-secondary" href="#how-it-works">How it works <ChevronDown size={15} /></a></div>
                <div className="hero-trust"><ShieldCheck size={14} /><span>LOCAL MASKING <b>·</b> NO ACCOUNT REQUIRED</span></div>
              </div>
            </div>
          </div>
          <div className="gallery-heading"><span>SELECTED READS</span><span>FROM NOISY LOG TO CLEAR NEXT STEP</span><b>01 — 05</b></div>
          <TraceGallery />
          <div className="hero-bottom"><span>TRACE / CAUSE / FIX</span><span>READ THE SIGNAL. KEEP THE CONTEXT.</span><span>SCROLL TO WORKSPACE <ArrowDownToLine size={12} /></span></div>
        </section>

        <section className="workspace" id="workspace" ref={heroInputRef} aria-labelledby="workspace-title">
          <div className="workspace-heading"><div><div className="section-kicker"><span>01</span> START WITH THE ERROR</div><h2 id="workspace-title">Bring the broken thing.</h2><p>Paste a stack trace or add a screenshot. We’ll make the noise make sense.</p></div><div className="workspace-local"><span className="local-pulse" /> LOCAL MASKING ON</div></div>
          <div className="input-layout">
            <div className={`input-card ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
              <div className="input-card-top"><div className="input-tabs"><button type="button" className="input-tab active" onClick={() => textAreaRef.current?.focus()}><TerminalSquare size={14} /> Paste trace</button><button type="button" className="input-tab" onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Add screenshot</button></div><span className="input-format">.log / .txt / png / jpg</span></div>
              <label className="sr-only" htmlFor="error-input">Paste your error log or stack trace</label>
              <textarea id="error-input" ref={textAreaRef} value={trace} onChange={(event) => setTrace(event.target.value)} onKeyDown={onTextareaKey} onPaste={onPaste} spellCheck={false} placeholder={'Paste a stack trace, build error, or exception…\n\nWe trim the noise. Mask the secrets. Keep the useful bits.'} />
              {image && <div className="attachment-chip"><Image src={image.previewUrl} alt={`Preview of ${image.name}`} width={36} height={30} loading="lazy" unoptimized /><span><FileImage size={14} /> {image.name}<small>Pixel data requires separate confirmation</small></span><button type="button" aria-label="Remove screenshot" onClick={() => { setImage(null); setImageConsent(false); }}><X size={14} /></button></div>}
              <details className="source-context" open={Boolean(context)}><summary><Plus size={13} /> Add source code for review <span>optional</span></summary><label className="sr-only" htmlFor="source-context">Optional source code around the failing line</label><textarea id="source-context" value={context} onChange={(event) => setContext(event.target.value)} placeholder="Paste the relevant function or source excerpt. Include a file name and line numbers when available." rows={4} /></details>
              <div className="input-card-bottom"><div className="input-meta"><span>{characterCount} characters</span><i>·</i><span>{autoLanguage}{detectedFramework ? ` · ${detectedFramework}` : ""}</span>{trimmedPreview.trimmed && <b className="trim-notice">Will trim {trimmedPreview.omittedLines.toLocaleString()} lines</b>}</div><div className="input-tools"><label className="language-select-label"><span className="sr-only">Override language</span><select value={languageOverride} onChange={(event) => setLanguageOverride(event.target.value)} aria-label="Override detected language"><option>Auto detect</option><option>Python</option><option>JavaScript / Node</option><option>Java</option><option>Other</option></select></label><button className="mini-button" type="button" disabled={readingLocalFile} onClick={() => { setTrace(SAMPLE); setImage(null); setToast("Safe sample loaded. Add your own fake credentials to demo masking."); }}><Sparkles size={13} /> Try a sample</button><button className="mini-button" type="button" disabled={readingLocalFile} onClick={() => fileRef.current?.click()}><Upload size={13} /> Add file</button><input ref={fileRef} type="file" accept=".txt,.log,.png,.jpg,.jpeg,.webp,text/plain,image/png,image/jpeg,image/webp" hidden onChange={onFileChange} /></div></div>
              {dragging && <div className="drop-overlay"><Upload size={22} /><span>Drop your trace or screenshot here</span></div>}
            </div>
            <aside className="input-sidebar"><div className="mode-panel"><div className="panel-label">ANALYSIS MODE <span title="Deep mode spends more time reasoning through complex traces.">i</span></div><div className="mode-switch" role="radiogroup" aria-label="Analysis mode"><button className={`mode-option ${mode === "quick" ? "selected" : ""}`} role="radio" aria-checked={mode === "quick"} onClick={() => setMode("quick")} type="button"><span className="mode-speed">↯</span><span><b>Quick</b><small>Fast first answer</small></span><span className="mode-check">✓</span></button><button className={`mode-option ${mode === "deep" ? "selected" : ""}`} role="radio" aria-checked={mode === "deep"} onClick={() => setMode("deep")} type="button"><span className="mode-speed deep">✧</span><span><b>Deep</b><small>More reasoning</small></span><span className="mode-check">✓</span></button></div><label className="beginner-toggle"><span><b>Beginner mode</b><small>Explain it simply</small></span><input type="checkbox" checked={beginner} onChange={(event) => setBeginner(event.target.checked)} /><span className="switch-track" aria-hidden="true" /></label></div>
              <div className="privacy-panel"><div className="privacy-icon"><ShieldCheck size={18} /></div><div><b>Your logs stay yours</b><p>Secrets are masked in your browser. Review the exact text before it leaves.</p></div><button type="button" className="privacy-info" aria-label="Privacy details" onClick={() => setDialog("privacy")}><CircleHelp size={15} /></button></div>
              <motion.button className="explain-button" type="button" onClick={beginReview} disabled={readingLocalFile} whileTap={reduceMotion ? undefined : { scaleX: 0.96, scaleY: 1.06, y: 1 }} transition={{ type: "spring", stiffness: 460, damping: 17 }}><span className="button-shine" />{readingLocalFile ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} {readingLocalFile ? "Reading locally…" : "Explain this error"} <ArrowUpRight size={15} /></motion.button>
              <div className="key-hint"><kbd>⌘</kbd><kbd>↵</kbd> to explain <span /> Local masking <i /></div>
            </aside>
          </div>
          <div className="workspace-note"><LockKeyhole size={12} /> Masked locally <i>·</i> No server-side storage <i>·</i> Powered by Gemini when configured</div>
        </section>
        <HowItWorks />
        <Footer />
      </main> : <main className="shell app-main" id="top">
        <motion.section className="analysis-view" initial={reduceMotion ? false : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.3 }}>
          <div className="analysis-header"><div><div className="section-kicker"><span>02</span> PRIVATE BY DESIGN</div><h1>{report ? "The signal is clear." : "Following the signal"}<span className="headline-period">.</span></h1><p>{report ? "A grounded read of the error you shared." : "Your trace is being cleaned up before we ask for a second opinion."}</p></div><button className="back-button" type="button" onClick={resetWorkspace}><ArrowLeft size={14} /> Back to workspace</button></div>
          {!report && <motion.div className="flow-card is-busy" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, y: 15, scale: 0.97 }} animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: [0.97, 1.015, 1] }} transition={reduceMotion ? { duration: 0 } : { duration: 0.52, times: [0, 0.68, 1] }}>
            <div className="flow-topline"><span><i /> LIVE ANALYSIS PIPELINE</span><span>{mode.toUpperCase()} MODE · {mode === "quick" ? "LOW LATENCY" : "HIGH REASONING"}</span></div>
            <div className="flow-nodes">
              <div className={`flow-node ${progressStep >= 1 ? "active" : ""}`}><div className="node-icon"><ShieldCheck size={17} /></div><div><b>Local triage</b><small>Mask & sort evidence</small></div><span>{progressStep >= 2 ? "Done" : "Working"}</span></div>
              <div className={`flow-connector ${progressStep >= 2 ? "active" : ""}`}><span className="connector-line" /><motion.i className="beam-packet" animate={{ x: [0, 170], opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.4, ease: "linear" }} /><small>masked payload only</small></div>
              <div className={`flow-node ${progressStep >= 2 ? "active" : ""}`}><div className="node-icon gemini-node"><Sparkles size={17} /></div><div><b>Adversarial review</b><small>Hunter · Skeptic · Referee</small></div><span>{progressStep >= 4 ? "Done" : progressStep >= 2 ? "Reviewing" : "Waiting"}</span></div>
            </div>
            <div className="progress-list">
              <div className={progressStep >= 1 ? "done" : ""}><span><Check size={12} /></span><b>Trace triaged</b><small>Relevant frames and error signals selected</small></div>
              <div className={progressStep >= 2 ? "done" : ""}><span><Check size={12} /></span><b>Secrets masked</b><small>{maskedPreview.count} value{maskedPreview.count === 1 ? "" : "s"} redacted · previewed before sending</small></div>
              <div className={`${progressStep >= 4 ? "done" : ""} ${["hunter", "skeptic", "referee"].includes(activeStage) ? "current" : ""}`} aria-current={["hunter", "skeptic", "referee"].includes(activeStage) ? "step" : undefined}><span><Check size={12} /></span><b>{activeStage === "verification" || activeStage === "done" ? "Review complete" : "Hunter → Skeptic → Referee"}</b><small>{activeStage === "hunter" ? "Hunter is collecting concrete evidence" : activeStage === "skeptic" ? "Skeptic is checking counter-evidence" : activeStage === "referee" ? "Referee is deciding the verdict" : "Read-only review · no code execution"}</small></div>
            </div>
            {streamSummary && <div className="stream-summary"><span className="stream-spark">✦</span><div><span>FIRST SIGNAL</span><p>{streamSummary}</p></div></div>}
          </motion.div>}
          <AnimatePresence>{report && <div id="report-anchor"><ReportContent report={report} trace={reportTrace} language={outputLanguage} model={model} mode={mode} features={features} onCopy={copyText} onDownload={downloadReport} onRetry={retryGemini} canRetry={!!localFallbackReason} conversation={conversation} onFollowUp={reviewFollowUp} followUp={followUp} setFollowUp={setFollowUp} busy={busy} /></div>}</AnimatePresence>
          {localFallbackReason && report && <div className="fallback-banner"><div><CircleHelp size={16} /><span><b>Showing the local read.</b> {localFallbackReason}</span></div><button type="button" onClick={retryGemini}><RotateCcw size={13} /> Retry</button></div>}
          {report && <Footer />}
        </motion.section>
      </main>}

      <AnimatePresence>{dialog && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
        {dialog === "review" && pendingPayload && <motion.section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}><div className="dialog-top"><div><div className="section-kicker"><span>02</span> BEFORE ANYTHING LEAVES</div><h2 id="review-title">Your privacy check</h2></div><button className="dialog-close" type="button" onClick={() => setDialog(null)} aria-label="Close"><X size={17} /></button></div><p className="dialog-copy">This is exactly what TraceCard will send as text. Redactions run in your browser. Check that sensitive values are covered.</p><div className="payload-toolbar"><span><i /> MASKED PAYLOAD PREVIEW</span><span>{(pendingPayload.trace.match(/\n/g) || []).length + 1} lines · {redactionCount} redactions</span></div><pre className="payload-preview" tabIndex={0}>{redactTextNodes(previewText)}</pre>{pendingPayload.image && <div className="image-disclosure"><label><input type="checkbox" checked={imageConsent} onChange={(event) => setImageConsent(event.target.checked)} /> <span>I understand <b>{pendingPayload.image.name}</b> will be sent as image data. Its pixels are not redacted locally.</span></label></div>}<div className="disclosure-note"><LockKeyhole size={14} /> {pendingPayload.image ? "The masked trace and screenshot" : "The masked trace"} go to Google’s Gemini API for analysis. TraceCard does not store requests on a server.</div><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDialog(null)}>Go back</button><button className="primary-button" type="button" onClick={confirmReview} disabled={!!pendingPayload.image && !imageConsent}>{isFollowUp ? "Review follow-up" : "Send masked trace"} <ArrowUpRight size={15} /></button></div></motion.section>}
        {dialog === "history" && <motion.aside className="side-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 30, opacity: 0 }}><div className="drawer-header"><div><div className="section-kicker">ON THIS DEVICE ONLY</div><h2 id="history-title">Your history</h2></div><button className="dialog-close" type="button" onClick={() => setDialog(null)} aria-label="Close"><X size={17} /></button></div><div className="history-list">{history.length === 0 ? <div className="history-empty"><Clock3 size={22} /><b>No reports yet</b><span>Reports you choose to keep appear here in this browser.</span></div> : history.map((item) => <button type="button" className="history-item" key={item.id} onClick={() => loadHistory(item)}><span className={`history-confidence ${item.report.confidence}`} /> <span><b>{item.report.summary}</b><small>{new Date(item.createdAt).toLocaleString()} · {item.model} · {item.mode}</small></span><ChevronRight size={15} /></button>)}</div><div className="drawer-footer"><span>Masked traces and reports stay in this browser.</span><button type="button" className="danger-button" onClick={clearHistory} disabled={!history.length}><Trash2 size={13} /> Clear history</button></div></motion.aside>}
        {dialog === "privacy" && <motion.aside className="side-dialog privacy-dialog" role="dialog" aria-modal="true" aria-labelledby="privacy-title" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 30, opacity: 0 }}><div className="drawer-header"><div><div className="section-kicker">LOCAL FIRST, BY DEFAULT</div><h2 id="privacy-title">A clearer privacy story</h2></div><button className="dialog-close" type="button" onClick={() => setDialog(null)} aria-label="Close"><X size={17} /></button></div><PrivacyDetails /><button className="primary-button full-button" type="button" onClick={() => setDialog(null)}>Got it <Check size={15} /></button></motion.aside>}
        {dialog === "saved-report" && selectedHistory && <motion.aside className="side-dialog" role="dialog" aria-modal="true" aria-labelledby="saved-report-title" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 30, opacity: 0 }}><div className="drawer-header"><div><div className="section-kicker">SAVED REPORT</div><h2 id="saved-report-title">{selectedHistory.report.summary}</h2></div><button className="dialog-close" type="button" onClick={() => setDialog(null)} aria-label="Close"><X size={17} /></button></div><p>{selectedHistory.report.root_cause}</p><button type="button" className="primary-button full-button" onClick={() => loadHistory(selectedHistory)}>Open report <ArrowRight size={15} /></button></motion.aside>}
      </motion.div>}</AnimatePresence>
      <AnimatePresence>{toast && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}><Check size={14} /> {toast}</motion.div>}</AnimatePresence>
    </div>
  );
}

function HowItWorks() {
  const items = [
    { icon: <Search size={18} />, num: "01 / FIND THE SIGNAL", title: "Less noise. More signal.", copy: "Long traces get trimmed to the lines that matter. Framework noise folds away; your code comes forward.", tint: "red", motif: <div className="feature-motif noise-motif"><span>node_modules/…</span><span>at processTicks…</span><b>→</b><strong>UserCard.js:42</strong></div> },
    { icon: <ShieldCheck size={18} />, num: "02 / KEEP IT PRIVATE", title: "Secrets don't leave unmasked.", copy: "Keys, tokens, emails, and personal paths are redacted locally. Review the exact text before it goes.", tint: "grey", motif: <div className="feature-motif mask-motif"><code>api_key=<s>AIza••••</s> <b>→</b> api_key=<strong>[MASKED]</strong></code></div> },
    { icon: <Orbit size={18} />, num: "03 / EXPLAIN THE WHY", title: "A fix you can learn from.", copy: "Get the root cause, the file and line, a minimal before-and-after fix, and an honest confidence rating.", tint: "red", motif: <div className="feature-motif confidence-motif"><span>CONFIDENCE</span><b /><strong>High · 94%</strong></div> },
  ];
  return <section className="how-section" id="how-it-works"><div className="how-head"><div><div className="section-kicker">NO MAGIC. JUST A BETTER SIGNAL.</div><h2>Debugging, with the fog lifted.</h2></div><p>Built to help you understand what’s happening—then get out of your way.</p></div><div className="feature-grid">{items.map((item, index) => <motion.article className="feature-card" key={item.num} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ delay: index * 0.07 }}><div className={`feature-icon ${item.tint}`}>{item.icon}</div><div className="feature-index">{item.num}</div><h3>{item.title}</h3><p>{item.copy}</p>{item.motif}</motion.article>)}</div><div className="feature-steps"><div><span>01</span><b>Trim the noise</b><small>Locally, in your browser</small></div><i /><div><span>02</span><b>Mask the secrets</b><small>Review the payload first</small></div><i /><div><span>03</span><b>Understand the fix</b><small>With confidence and sources</small></div></div><div className="marquee-strip"><div><span>LOCAL MASKING</span><b>✳</b><span>GEMINI POWERED</span><b>✳</b><span>HONEST CONFIDENCE</span><b>✳</b><span>FIX THE ROOT CAUSE</span><b>✳</b><span>LOCAL MASKING</span><b>✳</b><span>GEMINI POWERED</span><b>✳</b></div></div></section>;
}

function PrivacyDetails() {
  const details = [
    ["01", "Masking happens in your browser", "Common keys, tokens, emails, IP addresses, and usernames in file paths are replaced before a request is built."],
    ["02", "You review the payload", "The masked text is shown before sending. Screenshot pixels cannot be locally redacted; sending an image requires an explicit confirmation."],
    ["03", "Gemini receives the masked request", "When live analysis is configured, masked traces and selected screenshots go to Google’s Gemini API. TraceCard does not save requests on a server."],
    ["04", "History stays in this browser", "Masked traces and reports are stored locally on this device. Clear them from History whenever you want."],
  ];
  return <div className="privacy-details">{details.map(([num, title, copy]) => <div className="privacy-detail" key={num}><span>{num}</span><div><b>{title}</b><p>{copy}</p></div></div>)}</div>;
}

function Footer() {
  return <footer className="footer"><a className="brand" href="#top"><IconMark /><span>Trace<span>Card</span></span></a><span>Find the cause. Understand the fix.</span><span className="footer-right">Built for the debugging moment <i>✦</i></span></footer>;
}
