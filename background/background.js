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

const BATCH_SIZE = 4; // Small batches to stay within Groq's 6000 TPM
const BATCH_COOLDOWN = 12000; // 12 seconds between batches
const MAX_SINGLE_RETRIES = 1; // Only retry empty answers once
let rateLimitedProviders = {}; // Track which providers are rate-limited and when they're free
let brokenProviders = {}; // Track providers that threw permanent EXPIRED_KEY or INVALID_KEY errors during the current run

let isSolving = false;

function markProviderBroken(apiKey, vendor) {
  brokenProviders[apiKey] = true;
  debugWarn("Engine", `Key for ${vendor.toUpperCase()} marked as broken/expired — skipping in future requests`);
}

function isProviderBroken(apiKey) {
  return !!brokenProviders[apiKey];
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
  
  // 1. Rate Limit / Quota check first
  if (status === 429 || msg.includes("rate limit") || msg.includes("tpm") || msg.includes("rpm") || msg.includes("requests") || msg.includes("too many requests") || msg.includes("limit exceeded") || msg.includes("try again in")) {
    return "RATE_LIMIT";
  }
  
  // 2. Invalid Key
  if (status === 401 || (msg.includes("api key") && (msg.includes("invalid") || msg.includes("incorrect") || msg.includes("not found") || msg.includes("invalid_api_key")))) {
    return "INVALID_KEY";
  }
  
  // 3. Expired Key / Billing credit exhaustion
  if (status === 403 || msg.includes("expired") || msg.includes("revoked") || msg.includes("billing") || msg.includes("deactivated") || msg.includes("insufficient_quota") || msg.includes("check your plan and billing")) {
    return "EXPIRED_KEY";
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

// ─── Check if a provider key is currently rate-limited ───────────────────────
function isProviderRateLimited(apiKey, vendor) {
  const cooldownEnd = rateLimitedProviders[apiKey];
  if (!cooldownEnd) return false;
  if (Date.now() > cooldownEnd) {
    delete rateLimitedProviders[apiKey];
    return false;
  }
  const remaining = Math.ceil((cooldownEnd - Date.now()) / 1000);
  debugWarn("Throttle", `${vendor.toUpperCase()} key (...${apiKey.slice(-4)}) rate-limited for ${remaining}s — skipping`);
  return true;
}

// ─── Mark a provider key as rate-limited ─────────────────────────────────────
function markRateLimited(apiKey, vendor, waitMs) {
  rateLimitedProviders[apiKey] = Date.now() + waitMs;
  debugWarn("Throttle", `${vendor.toUpperCase()} key (...${apiKey.slice(-4)}) rate-limited for ${(waitMs / 1000).toFixed(1)}s`);
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
  const availableProviders = providerKeys.filter(p => !isProviderRateLimited(p.key, p.vendor) && !isProviderBroken(p.key));
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
    const stillAvailable = providerKeys.filter(p => !isProviderRateLimited(p.key, p.vendor));
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

async function solveSingleBlock(block, providerKeys, systemPrompt) {
  const singlePrompt = JSON.stringify([block], null, 2);

  for (const prov of providerKeys) {
    if (isProviderBroken(prov.key)) continue;
    if (isProviderRateLimited(prov.key, prov.vendor)) continue;

    try {
      const raw = await executeProvider(prov.vendor, prov.key, systemPrompt, singlePrompt);
      const parsed = extractJSON(raw);
      
      const arr = Array.isArray(parsed) ? parsed : (parsed.answers || [parsed]);
      const normalized = normalizePolymorphicAnswers(arr, [block]);
      return normalized[0];
    } catch (e) {
      const parsedErr = parseError(e);
      if (parsedErr.category === "INVALID_KEY" || parsedErr.category === "EXPIRED_KEY") {
        markProviderBroken(prov.key, prov.vendor);
      } else if (isRateLimitError(e.message)) {
        markRateLimited(prov.key, prov.vendor, extractWaitTime(e.message) || 15000);
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
  brokenProviders = {}; // Reset broken providers list for this new run

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

    const { providerKeys, userProfile } = await chrome.storage.local.get(["providerKeys", "userProfile"]);

    await writeLog("Config Loaded", `Loaded ${providerKeys?.length || 0} providers. User Profile context size: ${userProfile ? userProfile.trim().length : 0} chars.`);
    debugLog("Engine", `Loaded ${providerKeys?.length || 0} provider(s)`);
    debugLog("Engine", "Priority:", providerKeys?.map(p => p.vendor));

    if (!providerKeys || providerKeys.length === 0) {
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

    const finalSystemPrompt = systemPrompt + profileContext + tempContext;
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
      if (isProviderBroken(prov.key)) {
        await writeLog("API Skips", `Skipping broken/expired vendor: ${prov.vendor.toUpperCase()}`);
        continue;
      }
      if (isProviderRateLimited(prov.key, prov.vendor)) {
        await writeLog("API Skips", `Skipping rate-limited vendor: ${prov.vendor.toUpperCase()}`);
        continue;
      }

      // Skip Groq for full payload if we know it's too large
      if (prov.vendor === "groq" && totalTokens > 5000) {
        await writeLog("API Skips", `Skipping Groq full payload (est. tokens ${totalTokens} > 5000 TPM safety threshold)`);
        debugWarn("Full Shot", "Groq skipped — payload would exceed TPM limit");
        continue;
      }

      await writeLog("API Request", `Sending full payload to ${prov.vendor.toUpperCase()}`);
      debugLog("Full Shot", `→ ${prov.vendor.toUpperCase()}`);
      await updateSolverStatus("solving", `Solving all fields via ${prov.vendor.toUpperCase()}...`);

      try {
        const raw = await executeProvider(prov.vendor, prov.key, finalSystemPrompt, fullPrompt);
        const rawStr = raw || "";
        debugLog("Full Shot", `Response length: ${rawStr.length} chars`);
        await writeLog("API Response", `Success from ${prov.vendor.toUpperCase()}. Received ${rawStr.length} chars.`);

        const answers = extractJSON(rawStr);
        await writeLog("JSON Parsing", `Parsed JSON answers for ${answers?.length || 0} blocks.`);
        const normalized = normalizePolymorphicAnswers(answers, blocks);
        
        await writeLog("Retry Check", "Checking if any answers are empty/partial and require individual retries...");
        strategy1Answers = await retryEmptyPolymorphicAnswers(normalized, blocks, providerKeys, finalSystemPrompt);
        providerUsed = prov.vendor;
        break;

      } catch (e) {
        await writeLog("API Failure", `Full payload failed for ${prov.vendor.toUpperCase()}: ${e.message}`);
        debugError("Full Shot", `${prov.vendor.toUpperCase()} failed:`, e.message);

        const parsedErr = parseError(e);
        if (parsedErr.category === "INVALID_KEY" || parsedErr.category === "EXPIRED_KEY") {
          markProviderBroken(prov.key, prov.vendor);
          await updateSolverStatus("solving", `${prov.vendor.toUpperCase()} key ${parsedErr.category === "INVALID_KEY" ? "invalid" : "expired"}. Switching provider...`);
        }

        if (isRateLimitError(e.message)) {
          const wait = extractWaitTime(e.message) || 15000;
          await writeLog("Rate Limit", `Marked ${prov.vendor.toUpperCase()} rate-limited for ${wait / 1000} seconds.`);
          markRateLimited(prov.key, prov.vendor, wait);
          continue;
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
      const MAX_BATCH_ATTEMPTS = 2;

      while (attempt < MAX_BATCH_ATTEMPTS && !batchAnswers) {
        attempt++;
        
        // If ALL configured keys are currently rate-limited or broken, wait for the shortest remaining cooldown
        const now = Date.now();
        const activeKeys = providerKeys.filter(p => {
          const cooldownEnd = rateLimitedProviders[p.key];
          return (!cooldownEnd || now > cooldownEnd) && !isProviderBroken(p.key);
        });
        
        if (activeKeys.length === 0) {
          const nonBrokenKeys = providerKeys.filter(p => !isProviderBroken(p.key));
          if (nonBrokenKeys.length > 0) {
            let shortestWait = Infinity;
            let shortestKey = null;
            for (const prov of nonBrokenKeys) {
              const limitTime = rateLimitedProviders[prov.key];
              if (limitTime) {
                const remaining = limitTime - now;
                if (remaining < shortestWait) {
                  shortestWait = remaining;
                  shortestKey = prov.key;
                }
              }
            }
            
            if (shortestKey && shortestWait > 0 && shortestWait !== Infinity) {
              const waitSecs = (shortestWait / 1000).toFixed(1);
              await writeLog("Rate Limit Wait", `All keys are currently rate-limited. Waiting ${waitSecs}s for the shortest cooldown to expire...`);
              debugWarn("Batch Orchestrator", `All keys rate-limited. Waiting ${waitSecs}s...`);
              await sleepWithCountdown(shortestWait + 1000, "All APIs on cooldown. Waiting for slot");
              delete rateLimitedProviders[shortestKey];
            }
          }
        }

        for (const prov of providerKeys) {
          if (isProviderBroken(prov.key)) {
            await writeLog("API Skips", `Skipping broken/expired vendor ${prov.vendor.toUpperCase()} in batch ${bIdx + 1}`);
            continue;
          }
          if (isProviderRateLimited(prov.key, prov.vendor)) {
            await writeLog("API Skips", `Skipping rate-limited vendor ${prov.vendor.toUpperCase()} for batch ${bIdx + 1} (attempt ${attempt})`);
            continue;
          }

          await writeLog("API Request", `Sending batch ${bIdx + 1} (attempt ${attempt}/${MAX_BATCH_ATTEMPTS}) to ${prov.vendor.toUpperCase()}`);
          await updateSolverStatus("solving", `Solving batch ${bIdx + 1}/${batches.length} via ${prov.vendor.toUpperCase()}...`);
          try {
            const raw = await executeProvider(prov.vendor, prov.key, finalSystemPrompt, batchPrompt);
            const rawStr = raw || "";
            await writeLog("API Response", `Success from ${prov.vendor.toUpperCase()} for batch ${bIdx + 1} (attempt ${attempt}). Received ${rawStr.length} chars.`);
            const parsed = extractJSON(rawStr);

            const parsedArr = Array.isArray(parsed) ? parsed : (parsed.answers || [parsed]);
            batchAnswers = normalizePolymorphicAnswers(parsedArr, batch);
            providerUsed = prov.vendor;
            debugLog(`Batch ${bIdx + 1}`, `✅ ${prov.vendor.toUpperCase()} on attempt ${attempt}`);
            break;

          } catch (e) {
            await writeLog("API Failure", `Batch ${bIdx + 1} (attempt ${attempt}/${MAX_BATCH_ATTEMPTS}) failed for ${prov.vendor.toUpperCase()}: ${e.message}`);
            debugError(`Batch ${bIdx + 1}`, `${prov.vendor.toUpperCase()}: ${e.message}`);
            
            const parsedErr = parseError(e);
            if (parsedErr.category === "INVALID_KEY" || parsedErr.category === "EXPIRED_KEY") {
              markProviderBroken(prov.key, prov.vendor);
              await updateSolverStatus("solving", `${prov.vendor.toUpperCase()} key ${parsedErr.category === "INVALID_KEY" ? "invalid" : "expired"}. Switching provider...`);
            }

            if (isRateLimitError(e.message)) {
              const wait = extractWaitTime(e.message) || 15000;
              await writeLog("Rate Limit", `Marked ${prov.vendor.toUpperCase()} rate-limited for ${wait / 1000}s on batch failure.`);
              markRateLimited(prov.key, prov.vendor, wait);

              // If ALL keys are now rate-limited or broken, wait for the shortest cooldown
              const available = providerKeys.filter(p => !isProviderRateLimited(p.key, p.vendor) && !isProviderBroken(p.key));
              if (available.length === 0) {
                await writeLog("Rate Limit Wait", `All keys are rate-limited or broken. Waiting for cooldown of ${wait / 1000}s...`);
                debugWarn(`Batch ${bIdx + 1}`, `All keys rate-limited or broken. Honoring cooldown...`);
                await sleepWithCountdown(wait + 2000, "API Rate limit hit. Cooling down");
                // Clear the rate limit for the key to allow retry
                delete rateLimitedProviders[prov.key];
              }
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
          isSolving = false;
      });
    } else {
      isSolving = false;
    }

  } catch (error) {
    await writeLog("Fatal Error", `Uncaught exception in background: ${error.message}`);
    debugError("Engine", "FATAL:", error);
    await updateSolverStatus("error", `Fatal Error: ${error.message}`, { active: false });
    isSolving = false;
  }
}

async function executeProvider(vendor, apiKey, sysPrompt, usrPrompt) {
  if (vendor === "openai" || vendor === "groq") return callOpenAILike(vendor, apiKey, sysPrompt, usrPrompt);
  if (vendor === "gemini") return callGemini(apiKey, sysPrompt, usrPrompt);
  throw new Error(`Unknown vendor: ${vendor}`);
}

async function callOpenAILike(vendor, apiKey, sysPrompt, usrPrompt) {
  const url = vendor === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const model = vendor === "groq" ? "llama-3.1-8b-instant" : "gpt-4o-mini";

  debugLog(vendor.toUpperCase(), `${model} | ~${estimateTokens(usrPrompt)} prompt tokens`);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: usrPrompt }
      ],
      temperature: 0.1,
      max_tokens: 3000
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

async function callGemini(apiKey, sysPrompt, usrPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const combined = `${sysPrompt}\n\n=== QUESTIONS ===\n${usrPrompt}`;

  debugLog("GEMINI", `gemini-2.0-flash | ~${estimateTokens(combined)} tokens`);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: combined }] }] })
  });

  debugLog("GEMINI", `HTTP ${response.status}`);

  if (!response.ok) {
    let hint = response.statusText;
    try { const b = await response.json(); if (b.error?.message) hint = b.error.message; } catch(e) {}
    throw new Error(`HTTP ${response.status}: ${hint}`);
  }

  const data = await response.json();
  if (data.usageMetadata) {
    debugLog("GEMINI", `Tokens: prompt=${data.usageMetadata.promptTokenCount}, completion=${data.usageMetadata.candidatesTokenCount}`);
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}
