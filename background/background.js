// background.js — RATE-LIMIT AWARE ENGINE

let logQueue = [];
let isWritingLog = false;

async function addTelemetryLog(source, category, message) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, source, category, message };
  
  // Log to console for live debugging
  console.log(`[${timestamp}] [${source}] [${category}] ${message}`);

  logQueue.push(logEntry);
  if (isWritingLog) return;
  isWritingLog = true;

  while (logQueue.length > 0) {
    const entry = logQueue.shift();
    await new Promise((resolve) => {
      chrome.storage.local.get(["telemetryLogs"], (data) => {
        const logs = data.telemetryLogs || [];
        logs.push(entry);
        // Cap telemetry logs to avoid storage bloat
        if (logs.length > 2000) {
          logs.shift();
        }
        chrome.storage.local.set({ telemetryLogs: logs }, resolve);
      });
    });
  }

  isWritingLog = false;
}

async function writeLog(category, message) {
  await addTelemetryLog("Background Engine", category, message);
}

async function saveHtmlToLocalServer(filename, html) {
  try {
    const response = await fetch('http://localhost:3000/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filename, html })
    });
    const data = await response.json();
    if (data.success) {
      await writeLog("Local HTML Saver", `Saved ${filename} directly to project directory at: ${data.path}`);
      return { status: "success", path: data.path };
    } else {
      await writeLog("Error", `Failed to save ${filename}: ${data.error}`);
      return { status: "error", message: data.error };
    }
  } catch (err) {
    console.warn(`[FormAI] Local server not running or unreachable. Cannot save HTML.`, err);
    await addTelemetryLog("Background Engine", "Local HTML Saver Warning", `Local server unreachable. Make sure scripts/server.js is running to save HTML files directly.`);
    return { status: "error", message: err.message };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SOLVE_FORM") {
    sendResponse({ status: "started" });
    handleSolveForm(request.blocks || request.questions, request.tempInstruction, request.tabId)
      .catch((err) => {
        console.error("Async handleSolveForm error:", err);
      });
    return false;
  } else if (request.action === "ADD_LOG") {
    addTelemetryLog(request.source, request.category, request.message)
      .then(() => sendResponse({ status: "success" }))
      .catch((err) => sendResponse({ status: "error", message: err.message }));
    return true;
  } else if (request.action === "SAVE_HTML_LOCAL") {
    saveHtmlToLocalServer(request.filename, request.html)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ status: "error", message: err.message }));
    return true;
  }
});

// ─── Experiment-Derived Constants (run npm run experiment to re-calibrate) ───
// Groq free-tier: 6000 TPM. Each block costs ~147 tokens (107 prompt + 40 completion).
// System prompt overhead: ~297 tokens. Safe capacity: 6000 * 0.88 = 5280 tokens.
// Max blocks in one request: (5280 - 297) / 147 ≈ 34. We use 20 as conservative safe value.
// Burst test: 4 back-to-back requests (705 tok each) = 2820 tok hit the sliding window limit.
// Solution: use large batches (fewer requests) rather than many small ones.
// Real latency: 690ms–2111ms. Minimum working cooldown: 5000ms (3000ms failed in experiment).
// 5s cooldown between 20-block batches = ~114 blocks/min vs old 4 blocks / 12s = 18 blocks/min.
const BATCH_SIZE     = 20;   // Was 4. Experiment shows 20 blocks = ~2750 tokens, safely under 6000 TPM.
const BATCH_COOLDOWN = 10000; // Was 12000. 10s is safe buffer above the 5s minimum from experiment.
const GROQ_TPM_SAFE  = 5000; // 83% of 6000. Skip Groq for full payload only above this threshold.
const MAX_SINGLE_RETRIES = 1; // Only retry empty answers once

// ─── Groq Multi-Model Pool ────────────────────────────────────────────────────
// Each model has its OWN independent 6000 TPM bucket on Groq.
// By rotating across models when one rate-limits, we multiply effective throughput.
// Priority order: fast → smart → reasoning → fallback
const GROQ_MODEL_POOL = [
  { id: "llama-3.1-8b-instant",     label: "Llama3.1-8B" },   // Fastest, ~700ms
  { id: "llama-3.3-70b-versatile",  label: "Llama3.3-70B" },  // Smarter, good for complex
  { id: "qwen-qwq-32b",             label: "Qwen-32B" },      // Strong reasoner
  { id: "gemma2-9b-it",             label: "Gemma2-9B" },     // Lightweight Google model
];

// Expand a user's provider list — each Groq entry becomes N entries (one per model).
// This makes the existing round-robin logic automatically rotate across model TPM buckets.
function expandProviders(providerKeys) {
  const expanded = [];
  for (const prov of providerKeys) {
    if (prov.vendor === "groq") {
      for (const m of GROQ_MODEL_POOL) {
        expanded.push({ ...prov, model: m.id, modelLabel: m.label });
      }
    } else if (prov.vendor === "openrouter") {
      expanded.push({ ...prov, model: "meta-llama/llama-3.3-70b-instruct:free", modelLabel: "Llama3.3-70B-Free" });
    } else if (prov.vendor === "nvidia") {
      expanded.push({ ...prov, model: "nvidia/nemotron-3-nano-30b-a3b", modelLabel: "Nemotron-3-Nano" });
    } else {
      expanded.push(prov);
    }
  }
  return expanded;
}

