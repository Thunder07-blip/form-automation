// ─── Onboarding Gate ────────────────────────────────────────────────────────
const viewOnboard = document.getElementById("view-onboard");

function showOnboarding() {
    // Hide solve/settings, show onboarding
    document.getElementById("view-solve").classList.add("hidden-pane");
    document.getElementById("view-settings").classList.add("hidden-pane");
    viewOnboard.classList.remove("hidden-pane");
    // Hide the settings toggle button — not needed during onboarding
    document.getElementById("toggle-settings-btn").style.display = "none";
    document.querySelector('[data-icon="account_circle"]').style.display = "none";
}

function hideOnboarding() {
    viewOnboard.classList.add("hidden-pane");
    document.getElementById("view-solve").classList.remove("hidden-pane");
    document.getElementById("toggle-settings-btn").style.display = "";
    document.querySelector('[data-icon="account_circle"]').style.display = "";
}

chrome.storage.local.get(["formAI_user_id"], (res) => {
    if (!res.formAI_user_id) showOnboarding();
});

// ─── Onboarding Submit ────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    const obSubmitBtn = document.getElementById("ob-submit-btn");
    const obError = document.getElementById("ob-error");

    if (obSubmitBtn) {
        obSubmitBtn.addEventListener("click", async () => {
            const name   = document.getElementById("ob-name").value.trim();
            const email  = document.getElementById("ob-email").value.trim();
            const college= document.getElementById("ob-college").value.trim();
            const branch = document.getElementById("ob-branch").value.trim();
            const year   = document.getElementById("ob-year").value;

            if (!name || !email || !college || !branch || !year) {
                obError.textContent = "Please fill all fields.";
                obError.classList.remove("hidden");
                return;
            }
            obError.classList.add("hidden");

            obSubmitBtn.disabled = true;
            obSubmitBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;">refresh</span> Saving...`;

            try {
                const res = await fetch("https://form-automation-eight.vercel.app/api/onboard", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, email, college, branch, year })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Server error");

                chrome.storage.local.set({ formAI_user_id: data.user_id }, () => {
                    obSubmitBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;">check_circle</span> All Set!`;
                    obSubmitBtn.classList.add("bg-primary", "text-primary-fixed");
                    setTimeout(() => hideOnboarding(), 900);
                });

            } catch (err) {
                obError.textContent = err.message;
                obError.classList.remove("hidden");
                obSubmitBtn.disabled = false;
                obSubmitBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;">arrow_forward</span> Let's Go!`;
            }
        });
    }
});

const solveBtn = document.getElementById("solve-btn");
const statusText = document.getElementById("status-text");
const statusDot = document.getElementById("status-dot");
const aiResponseArea = document.getElementById("ai-response-area");
const statsPanel = document.getElementById("stats-panel");
const statFieldsVal = document.getElementById("stat-fields-val");
const errorBox = document.getElementById("error-message");
const providerBadge = document.getElementById("provider-badge");
const progressBar = document.getElementById("progress-bar");

const viewSolve = document.getElementById("view-solve");
const viewSettings = document.getElementById("view-settings");
const toggleSettingsBtn = document.getElementById("toggle-settings-btn");
const saveKeyBtn = document.getElementById("save-key-btn");
const profileInput = document.getElementById("profile-input");
const chatInput = document.getElementById("chat-input");

const providerListEl = document.getElementById("provider-list");
const addProviderBtn = document.getElementById("add-provider-btn");
const contextBtns = document.querySelectorAll(".context-btn");

let missingContextState = "print_not_provided";

function updateContextUI() {
    contextBtns.forEach(btn => {
        if (btn.dataset.value === missingContextState) {
            btn.classList.remove('bg-background');
            btn.classList.add('bg-primary-fixed');
        } else {
            btn.classList.remove('bg-primary-fixed');
            btn.classList.add('bg-background');
        }
    });
}

contextBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        missingContextState = btn.dataset.value;
        updateContextUI();
        chrome.storage.local.set({ missingContextHandling: missingContextState });
    });
});

// Button interaction
solveBtn.addEventListener('mousedown', () => {
    solveBtn.classList.remove('neo-shadow');
    solveBtn.classList.add('neo-shadow-active');
});
solveBtn.addEventListener('mouseup', () => {
    solveBtn.classList.add('neo-shadow');
    solveBtn.classList.remove('neo-shadow-active');
});
solveBtn.addEventListener('mouseleave', () => {
    solveBtn.classList.add('neo-shadow');
    solveBtn.classList.remove('neo-shadow-active');
});

