#!/usr/bin/env node
/**
 * Lightweight secret scan for tracked files.
 *
 * This is a safety net, not a replacement for review or a dedicated scanner.
 * It intentionally avoids printing the matched value.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const patterns = [
  { name: "private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Slack token", regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: "Stripe live key", regex: /\bsk_live_[0-9A-Za-z]{20,}\b/ },
  {
    name: "known leaked demo token",
    // Assembled so this scanner does not itself contain the literal.
    regex: new RegExp(`\\bsynthesis${5}\\b`),
  },
];

const binaryExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".woff", ".woff2",
]);

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" });
  return output.toString("utf8").split("\0").filter(Boolean);
}

const findings = [];
for (const file of trackedFiles()) {
  const lower = file.toLowerCase();
  const extension = lower.slice(lower.lastIndexOf("."));
  if (binaryExtensions.has(extension)) continue;
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        findings.push({ file, line: index + 1, name: pattern.name });
      }
    }
  });
}

if (findings.length > 0) {
  console.error("Potential secrets found in tracked files:");
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.name}`);
  }
  console.error("\nRemove the value, rotate the credential, and purge it from history if needed.");
  process.exit(1);
}

console.log("Secret scan passed: no high-confidence secret patterns in tracked files.");