// Composite rate-limit key: apiKey:model — each model gets its own bucket.
function provId(prov) {
  return prov.model ? `${prov.key}:${prov.model}` : prov.key;
}

let rateLimitedProviders = {}; // keyed by provId()
let brokenProviders = {};      // keyed by prov.key (key-level: bad key = all models broken)

let isSolving = false;

function markProviderBroken(prov) {
  // Broken key = all models for that key are dead
  brokenProviders[prov.key] = true;
  debugWarn("Engine", `Key for ${prov.vendor.toUpperCase()} (${prov.modelLabel || prov.model || 'default'}) marked broken/expired — skipping all models for this key`);
}

function isProviderBroken(prov) {
  return !!brokenProviders[prov.key];
}

// ─── Status Updates and State Broadcasting ───────────────────────────────────
async function updateSolverStatus(stateClass, text, extra = {}) {
  const message = {
    action: "SOLVER_STATUS_UPDATE",
    stateClass,
    text,
    ...extra
  };
  
  await new Promise((resolve) => {
    chrome.storage.local.get(["solverState"], (data) => {
      const currentState = data.solverState || {};
      const newState = {
        ...currentState,
        active: stateClass !== "success" && stateClass !== "error",
        stateClass,
        text,
        ...extra
      };
      chrome.storage.local.set({ solverState: newState }, resolve);
    });
  });
  
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (e) {}
}

async function sleepWithCountdown(ms, statusTextPrefix) {
  let remaining = ms;
  while (remaining > 0) {
    const secs = Math.ceil(remaining / 1000);
    await updateSolverStatus("solving", `${statusTextPrefix} (${secs}s remaining)`);
    const step = Math.min(remaining, 1000);
    await new Promise(r => setTimeout(r, step));
    remaining -= step;
  }
}

function categorizeError(status, errorMsg) {
  const msg = (errorMsg || "").toLowerCase();
  
  // 1. Expired Key / Billing credit exhaustion (Check this BEFORE rate limits, as some 429s are permanent billing errors)
  if (status === 403 || status === 402 || status === 404 || msg.includes("expired") || msg.includes("revoked") || msg.includes("billing") || msg.includes("deactivated") || msg.includes("insufficient_quota") || msg.includes("check your plan and billing") || msg.includes("limit: 0") || msg.includes("credits")) {
    return "EXPIRED_KEY";
  }
  
  // 2. Rate Limit / Quota limits
  if (status === 429 || msg.includes("rate limit") || msg.includes("tpm") || msg.includes("rpm") || msg.includes("requests") || msg.includes("too many requests") || msg.includes("limit exceeded") || msg.includes("try again in")) {
    return "RATE_LIMIT";
  }
  
  // 3. Invalid Key
  if (status === 401 || (msg.includes("api key") && (msg.includes("invalid") || msg.includes("incorrect") || msg.includes("not found") || msg.includes("invalid_api_key")))) {
    return "INVALID_KEY";
  }
  
  return "OTHER_ERROR";
}

function parseError(err) {
  const errMsg = err.message || String(err);
  let status = 0;
  const match = errMsg.match(/HTTP (\d+)/);
  if (match) {
    status = parseInt(match[1]);
  }
  const category = categorizeError(status, errMsg);
  return { status, message: errMsg, category };
}