function writeLog(category, message) {
    chrome.runtime.sendMessage({
        action: "ADD_LOG",
        source: "Popup Script",
        category: category,
        message: message
    }).catch(() => {});
}

writeLog("UI Action", "Popup interface opened.");

// ─── Progress Bar Helpers ────────────────────────────────────────────────────
let progressAnimFrame = null;
let currentProgress = 0;
let targetProgress = 0;
let totalBatchCount = 0; // Track total batches for real-time calculation

function animateToTarget() {
    if (progressAnimFrame) cancelAnimationFrame(progressAnimFrame);
    function step() {
        const diff = targetProgress - currentProgress;
        if (Math.abs(diff) < 0.3) {
            currentProgress = targetProgress;
            progressBar.style.width = currentProgress + "%";
            return;
        }
        currentProgress += diff * 0.12; // Ease out
        progressBar.style.width = currentProgress + "%";
        progressAnimFrame = requestAnimationFrame(step);
    }
    step();
}

function setProgress(percent) {
    targetProgress = Math.max(0, Math.min(100, percent));
    animateToTarget();
}

function setProgressSolving(batchDone, batchTotal) {
    // Real-time: each completed batch = proportional fill (leave 10% headroom for final injection)
    const pct = batchTotal > 0 ? 10 + ((batchDone / batchTotal) * 80) : 50;
    progressBar.classList.add('active');
    setProgress(pct);
}

function pulseProgress() {
    // Used only for strategy-1 (full payload, no batch info)
    progressBar.classList.add('active');
    setProgress(55);
}

function resetProgress() {
    if (progressAnimFrame) cancelAnimationFrame(progressAnimFrame);
    progressBar.classList.remove('active');
    currentProgress = 0;
    targetProgress = 0;
    progressBar.style.width = "0%";
}

function completeProgress() {
    progressBar.classList.remove('active');
    setProgress(100);
    setTimeout(() => resetProgress(), 900);
}

// Parse "batch X/Y" from solver status text and update progress
function updateProgressFromStatusText(text) {
    const batchMatch = text.match(/batch\s+(\d+)\/(\d+)/i);
    if (batchMatch) {
        const done = parseInt(batchMatch[1]);
        const total = parseInt(batchMatch[2]);
        totalBatchCount = total;
        setProgressSolving(done, total);
    } else if (text.toLowerCase().includes("solving all fields") || text.toLowerCase().includes("solving")) {
        pulseProgress();
    }
}

// Pop-in animation for field count
function popUpdateFieldCount(val) {
    statFieldsVal.innerText = val;
    statFieldsVal.classList.remove('pop-in');
    void statFieldsVal.offsetWidth; // force reflow
    statFieldsVal.classList.add('pop-in');
}

let activeProviders = [{ vendor: "groq", key: "" }];

// Load saved data and restore active solver state if running
chrome.storage.local.get(["providerKeys", "userProfile", "solverState", "missingContextHandling"], (data) => {
    if (data.providerKeys && Array.isArray(data.providerKeys)) {
        activeProviders = data.providerKeys;
    }
    if (data.userProfile) profileInput.value = data.userProfile;
    if (data.missingContextHandling) {
        missingContextState = data.missingContextHandling;
    }
    updateContextUI();
    renderProviders();

    if (data.solverState) {
        restoreSolverState(data.solverState);
    }
});

function restoreSolverState(state) {
    if (state.active) {
        // Only update field count if we have a real value
        if (state.blocksCount) popUpdateFieldCount(state.blocksCount);
        
        if (state.stateClass === "error") {
            showError(state.text);
            resetProgress();
        } else {
            if (state.warning === "PARTIAL_EXHAUSTED") {
                errorBox.innerText = state.text;
                errorBox.style.color = "var(--text-muted)";
                errorBox.style.display = "block";
            } else {
                errorBox.style.display = "none";
            }
            updateStatus(state.text, state.stateClass);
            updateProgressFromStatusText(state.text);
        }

        if (state.providerUsed) {
            providerBadge.style.display = "block";
            providerBadge.innerText = state.providerUsed.toUpperCase();
        } else {
            providerBadge.style.display = "none";
        }
    } else {
        // Final state
        if (state.stateClass) {
            if (state.blocksCount) popUpdateFieldCount(state.blocksCount);
            
            if (state.stateClass === "error") {
                showError(state.text);
                setProgress(0);
            } else {
                if (state.warning === "PARTIAL_EXHAUSTED") {
                    errorBox.innerText = state.text;
                    errorBox.style.color = "var(--text-muted)";
                    errorBox.style.display = "block";
                } else if (state.warning === "ALL_EXHAUSTED") {
                    showError(state.text);
                } else {
                    errorBox.style.display = "none";
                }
                updateStatus(state.text, state.stateClass);
                completeProgress();
            }
            
            if (state.providerUsed) {
                providerBadge.style.display = "block";
                providerBadge.innerText = state.providerUsed.toUpperCase();
            } else {
                providerBadge.style.display = "none";
            }
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SOLVER_STATUS_UPDATE") {
        restoreSolverState(message);
    }
});

