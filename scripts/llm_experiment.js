/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  FormAI — LLM Rate-Limit Experiment
 *  Run: node scripts/llm_experiment.js
 *
 *  What this does:
 *  1. Sends real batches of fake form questions to your LLM provider
 *  2. Measures ACTUAL token usage per call (prompt + completion)
 *  3. Records exact response times
 *  4. Fires requests back-to-back until a 429 hits, measuring real limits
 *  5. Prints a mathematical recommendation for optimal BATCH_SIZE & COOLDOWN
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  SETUP: create a file `scripts/experiment_config.json` with:
 *  {
 *    "vendor": "groq",          // or "openai" / "gemini"
 *    "apiKey": "YOUR_KEY_HERE",
 *    "model": "llama-3.1-8b-instant"  // or blank for default
 *  }
 */

const fs = require("fs");
const path = require("path");

// ── Config ─────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, "experiment_config.json");

if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`\n❌  Missing config file: ${CONFIG_PATH}`);
  console.error(`\nCreate it with:\n{\n  "vendor": "groq",\n  "apiKey": "YOUR_KEY_HERE",\n  "model": "llama-3.1-8b-instant"\n}\n`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const VENDOR  = cfg.vendor  || "groq";
const API_KEY = cfg.apiKey  || "";
const MODEL   = cfg.model   || (VENDOR === "groq" ? "llama-3.1-8b-instant" : VENDOR === "openai" ? "gpt-4o-mini" : null);

if (!API_KEY || API_KEY === "YOUR_KEY_HERE") {
  console.error("❌  Please add a real apiKey to experiment_config.json\n");
  process.exit(1);
}

// ── Fake Form Block Generator ───────────────────────────────────────────────
function makeFakeBlocks(n) {
  const templates = [
    { prompt: "What is your full name?",   type: "TEXT_INPUT" },
    { prompt: "Select your year of study.", type: "MULTIPLE_CHOICE", options: ["1st Year", "2nd Year", "3rd Year", "4th Year"] },
    { prompt: "Choose your department.",    type: "DROPDOWN",         options: ["CS", "ME", "EE", "Civil", "IT"] },
    { prompt: "List your hobbies.",         type: "TEXT_INPUT" },
    { prompt: "Do you have a laptop?",      type: "MULTIPLE_CHOICE", options: ["Yes", "No"] },
    { prompt: "Rate your GPA (CGPA).",      type: "DROPDOWN",         options: ["<6", "6-7", "7-8", "8-9", ">9"] },
    { prompt: "Select known languages.",    type: "CHECKBOXES",       options: ["Python", "Java", "C++", "JavaScript", "Go"] },
    { prompt: "Describe your project idea.", type: "TEXT_INPUT" },
  ];
  return Array.from({ length: n }, (_, i) => ({
    blockIndex: i,
    promptText: templates[i % templates.length].prompt,
    components: [
      {
        type: templates[i % templates.length].type,
        options: templates[i % templates.length].options || undefined,
        placeholder: "Answer here"
      }
    ]
  }));
}

// ── System Prompt (same as production) ─────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert Google Form solving agent.
Your task is to analyze the provided form blocks structure and determine the best actions for each block's components.

CRITICAL INSTRUCTIONS:
1. You MUST output ONLY valid, raw JSON. No markdown backticks, no explanations.
2. The output MUST be a JSON object with a single root key "answers" containing an array of objects.
3. Each object in the "answers" array represents a block and MUST have:
   - "blockIndex": integer (must match the input block's blockIndex)
   - "actions": array of objects, one for each component in the input block's "components" list (in the exact same order).
4. Each component action object MUST have:
   - "type": string matching the input component type ("MULTIPLE_CHOICE", "CHECKBOXES", "DROPDOWN", or "TEXT_INPUT")
   - "value": string representation of the answer.
5. For missing personal context, output "Not Provided" for TEXT_INPUT fields.

USER PROFILE:
Name: Test User, Email: test@example.com, Year: 3rd Year, Department: CS, CGPA: 8.5`;

// ── LLM Caller ─────────────────────────────────────────────────────────────
async function callLLM(blocks, label = "") {
  const userPrompt = JSON.stringify(blocks, null, 2);
  const promptTokensEst = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);

  const url = VENDOR === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : VENDOR === "openai"
    ? "https://api.openai.com/v1/chat/completions"
    : VENDOR === "openrouter"
    ? "https://openrouter.ai/api/v1/chat/completions"
    : VENDOR === "nvidia"
    ? "https://integrate.api.nvidia.com/v1/chat/completions"
    : null;

  if (VENDOR === "gemini") {
    throw new Error("Gemini not yet wired in experiment — use groq or openai");
  }

  const t0 = Date.now();
  let response, data;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 2048
      })
    });
    data = await response.json();
  } catch(e) {
    return { ok: false, httpStatus: 0, error: e.message, elapsed: Date.now() - t0, label };
  }

  const elapsed = Date.now() - t0;

  if (!response.ok) {
    const errMsg = data?.error?.message || response.statusText;
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterInError = errMsg.match(/try again in\s*([\d.]+)s/i)?.[1];
    return {
      ok: false,
      httpStatus: response.status,
      error: errMsg,
      elapsed,
      label,
      retryAfterSecs: retryAfterHeader ? parseFloat(retryAfterHeader) : (retryAfterInError ? parseFloat(retryAfterInError) : null),
      promptTokensEst
    };
  }

  const usage = data.usage || {};
  const answer = data.choices?.[0]?.message?.content || "";
  let parsedOk = false;
  try { JSON.parse(answer.replace(/```(?:json)?/gi,'').trim()); parsedOk = true; } catch(e) {}

  return {
    ok: true,
    httpStatus: response.status,
    elapsed,
    label,
    usage: {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    },
    answer,
    parsedOk,
    promptTokensEst
  };
}