function checkAnswersSuccess(answers) {
  if (!answers || answers.length === 0) return { allEmpty: true, emptyCount: 0 };
  let emptyCount = 0;
  for (const ans of answers) {
    if (!ans || !ans.actions) {
      emptyCount++;
      continue;
    }
    const hasValue = ans.actions.some(act => act && act.value && act.value !== "" && act.value !== "none");
    if (!hasValue) {
      emptyCount++;
    }
  }
  return {
    allEmpty: emptyCount === answers.length,
    emptyCount: emptyCount,
    totalCount: answers.length
  };
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function debugLog(tag, msg, data = null) {
  const prefix = `%c[FormAI :: ${tag}]`;
  const style = "color: #7C5CFF; font-weight: bold;";
  if (data !== null) console.log(prefix, style, msg, data);
  else console.log(prefix, style, msg);
}

function debugWarn(tag, msg) {
  console.warn(`%c[FormAI :: ${tag}]`, "color: #EAB308; font-weight: bold;", msg);
}

function debugError(tag, msg, err = null) {
  console.error(`%c[FormAI :: ${tag}]`, "color: #EF4444; font-weight: bold;", msg, err || "");
}

function sleep(ms) {
  debugLog("Throttle", `Sleeping ${(ms / 1000).toFixed(1)}s...`);
  return new Promise(r => setTimeout(r, ms));
}

// ─── Extract retry-after time from error message ────────────────────────────
function extractWaitTime(errorMsg) {
  const match = errorMsg.match(/(?:try again in|retry in|Please retry in)\s*(\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  if (errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota")) return 15000;
  return 0;
}

// ─── Check if a provider+model is currently rate-limited ──────────────────────
function isProviderRateLimited(prov) {
  const id = provId(prov);
  const cooldownEnd = rateLimitedProviders[id];
  if (!cooldownEnd) return false;
  if (Date.now() > cooldownEnd) {
    delete rateLimitedProviders[id];
    return false;
  }
  const remaining = Math.ceil((cooldownEnd - Date.now()) / 1000);
  debugWarn("Throttle", `${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model || 'default'} rate-limited for ${remaining}s — rotating to next model`);
  return true;
}

// ─── Mark a provider+model as rate-limited ─────────────────────────────────────
function markRateLimited(prov, waitMs) {
  rateLimitedProviders[provId(prov)] = Date.now() + waitMs;
  debugWarn("Throttle", `${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model || 'default'} rate-limited for ${(waitMs / 1000).toFixed(1)}s — will try next model in pool`);
}

function isRateLimitError(msg) {
  const lower = msg.toLowerCase();
  return msg.includes("429") || lower.includes("rate limit") || lower.includes("rate_limit") || lower.includes("tpm") || lower.includes("rpm") || lower.includes("too many requests") || lower.includes("limit exceeded");
}

function isPayloadTooLarge(msg) {
  return msg.includes("413") || msg.includes("too large") || msg.includes("too long")
    || msg.includes("TPM") || msg.includes("tokens per minute") || msg.includes("reduce your message");
}

async function fetchWithTimeout(url, options, timeout = 30000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout after 30 seconds")), timeout)
    )
  ]);
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function extractJSON(text) {
  let cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try {
    const d = JSON.parse(cleaned);
    if (d.answers && Array.isArray(d.answers)) return d.answers;
    if (Array.isArray(d)) return d;
    return d;
  } catch(e) {}

  const matchObj = text.match(/\{[\s\S]*\}/);
  if (matchObj) {
    try {
      const parsed = JSON.parse(matchObj[0]);
      if (parsed.answers && Array.isArray(parsed.answers)) return parsed.answers;
      return parsed;
    } catch(e) {}
  }

  const matchArr = text.match(/\[[\s\S]*\]/);
  if (matchArr) {
    try { return JSON.parse(matchArr[0]); } catch(e) {}
  }

  throw new Error("Bad format. Raw: " + text.substring(0, 200));
}

function normalizePolymorphicAnswers(answers, originalBlocks) {
  const normalized = [];
  if (!originalBlocks || !Array.isArray(originalBlocks)) return normalized;
  
  for (const block of originalBlocks) {
    if (!block) continue;
    // Find if LLM provided answer for this block index
    let blockAns = null;
    if (Array.isArray(answers)) {
      blockAns = answers.find(a => a && a.blockIndex === block.blockIndex);
    } else if (answers && typeof answers === 'object') {
      if (answers.blockIndex === block.blockIndex) {
        blockAns = answers;
      }
    }

    if (!blockAns) {
      // Create empty default actions for this block
      const defaultActions = (block.components || []).map(comp => ({
        type: comp.type,
        value: comp.type === 'TEXT_INPUT' ? "none" : ""
      }));
      normalized.push({
        blockIndex: block.blockIndex,
        actions: defaultActions
      });
      continue;
    }

    // Ensure action array exists and matches component structure
    const actions = [];
    const rawActions = blockAns.actions || [];
    const components = block.components || [];
    
    for (let cIdx = 0; cIdx < components.length; cIdx++) {
      const comp = components[cIdx];
      const action = rawActions[cIdx];
      
      if (action && action.type === comp.type) {
        actions.push(action);
      } else {
        // Find by type in rawActions if mismatch by index
        const fallbackAction = rawActions.find(a => a && a.type === comp.type);
        if (fallbackAction) {
          actions.push(fallbackAction);
        } else {
          actions.push({
            type: comp.type,
            value: comp.type === 'TEXT_INPUT' ? "none" : ""
          });
        }
      }
    }

    normalized.push({
      blockIndex: block.blockIndex,
      actions: actions
    });
  }

  return normalized;
}

// ─── Retry ONLY if no provider is currently rate-limited ────────────────────
async function retryEmptyPolymorphicAnswers(answers, blocks, providerKeys, systemPrompt) {
  const emptyBlockIdxs = [];
  if (!answers || !blocks) return answers || [];

  for (let i = 0; i < answers.length; i++) {
    const blockAns = answers[i];
    const originalBlock = blocks[i];
    if (!blockAns || !originalBlock || !blockAns.actions) continue;
    
    // Check if any action value is missing, empty, or fallback "none"
    const hasEmpty = blockAns.actions.some(action => 
      !action ||
      !action.value || 
      String(action.value).trim() === "" || 
      String(action.value).trim() === "none"
    );
    
    if (hasEmpty) {
      emptyBlockIdxs.push(i);
    }
  }
  
  if (emptyBlockIdxs.length === 0) return answers;

  // Check if ALL providers are rate-limited or broken → don't even try
  const availableProviders = providerKeys.filter(p => !isProviderRateLimited(p) && !isProviderBroken(p));
  if (availableProviders.length === 0) {
    debugWarn("Retry", `All keys rate-limited. Skipping ${emptyBlockIdxs.length} retries to avoid retry storm.`);
    await writeLog("Retry Skips", `All providers rate-limited. Skipping recovery retries for ${emptyBlockIdxs.length} block(s).`);
    return answers;
  }

  debugLog("Retry", `${emptyBlockIdxs.length} empty or partial block answer(s). Retrying with ${availableProviders.length} available provider(s)...`);
  await writeLog("Retry Action", `Found ${emptyBlockIdxs.length} empty/partial answers. Initiating individual recovery retries using ${availableProviders.length} available provider(s).`);

  let retryCount = 0;
  for (const idx of emptyBlockIdxs) {
    if (retryCount >= MAX_SINGLE_RETRIES * emptyBlockIdxs.length) {
      debugWarn("Retry", "Max retry budget exhausted. Stopping.");
      await writeLog("Retry Warning", "Retry budget exhausted. Stopping recoveries.");
      break;
    }

    // Re-check availability before each retry
    const stillAvailable = providerKeys.filter(p => !isProviderRateLimited(p) && !isProviderBroken(p));
    if (stillAvailable.length === 0) {
      debugWarn("Retry", "All keys now rate-limited. Stopping retries.");
      await writeLog("Retry Warning", "All keys now rate-limited. Stopping recoveries.");
      break;
    }

    try {
      await writeLog("Retry Action", `Attempting single recovery solve for block index ${blocks[idx].blockIndex}`);
      const retriedBlockAns = await solveSingleBlock(blocks[idx], stillAvailable, systemPrompt);
      if (retriedBlockAns && retriedBlockAns.actions) {
        answers[idx] = retriedBlockAns;
        await writeLog("Retry Action", `✅ Recovery successful for block index ${blocks[idx].blockIndex}`);
        debugLog("Retry", `✅ Block ${blocks[idx].blockIndex} recovered.`);
      } else {
        await writeLog("Retry Action", `❌ Recovery yielded no actions for block index ${blocks[idx].blockIndex}`);
      }
    } catch (e) {
      await writeLog("Retry Action", `❌ Recovery failed for block index ${blocks[idx].blockIndex}: ${e.message}`);
      debugWarn("Retry", `Block ${blocks[idx].blockIndex} failed: ${e.message}`);
    }
    retryCount++;
  }

  return answers;
}

async function solveSingleBlock(block, allProviders, systemPrompt) {
  const singlePrompt = JSON.stringify([block], null, 2);

  for (const prov of allProviders) {
    if (isProviderBroken(prov)) continue;
    if (isProviderRateLimited(prov)) continue;

    try {
      const raw = await executeProvider(prov, systemPrompt, singlePrompt);
      const parsed = extractJSON(raw);
      
      const arr = Array.isArray(parsed) ? parsed : (parsed.answers || [parsed]);
      const normalized = normalizePolymorphicAnswers(arr, [block]);
      return normalized[0];
    } catch (e) {
      const parsedErr = parseError(e);
      if (parsedErr.category === "INVALID_KEY" || parsedErr.category === "EXPIRED_KEY") {
        markProviderBroken(prov);
      } else if (isRateLimitError(e.message)) {
        markRateLimited(prov, extractWaitTime(e.message) || 15000);
      }
    }
  }
  return null;
}

// ─── MAIN ORCHESTRATOR ──────────────────────────────────────────────────────
async function handleSolveForm(blocks, tempInstruction, tabId) {
  if (isSolving) {
    await writeLog("Warning", "Solver already running. Ignoring request.");
    return;
  }
  isSolving = true;
  brokenProviders = {};       // Reset per-run: fresh key health check every solve
  rateLimitedProviders = {};  // Reset per-run: don't carry stale rate-limit timers from previous runs
  const solveStartTimeMs = Date.now();
  const solveStartTimeIso = new Date().toISOString();

  try {
    await updateSolverStatus("solving", "Initializing...", { blocksCount: blocks?.length || 0 });
    await writeLog("Solver Initiation", `Solver started for ${blocks?.length || 0} blocks.`);
    if (!blocks || !Array.isArray(blocks)) {
      await writeLog("Error", "Invalid or missing blocks structure provided to background.");
      await updateSolverStatus("error", "Invalid/missing blocks structure. Reload the page.");
      isSolving = false;
      return;
    }

    const systemPrompt = `You are an expert Google Form solving agent.
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
     - For MULTIPLE_CHOICE: the exact option text that matches the correct answer.
     - For CHECKBOXES: comma-separated list of exact option text matches.
     - For DROPDOWN: the exact option text to select.
     - For TEXT_INPUT: a well-crafted, short response/explanation.
5. For any fields asking about the user's identity, background, or current context (such as Name, Email, College, School, University, Department, Branch, Year, Class, Roll Number, Phone Number, Date of Birth, Gender, etc.):
   - You MUST extract information from the USER PROFILE and match it.
   - For DROPDOWN and MULTIPLE_CHOICE: select the option from the "options" list that has the closest semantic or textual match to the user's profile details.
   - Do NOT invent values or guess randomly. If the user's profile says "studies CS-E" and the options are ["CS-A", "CS-B", "CS-C", "CS-D", "CS-E"], you must output "CS-E". If the user's profile says "Third Year" and the options are ["1st Year", "2nd Year", "3rd Year"], select "3rd Year" (or "III Year" if that is the closest semantic match).
   - If options are provided, you MUST return one of the exact strings from that option list as your choice.

Example Input:
[
  {
    "blockIndex": 0,
    "promptText": "What is 2+2? Explain why.",
    "components": [
      { "type": "MULTIPLE_CHOICE", "options": ["3", "4", "5"] },
      { "type": "TEXT_INPUT", "placeholder": "Explain" }
    ]
  }
]

Example Output:
{
  "answers": [
    {
      "blockIndex": 0,
      "actions": [
        { "type": "MULTIPLE_CHOICE", "value": "4" },
        { "type": "TEXT_INPUT", "value": "Because adding two units to two units yields four units." }
      ]
    }
  ]
}`;

    const { providerKeys: rawProviderKeys, userProfile, missingContextHandling } = await chrome.storage.local.get(["providerKeys", "userProfile", "missingContextHandling"]);

    // Expand Groq into multi-model pool — each model = separate TPM bucket
    const providerKeys = expandProviders(rawProviderKeys || []);
    const groqModelCount = providerKeys.filter(p => p.vendor === 'groq').length;

    await writeLog("Config Loaded", `Loaded ${rawProviderKeys?.length || 0} configured providers → expanded to ${providerKeys.length} virtual providers (${groqModelCount} Groq models × ${GROQ_MODEL_POOL.length} pool). User Profile: ${userProfile ? userProfile.trim().length : 0} chars.`);
    debugLog("Engine", `Expanded providers:`, providerKeys.map(p => `${p.vendor}/${p.modelLabel || p.model || 'default'}`));

    if (!rawProviderKeys || rawProviderKeys.length === 0) {
      await writeLog("Error", "No LLM providers configured. Solve halted.");
      await updateSolverStatus("error", "No LLM providers configured. Please add an API key in settings.");
      isSolving = false;
      return;
    }

    let profileContext = "";
    if (userProfile && userProfile.trim()) {
      profileContext = `\n\nUSER PROFILE:\n${userProfile}\n`;
    }

    let tempContext = "";
    if (tempInstruction && tempInstruction.trim()) {
      tempContext = `\n\nTEMPORARY INSTRUCTIONS FOR THIS FORM ONLY:\n${tempInstruction}\n`;
      await writeLog("Orchestrator Action", "Appended temporary prompt/context instructions to the system instructions.");
    }

    let missingContextInstructions = "";
    const contextMode = missingContextHandling || "print_not_provided";
    if (contextMode === "print_not_provided") {
        missingContextInstructions = `\n6. IMPORTANT - MISSING CONTEXT: If a question asks for personal information (like a link, specific ID, personal experience, etc.) and it is NOT explicitly provided in the USER PROFILE or TEMPORARY INSTRUCTIONS, you MUST output the exact string "Not Provided" for TEXT_INPUT fields. Do NOT invent a fake response.\n`;
    } else if (contextMode === "blank") {
        missingContextInstructions = `\n6. IMPORTANT - MISSING CONTEXT: If a question asks for personal information (like a link, specific ID, personal experience, etc.) and it is NOT explicitly provided in the USER PROFILE or TEMPORARY INSTRUCTIONS, you MUST output an empty string "" for TEXT_INPUT fields. Do NOT invent a fake response.\n`;
    } else if (contextMode === "ai_generated") {
        missingContextInstructions = `\n6. IMPORTANT - MISSING CONTEXT: If a question asks for personal information and it is NOT explicitly provided in the USER PROFILE or TEMPORARY INSTRUCTIONS, you are authorized to invent a plausible, professional, and generic AI-generated response that fulfills the requirements of the TEXT_INPUT field.\n`;
    }

    const finalSystemPrompt = systemPrompt + missingContextInstructions + profileContext + tempContext;
    const fullPrompt = JSON.stringify(blocks, null, 2);

    const totalTokens = estimateTokens(finalSystemPrompt) + estimateTokens(fullPrompt);

    await writeLog("Strategy Decision", `Total estimated prompt tokens: ${totalTokens}. Checking provider restrictions...`);
    debugLog("Engine", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    debugLog("Engine", `Blocks: ${blocks.length} | Est. tokens: ${totalTokens}`);
    debugLog("Engine", `Groq limit: 6000 TPM | ${totalTokens > 5000 ? "⚠️ ABOVE safe threshold → batching for Groq" : "✅ Within limit"}`);
    debugLog("Engine", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // ─── STRATEGY 1: Full payload (skip Groq if too large) ───────────────────
    await writeLog("Strategy Execution", "Attempting Strategy 1: Full payload submission.");
    debugLog("Engine", "STRATEGY 1: Full payload...");

    let strategy1Answers = null;
    let providerUsed = null;

    for (const prov of providerKeys) {
      if (isProviderBroken(prov)) {
        await writeLog("API Skips", `Skipping broken/expired vendor: ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model}`);
        continue;
      }
      if (isProviderRateLimited(prov)) {
        await writeLog("API Skips", `Skipping rate-limited vendor: ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model}`);
        continue;
      }

      // Skip Groq for full payload only if estimated tokens clearly exceed safe threshold
      if (prov.vendor === "groq" && totalTokens > GROQ_TPM_SAFE) {
        await writeLog("API Skips", `Skipping Groq full payload (est. tokens ${totalTokens} > ${GROQ_TPM_SAFE} TPM safety threshold). Will fall through to batching.`);
        debugWarn("Full Shot", `Groq skipped — payload ${totalTokens} tok > ${GROQ_TPM_SAFE} threshold`);
        continue;
      }

      await writeLog("API Request", `Sending full payload to ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model}`);
      debugLog("Full Shot", `→ ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model}`);
      await updateSolverStatus("solving", `Solving via ${prov.modelLabel || prov.vendor.toUpperCase()}...`);

      try {
        const raw = await executeProvider(prov, finalSystemPrompt, fullPrompt);
        const rawStr = raw || "";
        debugLog("Full Shot", `Response length: ${rawStr.length} chars`);
        await writeLog("API Response", `Success from ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model}. Received ${rawStr.length} chars.`);

        const answers = extractJSON(rawStr);
        await writeLog("JSON Parsing", `Parsed JSON answers for ${answers?.length || 0} blocks.`);
        const normalized = normalizePolymorphicAnswers(answers, blocks);
        
        await writeLog("Retry Check", "Checking if any answers are empty/partial and require individual retries...");
        strategy1Answers = await retryEmptyPolymorphicAnswers(normalized, blocks, providerKeys, finalSystemPrompt);
        providerUsed = `${prov.vendor}/${prov.modelLabel || prov.model}`;
        break;

      } catch (e) {
        await writeLog("API Failure", `Full payload failed for ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model}: ${e.message}`);
        debugError("Full Shot", `${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model} failed:`, e.message);

        const parsedErr = parseError(e);
        if (parsedErr.category === "INVALID_KEY" || parsedErr.category === "EXPIRED_KEY") {
          markProviderBroken(prov);
          await updateSolverStatus("solving", `${prov.modelLabel || prov.vendor} key invalid/expired. Trying next model...`);
        }

        if (isRateLimitError(e.message)) {
          const wait = extractWaitTime(e.message) || 15000;
          await writeLog("Rate Limit", `${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model} rate-limited for ${wait / 1000}s. Rotating to next model...`);
          markRateLimited(prov, wait);
          await updateSolverStatus("solving", `${prov.modelLabel || prov.model} throttled — trying next Groq model...`);
          continue; // instantly try next model, no sleep!
        }
        if (isPayloadTooLarge(e.message)) continue;
      }
    }

    if (strategy1Answers) {
      await writeLog("Solver Completion", `Strategy 1 Successful. Outputting action mappings for ${strategy1Answers.length} blocks.`);
      debugLog("Full Shot", `✅ SUCCESS via ${providerUsed.toUpperCase()}`);
      
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { 
            action: "FILL_ANSWERS", 
            answers: strategy1Answers
        }, async (fillResponse) => {
            const check = checkAnswersSuccess(strategy1Answers);
            let statusMsg = "";
            let statusClass = "success";
            let warning = null;
            
            if (check.allEmpty) {
              statusMsg = "All APIs permanently exhausted/invalid. Left empty cells to manually fill.";
              statusClass = "error";
              warning = "ALL_EXHAUSTED";
            } else if (check.emptyCount > 0) {
              statusMsg = `Filled ${check.totalCount - check.emptyCount}/${check.totalCount} blocks. Remaining left to fill manually.`;
              statusClass = "success";
              warning = "PARTIAL_EXHAUSTED";
            } else {
              statusMsg = "Form Completed";
              statusClass = "success";
            }
            
            if (fillResponse?.status === "success") {
              await writeLog("Completion", `Injected answers into tab successfully. Warning: ${warning || "None"}`);
              await updateSolverStatus(statusClass, statusMsg, { providerUsed, warning, answers: strategy1Answers, active: false });
            } else {
              await writeLog("Error", `Failed to apply answers to the form: ${fillResponse?.message || "No response"}`);
              await updateSolverStatus("error", "Failed to apply answers to the form.", { active: false });
            }
            isSolving = false;
        });
      } else {
        isSolving = false;
      }
      return;
    }

    // ─── STRATEGY 2: Batched with smart cooldowns ────────────────────────────
    await writeLog("Strategy Execution", `Strategy 1 failed or skipped. Attempting Strategy 2: Batch Mode (${BATCH_SIZE} blocks/batch, ${BATCH_COOLDOWN / 1000}s cooldown).`);
    debugLog("Engine", `STRATEGY 2: Batch mode (${BATCH_SIZE} blocks/batch, ${BATCH_COOLDOWN / 1000}s cooldown)...`);

    const batches = chunkArray(blocks, BATCH_SIZE);
    await writeLog("Batch Decision", `Split ${blocks.length} blocks into ${batches.length} batches.`);
    debugLog("Batch", `${blocks.length} blocks → ${batches.length} batches`);

    let allAnswers = [];
    let countFailedBatches = 0;

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];
      const batchPrompt = JSON.stringify(batch, null, 2);

      const batchTokens = estimateTokens(finalSystemPrompt) + estimateTokens(batchPrompt);
      await writeLog("Batch Execution", `Processing batch ${bIdx + 1}/${batches.length} (${batch.length} blocks, ~${batchTokens} tokens).`);
      debugLog(`Batch ${bIdx + 1}/${batches.length}`, `${batch.length} blocks | ~${batchTokens} tokens`);

      let batchAnswers = null;
      let attempt = 0;
      const MAX_BATCH_ATTEMPTS = 15;

      while (attempt < MAX_BATCH_ATTEMPTS && !batchAnswers) {
        attempt++;
        
        // Check if ALL models are rate-limited — if so, wait for shortest recovery
        const activeKeys = providerKeys.filter(p => {
          const id = provId(p);
          const cooldownEnd = rateLimitedProviders[id];
          return (!cooldownEnd || Date.now() > cooldownEnd) && !isProviderBroken(p);
        });
        
        if (activeKeys.length === 0) {
          const nonBrokenKeys = providerKeys.filter(p => !isProviderBroken(p));
          if (nonBrokenKeys.length > 0) {
            let shortestWait = Infinity;
            let shortestId = null;
            for (const p of nonBrokenKeys) {
              const id = provId(p);
              const limitTime = rateLimitedProviders[id];
              if (limitTime) {
                const remaining = limitTime - Date.now();
                if (remaining < shortestWait) {
                  shortestWait = remaining;
                  shortestId = id;
                }
              }
            }
            
            if (shortestId && shortestWait > 0 && shortestWait !== Infinity) {
              const waitSecs = (shortestWait / 1000).toFixed(1);
              await writeLog("Rate Limit Wait", `All keys are currently rate-limited. Waiting ${waitSecs}s for the shortest cooldown to expire...`);
              debugWarn("Batch Orchestrator", `All keys rate-limited. Waiting ${waitSecs}s...`);
              await sleepWithCountdown(shortestWait + 1000, "All APIs on cooldown. Waiting for slot");
              delete rateLimitedProviders[shortestId];
            }
          }
        }

        for (const prov of providerKeys) {
          if (isProviderBroken(prov)) {
            await writeLog("API Skips", `Skipping broken/expired ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model} in batch ${bIdx + 1}`);
            continue;
          }
          if (isProviderRateLimited(prov)) {
            await writeLog("API Skips", `Skipping rate-limited ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model} for batch ${bIdx + 1}`);
            continue;
          }

          await writeLog("API Request", `Batch ${bIdx + 1} (attempt ${attempt}/${MAX_BATCH_ATTEMPTS}) → ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model}`);
          await updateSolverStatus("solving", `Solving batch ${bIdx + 1}/${batches.length} via ${prov.modelLabel || prov.vendor.toUpperCase()}...`);
          try {
            const raw = await executeProvider(prov, finalSystemPrompt, batchPrompt);
            const rawStr = raw || "";
            await writeLog("API Response", `Success from ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model} for batch ${bIdx + 1}. Received ${rawStr.length} chars.`);
            const parsed = extractJSON(rawStr);

            const parsedArr = Array.isArray(parsed) ? parsed : (parsed.answers || [parsed]);
            batchAnswers = normalizePolymorphicAnswers(parsedArr, batch);
            providerUsed = `${prov.vendor}/${prov.modelLabel || prov.model}`;
            debugLog(`Batch ${bIdx + 1}`, `✅ ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model} on attempt ${attempt}`);
            break;

          } catch (e) {
            await writeLog("API Failure", `Batch ${bIdx + 1} attempt ${attempt} failed for ${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model}: ${e.message}`);
            debugError(`Batch ${bIdx + 1}`, `${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model}: ${e.message}`);
            
            const parsedErr = parseError(e);
            if (parsedErr.category === "INVALID_KEY" || parsedErr.category === "EXPIRED_KEY") {
              markProviderBroken(prov);
              await updateSolverStatus("solving", `${prov.modelLabel || prov.vendor} key invalid/expired. Trying next model...`);
            }

            if (isRateLimitError(e.message)) {
              const wait = extractWaitTime(e.message) || 15000;
              await writeLog("Rate Limit", `${prov.vendor.toUpperCase()}/${prov.modelLabel || prov.model} rate-limited ${wait / 1000}s. Trying next model...`);
              markRateLimited(prov, wait);
              await updateSolverStatus("solving", `${prov.modelLabel || prov.model} throttled — rotating...`);
            }
          }
        }
      }

      if (!batchAnswers) {
        countFailedBatches++;
        await writeLog("Batch Failure", `Batch ${bIdx + 1} failed to solve with all providers. Padding with default empty answers.`);
        debugWarn("Engine", `Batch ${bIdx + 1} failed — padding with default empty structures`);
        batchAnswers = normalizePolymorphicAnswers([], batch);
      }

      allAnswers = allAnswers.concat(batchAnswers);
      await writeLog("Progress Update", `Batch ${bIdx + 1} merged. Total progress: ${allAnswers.length}/${blocks.length} blocks.`);
      debugLog("Engine", `Progress: ${allAnswers.length}/${blocks.length} blocks answered`);

      // Smart cooldown between batches
      if (bIdx < batches.length - 1) {
        await writeLog("Batch Cooldown", `Sleeping for ${BATCH_COOLDOWN / 1000}s before next batch to prevent rate limits...`);
        await sleepWithCountdown(BATCH_COOLDOWN, "Batch finished. Cooldown");
      }
    }

    // Final retry pass for empty answers
    await writeLog("Retry Check", "Doing final retry check for any empty/partial answers across all batches...");
    await updateSolverStatus("solving", "Doing final checks...");
    allAnswers = await retryEmptyPolymorphicAnswers(allAnswers, blocks, providerKeys, finalSystemPrompt);

    await writeLog("Solver Completion", `Solve operation finished. Total blocks: ${allAnswers.length}.`);
    debugLog("Engine", `✅ ALL DONE. ${allAnswers.length} block answers`, allAnswers);

    // Direct inject answers
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { 
          action: "FILL_ANSWERS", 
          answers: allAnswers
      }, async (fillResponse) => {
          const check = checkAnswersSuccess(allAnswers);
          let statusMsg = "";
          let statusClass = "success";
          let warning = null;
          
          if (check.allEmpty) {
            statusMsg = "All APIs permanently exhausted/invalid. Left empty cells to manually fill.";
            statusClass = "error";
            warning = "ALL_EXHAUSTED";
          } else if (check.emptyCount > 0) {
            statusMsg = `Filled ${check.totalCount - check.emptyCount}/${check.totalCount} blocks. Remaining left to fill manually.`;
            statusClass = "success";
            warning = "PARTIAL_EXHAUSTED";
          } else {
            statusMsg = "Form Completed";
            statusClass = "success";
          }
          
          if (fillResponse?.status === "success") {
            await writeLog("Completion", `Injected answers into tab successfully. Warning: ${warning || "None"}`);
            await updateSolverStatus(statusClass, statusMsg, { providerUsed, warning, answers: allAnswers, active: false });
          } else {
            await writeLog("Error", `Failed to apply answers to the form: ${fillResponse?.message || "No response"}`);
            await updateSolverStatus("error", "Failed to apply answers to the form.", { active: false });
          }

          // --- Telemetry Logging ---
          await logTelemetryToDB(solveStartTimeIso, solveStartTimeMs, check.totalCount, check.totalCount - check.emptyCount, warning || (fillResponse?.status === "success" ? null : "Failed to apply answers"));

          isSolving = false;
      });
    } else {
      isSolving = false;
    }

  } catch (error) {
    await writeLog("Fatal Error", `Uncaught exception in background: ${error.message}`);
    debugError("Engine", "FATAL:", error);
    await updateSolverStatus("error", `Fatal Error: ${error.message}`, { active: false });
    
    // --- Telemetry Logging (Error Path) ---
    await logTelemetryToDB(solveStartTimeIso, solveStartTimeMs, 0, 0, `Fatal Error: ${error.message}`);
    
    isSolving = false;
  }
}