function renderProviders() {
    providerListEl.innerHTML = "";
    activeProviders.forEach((prov, index) => {
        const row = document.createElement("div");
        row.className = "flex gap-2 items-center border-2 border-primary bg-background p-2";
        row.draggable = true;
        row.dataset.index = index;

        row.innerHTML = `
            <span class="cursor-move material-symbols-outlined select-none text-primary/50 shrink-0" style="font-size: 20px;">drag_indicator</span>
            <select class="vendor-select border-2 border-primary bg-background text-sm font-bold uppercase p-1 focus:outline-none w-20 shrink-0">
                <option value="groq" ${prov.vendor === 'groq' ? 'selected' : ''}>Groq</option>
                <option value="openrouter" ${prov.vendor === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
                <option value="nvidia" ${prov.vendor === 'nvidia' ? 'selected' : ''}>NVIDIA NIM</option>
            </select>
            <input type="password" class="key-input flex-grow min-w-0 border-2 border-primary bg-background p-1 font-mono text-sm focus:outline-none placeholder:text-primary/40" placeholder="API Key..." value="${prov.key}">
            <button class="remove-btn shrink-0 border-2 border-transparent hover:border-error text-error p-1 transition-all flex items-center justify-center"><span class="material-symbols-outlined" style="font-size: 18px;">close</span></button>
        `;

        // Event listeners for updating internal state
        row.querySelector(".vendor-select").addEventListener("change", (e) => {
            activeProviders[index].vendor = e.target.value;
        });
        row.querySelector(".key-input").addEventListener("input", (e) => {
            activeProviders[index].key = e.target.value;
        });
        row.querySelector(".remove-btn").addEventListener("click", () => {
            activeProviders.splice(index, 1);
            if (activeProviders.length === 0) activeProviders.push({ vendor: "groq", key: "" });
            renderProviders();
        });

        // Drag and drop mechanics
        row.addEventListener("dragstart", (e) => {
            row.classList.add("dragging");
            e.dataTransfer.setData("text/plain", index);
        });
        row.addEventListener("dragend", () => {
            row.classList.remove("dragging");
        });
        row.addEventListener("dragover", (e) => {
            e.preventDefault();
        });
        row.addEventListener("drop", (e) => {
            e.preventDefault();
            const draggedIdx = parseInt(e.dataTransfer.getData("text/plain"));
            const targetIdx = index;
            if (draggedIdx === targetIdx) return;
            
            const movedItem = activeProviders.splice(draggedIdx, 1)[0];
            activeProviders.splice(targetIdx, 0, movedItem);
            renderProviders();
        });

        providerListEl.appendChild(row);
    });
}

addProviderBtn.addEventListener("click", () => {
    activeProviders.push({ vendor: "openrouter", key: "" });
    renderProviders();
    writeLog("UI Action", "Added new provider row to settings.");
});

toggleSettingsBtn.addEventListener("click", () => {
    const isSettingsHidden = viewSettings.classList.contains('hidden-pane');
    if (isSettingsHidden) {
        viewSolve.classList.add('hidden-pane');
        viewSettings.classList.remove('hidden-pane');
        toggleSettingsBtn.innerHTML = `
          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">home</span>
          <span class="btn-label">Home</span>
        `;
    } else {
        viewSolve.classList.remove('hidden-pane');
        viewSettings.classList.add('hidden-pane');
        toggleSettingsBtn.innerHTML = `
          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">settings</span>
          <span class="btn-label">Settings</span>
        `;
    }
    writeLog("UI Action", `Settings panel ${isSettingsHidden ? "opened" : "closed"}.`);
});

saveKeyBtn.addEventListener("click", () => {
    const profile = profileInput.value.trim();
    // Clean keys
    const cleanProviders = activeProviders.filter(p => p.key.trim() !== "");
    chrome.storage.local.set({ providerKeys: cleanProviders, userProfile: profile }, () => {
        writeLog("UI Action", `Saved provider and user profile configurations. Providers: ${cleanProviders.map(p => p.vendor).join(', ')}`);
        viewSolve.classList.remove('hidden-pane');
        viewSettings.classList.add('hidden-pane');
        toggleSettingsBtn.innerHTML = `
          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">settings</span>
          <span class="btn-label">Settings</span>
        `;
    });
});

