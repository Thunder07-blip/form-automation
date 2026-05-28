const solveBtn = document.getElementById("solve-btn");
const statusText = document.getElementById("status-text");
const statusDot = document.getElementById("status-dot");
const aiResponseArea = document.getElementById("ai-response-area");
const statsPanel = document.getElementById("stats-panel");
const statFieldsVal = document.getElementById("stat-fields-val");
const errorBox = document.getElementById("error-message");
const providerBadge = document.getElementById("provider-badge");
const downloadLogsBtn = document.getElementById("download-logs-btn");
const clearLogsBtn = document.getElementById("clear-logs-btn");

const settingsArea = document.getElementById("settings-area");
const toggleSettingsBtn = document.getElementById("toggle-settings-btn");
const saveKeyBtn = document.getElementById("save-key-btn");
const profileInput = document.getElementById("profile-input");
const chatInput = document.getElementById("chat-input");

const providerListEl = document.getElementById("provider-list");
const addProviderBtn = document.getElementById("add-provider-btn");

function writeLog(category, message) {
    chrome.runtime.sendMessage({
        action: "ADD_LOG",
        source: "Popup Script",
        category: category,
        message: message
    }).catch(() => {});
}

writeLog("UI Action", "Popup interface opened.");

let activeProviders = [{ vendor: "groq", key: "" }];

// Load saved data and restore active solver state if running
chrome.storage.local.get(["providerKeys", "userProfile", "solverState"], (data) => {
    if (data.providerKeys && Array.isArray(data.providerKeys)) {
        activeProviders = data.providerKeys;
    }
    if (data.userProfile) profileInput.value = data.userProfile;
    renderProviders();

    if (data.solverState) {
        restoreSolverState(data.solverState);
    }
});