// ── Pretty Print Helpers ────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  cyan: "\x1b[36m", grey: "\x1b[90m", blue: "\x1b[34m", magenta: "\x1b[35m"
};
const B  = (s) => `${C.bold}${s}${C.reset}`;
const G  = (s) => `${C.green}${s}${C.reset}`;
const Y  = (s) => `${C.yellow}${s}${C.reset}`;
const R  = (s) => `${C.red}${s}${C.reset}`;
const Cy = (s) => `${C.cyan}${s}${C.reset}`;
const Gr = (s) => `${C.grey}${s}${C.reset}`;
const Mg = (s) => `${C.magenta}${s}${C.reset}`;

function hr(char = "─", n = 62) { return char.repeat(n); }

function printRow(label, blocks, result) {
  const status = result.ok ? G("✓ OK ") : R(`✗ ${result.httpStatus}`);
  const time   = `${result.elapsed}ms`.padStart(7);
  const tokIn  = result.usage ? `${result.usage.promptTokens}`.padStart(6)     : Gr("  n/a ");
  const tokOut = result.usage ? `${result.usage.completionTokens}`.padStart(5) : Gr(" n/a ");
  const tokTot = result.usage ? `${result.usage.totalTokens}`.padStart(6)      : Gr("  n/a ");
  const parse  = result.ok ? (result.parsedOk ? G("JSON✓") : Y("JSON?")) : Gr("     ");
  const retry  = result.retryAfterSecs ? Y(` retry-after=${result.retryAfterSecs}s`) : "";
  const errSnip = result.error ? R(` ${result.error.substring(0, 60)}`) : "";
  console.log(
    ` ${status} │ ${Cy(label.padEnd(22))} │ blocks=${String(blocks).padStart(2)} │ ${time} │ in=${tokIn} out=${tokOut} tot=${tokTot} │ ${parse}${retry}${errSnip}`
  );
}