solveBtn.addEventListener("click", () => {
    writeLog("UI Action", "Solve Form button clicked. Auto-saving provider keys & profile context.");
    // Auto-save any modified keys/profile inputs on click of Solve Form
    const profile = profileInput.value.trim();
    const cleanProviders = activeProviders.filter(p => p.key.trim() !== "");
    chrome.storage.local.set({ providerKeys: cleanProviders, userProfile: profile, missingContextHandling: missingContextState });

    errorBox.style.display = "none";
    providerBadge.style.display = "none";
    resetProgress();
    
    setTimeout(() => {
        updateStatus("Analyzing page structure...", "analyzing");
        setProgress(10);
    }, 10);
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        
        writeLog("UI Action", "Sending scan request (EXTRACT_QUESTIONS) to current tab content script.");
        chrome.tabs.sendMessage(activeTab.id, { action: "EXTRACT_QUESTIONS" }, (response) => {
            if (chrome.runtime.lastError || !response) {
                const errMsg = "Please open a Google Form and ensure the page is fully loaded.";
                writeLog("Error", `Page scan request failed: ${chrome.runtime.lastError?.message || "no response"}`);
                showError(errMsg);
                return;
            }

            if (response.status === "error") {
                writeLog("Error", `Page scan request returned error status: ${response.message}`);
                showError(response.message);
                return;
            }

            const blocks = response.blocks;
            if (!blocks) {
                const errMsg = "Extension updated. Please reload the Google Form page to apply changes.";
                writeLog("Error", "Page scan request returned null/undefined blocks.");
                showError(errMsg);
                return;
            }

            writeLog("UI Action", `Successfully scanned ${blocks.length} blocks. Dispatching SOLVE_FORM to background orchestrator.`);
            // Immediately update field count with pop animation
            popUpdateFieldCount(blocks.length);

            const batchSize = 8;
            const totalBatches = Math.ceil(blocks.length / batchSize);
            totalBatchCount = totalBatches;
            const batchHint = totalBatches > 1 ? ` (${totalBatches} batches)` : "";
            updateStatus(`Solving ${blocks.length} blocks${batchHint}...`, "solving");
            setProgress(8); // Start the bar moving immediately

            // Save initial state so background will update it
            chrome.storage.local.set({ 
                solverState: { 
                    active: true, 
                    stateClass: "solving", 
                    text: `Solving ${blocks.length} blocks${batchHint}...`, 
                    blocksCount: blocks.length,
                    providerUsed: ""
                } 
            });

            const tempInstruction = chatInput ? chatInput.value.trim() : "";
            chrome.runtime.sendMessage({ 
                action: "SOLVE_FORM", 
                blocks: blocks, 
                tempInstruction: tempInstruction,
                tabId: activeTab.id
            }, (bgResponse) => {
                if (chrome.runtime.lastError || !bgResponse || bgResponse.status === "error") {
                    const errMsg = bgResponse?.message || "AI service unavailable.";
                    writeLog("Error", `Background solver failed: ${chrome.runtime.lastError?.message || errMsg}`);
                    showError(errMsg);
                    return;
                }
                // Background solves asynchronously now. Visuals will update via status broadcast messages.
            });
        });
    });
});

function updateStatus(text, stateClass) {
    statusText.innerText = text;
    statusDot.className = `dot ${stateClass} w-3 h-3 rounded-full border-2 border-primary`;
    if (stateClass === 'idle') statusDot.classList.add('bg-primary');
    else if (stateClass === 'analyzing') statusDot.classList.add('bg-tertiary');
    else if (stateClass === 'solving') statusDot.classList.add('bg-primary-container');
    else if (stateClass === 'error') statusDot.classList.add('bg-secondary');
}

function showError(msg) {
    writeLog("Error", `UI error displayed: ${msg}`);
    statusText.innerText = "Error";
    statusDot.className = "dot error w-3 h-3 rounded-full border-2 border-primary bg-error";
    errorBox.innerText = msg;
    errorBox.style.display = "block";
    providerBadge.style.display = "none";
    
    aiResponseArea.style.transform = "translateX(-5px)";
    setTimeout(() => aiResponseArea.style.transform = "translateX(5px)", 50);
    setTimeout(() => aiResponseArea.style.transform = "translateX(-5px)", 100);
    setTimeout(() => aiResponseArea.style.transform = "translateX(0)", 150);
}


function escapeCSVCell(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
}