function restoreSolverState(state) {
    if (state.active) {
        aiResponseArea.style.display = "block";
        aiResponseArea.classList.add("active");
        statsPanel.style.display = "block";
        statFieldsVal.innerText = state.blocksCount || 0;
        
        if (state.stateClass === "error") {
            showError(state.text);
        } else {
            if (state.warning === "PARTIAL_EXHAUSTED") {
                errorBox.innerText = state.text;
                errorBox.style.color = "var(--text-muted)";
                errorBox.style.display = "block";
            } else {
                errorBox.style.display = "none";
            }
            updateStatus(state.text, state.stateClass);
        }

        if (state.providerUsed) {
            providerBadge.style.display = "block";
            providerBadge.innerText = state.providerUsed.toUpperCase();
        } else {
            providerBadge.style.display = "none";
        }
    } else {
        // If completed or failed, show final status
        if (state.stateClass) {
            aiResponseArea.style.display = "block";
            aiResponseArea.classList.add("active");
            statsPanel.style.display = "block";
            statFieldsVal.innerText = state.blocksCount || 0;
            
            if (state.stateClass === "error") {
                showError(state.text);
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
        row.className = "provider-row";
        row.draggable = true;
        row.dataset.index = index;

        row.innerHTML = `
            <span style="cursor: grab;">⠿</span>
            <select class="vendor-select">
                <option value="groq" ${prov.vendor === 'groq' ? 'selected' : ''}>Groq</option>
                <option value="openai" ${prov.vendor === 'openai' ? 'selected' : ''}>OpenAI</option>
                <option value="gemini" ${prov.vendor === 'gemini' ? 'selected' : ''}>Gemini</option>
            </select>
            <input type="password" class="key-input" placeholder="API Key..." value="${prov.key}">
            <button class="remove-btn">✕</button>
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
    activeProviders.push({ vendor: "openai", key: "" });
    renderProviders();
    writeLog("UI Action", "Added new provider row to settings.");
});

toggleSettingsBtn.addEventListener("click", () => {
    const isHidden = settingsArea.style.display === "none";
    settingsArea.style.display = isHidden ? "flex" : "none";
    writeLog("UI Action", `Settings panel ${isHidden ? "opened" : "closed"}.`);
});

saveKeyBtn.addEventListener("click", () => {
    const profile = profileInput.value.trim();
    // Clean keys
    const cleanProviders = activeProviders.filter(p => p.key.trim() !== "");
    chrome.storage.local.set({ providerKeys: cleanProviders, userProfile: profile }, () => {
        writeLog("UI Action", `Saved provider and user profile configurations. Providers: ${cleanProviders.map(p => p.vendor).join(', ')}`);
        settingsArea.style.display = "none";
    });
});

solveBtn.addEventListener("click", () => {
    writeLog("UI Action", "Solve Form button clicked. Auto-saving provider keys & profile context.");
    // Auto-save any modified keys/profile inputs on click of Solve Form
    const profile = profileInput.value.trim();
    const cleanProviders = activeProviders.filter(p => p.key.trim() !== "");
    chrome.storage.local.set({ providerKeys: cleanProviders, userProfile: profile });

    aiResponseArea.style.display = "block";
    errorBox.style.display = "none";
    providerBadge.style.display = "none";
    
    setTimeout(() => {
        aiResponseArea.classList.add("active");
        updateStatus("Analyzing page structure...", "analyzing");
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
            statsPanel.style.display = "block";
            statFieldsVal.innerText = blocks.length;

            const batchSize = 8;
            const totalBatches = Math.ceil(blocks.length / batchSize);
            const batchHint = totalBatches > 1 ? ` (${totalBatches} batches)` : "";
            updateStatus(`Solving ${blocks.length} blocks${batchHint}...`, "solving");

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
    statusDot.className = `dot ${stateClass}`;
}

function showError(msg) {
    writeLog("Error", `UI error displayed: ${msg}`);
    statusText.innerText = "Error Occurred";
    statusDot.className = "dot error";
    errorBox.innerText = msg;
    errorBox.style.display = "block";
    providerBadge.style.display = "none";
    
    aiResponseArea.style.transform = "translateX(-5px)";
    setTimeout(() => aiResponseArea.style.transform = "translateX(5px)", 50);
    setTimeout(() => aiResponseArea.style.transform = "translateX(-5px)", 100);
    setTimeout(() => aiResponseArea.style.transform = "translateX(0)", 150);
}

// ─── Telemetry Event Listeners ──────────────────────────────────────────────

downloadLogsBtn.addEventListener("click", () => {
    chrome.storage.local.get(["telemetryLogs"], (data) => {
        const logs = data.telemetryLogs || [];
        
        const headers = ["Timestamp", "Source", "Category", "Message"];
        const csvRows = [headers.map(escapeCSVCell).join(",")];
        
        logs.forEach(log => {
            const row = [
                log.timestamp || "",
                log.source || "",
                log.category || "",
                log.message || ""
            ];
            csvRows.push(row.map(escapeCSVCell).join(","));
        });
        
        const csvString = csvRows.join("\r\n");
        const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        
        // Generate a filename with a clean timestamp
        const now = new Date();
        const timestampStr = now.getFullYear() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') + "_" +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
            
        link.setAttribute("download", `formai_telemetry_${timestampStr}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        writeLog("UI Action", `Telemetry logs downloaded. Total entries: ${logs.length}`);
        
        // Brief success indicator on button
        const originalText = downloadLogsBtn.innerText;
        downloadLogsBtn.innerText = "📥 Downloaded!";
        downloadLogsBtn.style.borderColor = "rgba(16, 185, 129, 0.4)";
        downloadLogsBtn.style.color = "#10B981";
        setTimeout(() => {
            downloadLogsBtn.innerText = originalText;
            downloadLogsBtn.style.borderColor = "";
            downloadLogsBtn.style.color = "";
        }, 1500);
    });
});

clearLogsBtn.addEventListener("click", () => {
    chrome.storage.local.set({ telemetryLogs: [] }, () => {
        writeLog("UI Action", "Telemetry logs cleared by user.");
        const originalText = clearLogsBtn.innerText;
        clearLogsBtn.innerText = "🗑️ Cleared!";
        clearLogsBtn.style.borderColor = "rgba(16, 185, 129, 0.4)";
        clearLogsBtn.style.color = "#10B981";
        setTimeout(() => {
            clearLogsBtn.innerText = originalText;
            clearLogsBtn.style.borderColor = "rgba(239, 68, 68, 0.3)";
            clearLogsBtn.style.color = "var(--error)";
        }, 1500);
    });
});

function escapeCSVCell(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
}