async function logTelemetryToDB(startIso, startMs, totalFields, filledFields, errorMsg) {
  try {
    const { formAI_user_id } = await chrome.storage.local.get(["formAI_user_id"]);
    if (!formAI_user_id) return; // Silent skip if no user ID

    await fetch("https://form-automation-eight.vercel.app/api/log_usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: formAI_user_id,
        start_time: startIso,
        end_time: new Date().toISOString(),
        duration_ms: Date.now() - startMs,
        total_fields: totalFields,
        filled_fields: filledFields,
        error_message: errorMsg
      })
    });
  } catch (e) {
    console.error("Telemetry failed:", e);
  }
}

async function executeProvider(prov, sysPrompt, usrPrompt) {
  const { vendor, key, model } = prov;
  if (vendor === "groq" || vendor === "openrouter" || vendor === "nvidia") return callOpenAILike(vendor, key, sysPrompt, usrPrompt, model);
  throw new Error(`Unknown vendor: ${vendor}`);
}

async function callOpenAILike(vendor, apiKey, sysPrompt, usrPrompt, modelOverride = null) {
  let url = "";
  let defaultModel = "";
  const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };

  if (vendor === "groq") {
    url = "https://api.groq.com/openai/v1/chat/completions";
    defaultModel = "llama-3.1-8b-instant";
  } else if (vendor === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    defaultModel = "anthropic/claude-3.5-sonnet";
    headers["HTTP-Referer"] = "https://formai-extension.com"; // Optional, for rankings
    headers["X-Title"] = "FormAI Extension"; // Optional, for rankings
  } else if (vendor === "nvidia") {
    url = "https://integrate.api.nvidia.com/v1/chat/completions";
    defaultModel = "meta/llama-3.3-70b-instruct";
  }

  const model = modelOverride || defaultModel;

  debugLog(vendor.toUpperCase(), `${model} | ~${estimateTokens(usrPrompt)} prompt tokens`);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: usrPrompt }
      ],
      temperature: 0.1,
      max_tokens: 4096  // Raised from 3000 — experiment shows 15 blocks needs 611 completion tokens
    })
  });

  debugLog(vendor.toUpperCase(), `HTTP ${response.status}`);

  if (!response.ok) {
    let hint = response.statusText;
    try { const b = await response.json(); if (b.error?.message) hint = b.error.message; } catch(e) {}
    throw new Error(`HTTP ${response.status}: ${hint}`);
  }

  const data = await response.json();
  const usage = data.usage;
  debugLog(vendor.toUpperCase(), `Tokens: prompt=${usage?.prompt_tokens}, completion=${usage?.completion_tokens}, total=${usage?.total_tokens}`);
  return data.choices?.[0]?.message?.content || "";
}