// ── EXPERIMENT 1: Single-Shot Accuracy Across Batch Sizes ──────────────────
async function experiment1() {
  console.log(`\n${B(hr("═"))}`);
  console.log(B(` EXPERIMENT 1 — Token & Latency vs. Batch Size`));
  console.log(B(` Vendor: ${VENDOR.toUpperCase()} | Model: ${MODEL}`));
  console.log(B(hr("═")));
  console.log(Gr(` What is sent → shown below. What is returned → shown inline.\n`));
  console.log(` Status │ Label                  │ N      │ Latency │ Tok-In  Tok-Out Tot-In │ Parse`);
  console.log(hr());

  const sizes = [1, 2, 4, 6, 8, 10, 15];
  const results1 = [];

  for (const n of sizes) {
    const blocks = makeFakeBlocks(n);
    const result = await callLLM(blocks, `batch_n${n}`);
    printRow(`batch_n${n}`, n, result);
    results1.push({ n, ...result });

    // Print the ACTUAL LLM response for inspection
    if (result.ok && result.answer) {
      try {
        const parsed = JSON.parse(result.answer.replace(/```(?:json)?/gi,'').trim());
        const answers = parsed.answers || parsed;
        console.log(Gr(`   └─ LLM returned ${Array.isArray(answers) ? answers.length : 1} answer(s). First: `
          + JSON.stringify(Array.isArray(answers) ? answers[0] : answers).substring(0, 100) + "..."));
      } catch(e) {
        console.log(Y(`   └─ Raw (parse failed): ${result.answer.substring(0, 120)}...`));
      }
    } else if (!result.ok) {
      console.log(R(`   └─ ERROR: ${result.error?.substring(0, 100)}`));
      if (result.retryAfterSecs) {
        console.log(Y(`   └─ Waiting ${result.retryAfterSecs + 2}s as instructed by API...`));
        await new Promise(r => setTimeout(r, (result.retryAfterSecs + 2) * 1000));
      }
    }

    // 3s gap between different batch size tests to avoid contaminating results
    if (n !== sizes[sizes.length - 1]) await new Promise(r => setTimeout(r, 3000));
  }

  return results1;
}

// ── EXPERIMENT 2: Burst Fire — Find True Rate Limit ────────────────────────
async function experiment2() {
  console.log(`\n${B(hr("═"))}`);
  console.log(B(` EXPERIMENT 2 — Burst Fire: Find True Rate-Limit Threshold`));
  console.log(B(hr("═")));
  console.log(Gr(` Fires requests as fast as possible with 4-block batches until 429.\n`));
  console.log(` Status │ Label                  │ N      │ Latency │ Tok-In  Tok-Out Tot-In │ Parse`);
  console.log(hr());

  const BURST_BLOCKS = 4;
  const MAX_BURST = 20;
  const results2 = [];
  let totalTokens = 0;
  let burstStart = Date.now();
  let hitRateLimit = false;
  let reqCount = 0;

  for (let i = 0; i < MAX_BURST; i++) {
    reqCount++;
    const blocks = makeFakeBlocks(BURST_BLOCKS);
    const result = await callLLM(blocks, `burst_req_${i + 1}`);
    printRow(`burst_req_${i + 1}`, BURST_BLOCKS, result);
    results2.push({ req: i + 1, ...result });

    if (result.usage) totalTokens += result.usage.totalTokens || 0;

    if (!result.ok && result.httpStatus === 429) {
      hitRateLimit = true;
      const elapsed = ((Date.now() - burstStart) / 1000).toFixed(2);
      console.log(`\n${R(` Rate limit hit on request #${reqCount} after ${elapsed}s`)}`);
      console.log(Y(` Total tokens consumed before limit: ~${totalTokens}`));
      if (result.retryAfterSecs) {
        console.log(Y(` API says retry after: ${result.retryAfterSecs}s`));
      }
      break;
    }
  }

  if (!hitRateLimit) {
    const elapsed = ((Date.now() - burstStart) / 1000).toFixed(2);
    console.log(G(`\n ✓ No rate limit hit after ${reqCount} burst requests over ${elapsed}s`));
    console.log(G(` Total tokens consumed: ~${totalTokens}`));
  }

  return { results2, hitRateLimit, burstReqs: reqCount, totalBurstTokens: totalTokens };
}

// ── EXPERIMENT 3: Cooldown Calibration ─────────────────────────────────────
async function experiment3(hitRateLimit) {
  console.log(`\n${B(hr("═"))}`);
  console.log(B(` EXPERIMENT 3 — Minimum Cooldown Calibration`));
  console.log(B(hr("═")));
  console.log(Gr(` Tests if short cooldowns (1s, 3s, 5s, 8s) are enough between batches.\n`));

  const cooldowns = [1000, 3000, 5000, 8000];
  const results3 = [];

  for (const cd of cooldowns) {
    // Brief burst to raise token usage, then cool down exactly cd ms
    console.log(Y(`\n Testing ${cd}ms cooldown between 4-block requests:`));
    const b1 = await callLLM(makeFakeBlocks(4), `pre_cd_${cd}ms`);
    printRow(`pre_cd_${cd}ms`, 4, b1);

    console.log(Gr(`  └─ Waiting ${cd}ms...`));
    await new Promise(r => setTimeout(r, cd));

    const b2 = await callLLM(makeFakeBlocks(4), `post_cd_${cd}ms`);
    printRow(`post_cd_${cd}ms`, 4, b2);
    results3.push({ cooldownMs: cd, pre: b1, post: b2, postSuccess: b2.ok });

    // Reset between tests
    await new Promise(r => setTimeout(r, 5000));
  }

  return results3;
}

// ── FINAL MATH & RECOMMENDATIONS ───────────────────────────────────────────
function computeRecommendations(r1, r2, r3) {
  console.log(`\n${B(hr("═"))}`);
  console.log(B(` MATHEMATICAL ANALYSIS & RECOMMENDATIONS`));
  console.log(B(hr("═")));

  // Token analysis from experiment 1
  const valid = r1.filter(r => r.ok && r.usage);
  if (valid.length > 0) {
    console.log(Cy(`\n📊 Token Usage per Batch Size (${VENDOR.toUpperCase()}/${MODEL}):`));
    console.log(` ${"Blocks".padEnd(8)} │ ${"Prompt Tok".padEnd(12)} │ ${"Completion Tok".padEnd(15)} │ ${"Total".padEnd(8)} │ ${"Latency".padEnd(10)} │ Tok/Block`);
    console.log(hr("-"));
    valid.forEach(r => {
      const tpb = Math.round(r.usage.totalTokens / r.n);
      console.log(
        ` ${String(r.n).padEnd(8)} │ ${String(r.usage.promptTokens).padEnd(12)} │ ${String(r.usage.completionTokens).padEnd(15)} │ ${String(r.usage.totalTokens).padEnd(8)} │ ${(r.elapsed + "ms").padEnd(10)} │ ${tpb}`
      );
    });

    // Groq TPM limits (6000 TPM for free, ~30000 for paid)
    const GROQ_FREE_TPM  = 6000;
    const GROQ_PAID_TPM  = 30000;
    const avgToksPerBlock = Math.round(valid.reduce((s,r) => s + r.usage.totalTokens / r.n, 0) / valid.length);
    const sysPromptToks  = valid[0]?.usage?.promptTokens - Math.ceil(JSON.stringify(makeFakeBlocks(valid[0].n)).length / 4) || 400;

    console.log(Cy(`\n🧮 Derived Constants:`));
    console.log(` Average tokens per block : ${B(avgToksPerBlock)}`);
    console.log(` System prompt overhead   : ~${B(sysPromptToks)} tokens`);

    console.log(Cy(`\n📐 Optimal Batch Size Calculation (Groq Free Tier = ${GROQ_FREE_TPM} TPM):`));
    // Max blocks where total tokens < 5500 (safety margin below 6000)
    const safeLimit = GROQ_FREE_TPM * 0.9;
    const maxBlocksFree = Math.floor((safeLimit - sysPromptToks) / avgToksPerBlock);
    const maxBlocksPaid = Math.floor(((GROQ_PAID_TPM * 0.9) - sysPromptToks) / avgToksPerBlock);
    console.log(` Free tier  safe batch size: ${B(G(Math.max(1, maxBlocksFree)))} blocks`);
    console.log(` Paid tier  safe batch size: ${B(G(Math.max(1, maxBlocksPaid)))} blocks`);

    // Current vs recommended
    const CURRENT_BATCH = 4;
    const CURRENT_COOLDOWN = 12000;
    console.log(Cy(`\n⚡ Throughput Comparison:`));
    console.log(` ${"Config".padEnd(20)} │ ${"Batch".padEnd(8)} │ ${"Cooldown".padEnd(10)} │ Blocks/min`);
    console.log(hr("-"));
    const calcThroughput = (batch, cdMs, latency = 2000) => {
      const timePerBatch = latency + cdMs;
      return Math.floor((batch / timePerBatch) * 60000);
    };
    const avgLatency = Math.round(valid.reduce((s,r) => s + r.elapsed, 0) / valid.length);
    const recommended_cd = Math.max(1000, Math.round((avgToksPerBlock * maxBlocksFree / GROQ_FREE_TPM) * 60000 * 0.2));
    console.log(
      ` ${"Current (prod)".padEnd(20)} │ ${String(CURRENT_BATCH).padEnd(8)} │ ${(CURRENT_COOLDOWN + "ms").padEnd(10)} │ ${calcThroughput(CURRENT_BATCH, CURRENT_COOLDOWN, avgLatency)}`
    );
    console.log(
      ` ${"Recommended".padEnd(20)} │ ${String(maxBlocksFree).padEnd(8)} │ ${(recommended_cd + "ms").padEnd(10)} │ ${G(calcThroughput(maxBlocksFree, recommended_cd, avgLatency))}`
    );
  }

  // Cooldown analysis
  if (r3.length > 0) {
    console.log(Cy(`\n⏱  Minimum Viable Cooldown:`));
    r3.forEach(r => {
      const status = r.postSuccess ? G("✓ OK") : R("✗ FAIL");
      console.log(` Cooldown ${String(r.cooldownMs).padStart(5)}ms → ${status}`);
    });
    const minWorkingCd = r3.find(r => r.postSuccess)?.cooldownMs;
    if (minWorkingCd) {
      console.log(G(`\n ✅ Minimum working cooldown: ${minWorkingCd}ms`));
    }
  }

  // Burst analysis
  if (r2.hitRateLimit) {
    console.log(Y(`\n⚡ Burst analysis: Rate limit hit after ${r2.burstReqs} requests (~${r2.totalBurstTokens} tokens)`));
  }

  console.log(`\n${B(hr("═"))}`);
  console.log(B(` COPY-PASTE THESE VALUES INTO background.js`));
  console.log(B(hr("═")));
  const valid2 = r1.filter(r => r.ok && r.usage);
  if (valid2.length > 0) {
    const avgToksPerBlock2 = Math.round(valid2.reduce((s,r) => s + r.usage.totalTokens / r.n, 0) / valid2.length);
    const sysPromptToks2 = valid2[0]?.usage?.promptTokens - Math.ceil(JSON.stringify(makeFakeBlocks(valid2[0].n)).length / 4) || 400;
    const recommendedBatch = Math.max(1, Math.floor(((6000 * 0.88) - sysPromptToks2) / avgToksPerBlock2));
    const minCd = r3.find(r => r.postSuccess)?.cooldownMs || 5000;
    const recommendedCd = Math.max(minCd, 3000);
    console.log(G(`\nconst BATCH_SIZE    = ${recommendedBatch};  // Experiment-derived (was 4)`));
    console.log(G(`const BATCH_COOLDOWN = ${recommendedCd}; // Experiment-derived (was 12000)`));
  }

  console.log(`\n${Gr(" Full results saved to scripts/experiment_results.json")}\n`);
}

// ── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${B(hr("═", 62))}`);
  console.log(B(`  FormAI LLM Rate-Limit Experiment`));
  console.log(B(`  Vendor: ${VENDOR.toUpperCase()} | Model: ${MODEL}`));
  console.log(B(`  Time  : ${new Date().toLocaleString()}`));
  console.log(B(hr("═", 62)));

  // Show EXACT system prompt being sent
  console.log(Mg(`\n── SYSTEM PROMPT SENT TO LLM (${SYSTEM_PROMPT.length} chars) ──`));
  console.log(Gr(SYSTEM_PROMPT.substring(0, 500) + "\n[...truncated for display...]"));

  // Show example user prompt
  const exampleBlocks = makeFakeBlocks(4);
  const examplePrompt = JSON.stringify(exampleBlocks, null, 2);
  console.log(Mg(`\n── EXAMPLE USER PROMPT (4-block batch, ${examplePrompt.length} chars) ──`));
  console.log(Gr(examplePrompt.substring(0, 600) + "\n[...truncated for display...]"));

  const r1 = await experiment1();
  const { results2, hitRateLimit, burstReqs, totalBurstTokens } = await experiment2();
  const r3 = await experiment3(hitRateLimit);

  computeRecommendations(r1, { results2, hitRateLimit, burstReqs, totalBurstTokens }, r3);

  // Save full results
  const outPath = path.join(__dirname, "experiment_results.json");
  fs.writeFileSync(outPath, JSON.stringify({ vendor: VENDOR, model: MODEL, r1, results2, r3, timestamp: new Date().toISOString() }, null, 2));
  console.log(G(` Results saved to ${outPath}\n`));
}

main().catch(e => { console.error(R(`\nFatal: ${e.message}\n`)); process.exit(1); });
