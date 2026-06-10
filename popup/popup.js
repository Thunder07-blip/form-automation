// ─── Onboarding Gate ────────────────────────────────────────────────────────
const viewOnboard = document.getElementById("view-onboard");

function showOnboarding() {
    document.getElementById("view-solve").classList.add("hidden-pane");
    document.getElementById("view-settings").classList.add("hidden-pane");
    viewOnboard.classList.remove("hidden-pane");
    document.getElementById("toggle-settings-btn").style.display = "";
        document.getElementById("toggle-settings-btn").innerHTML = `
          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">home</span>
          <span class="btn-label">Home</span>
        `;
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

// ─── No API-Key Banner ────────────────────────────────────────────────────────
function checkAndShowNoKeyBanner() {
    chrome.storage.local.get(["providerKeys"], (data) => {
        const keys = data.providerKeys || [];
        const hasKey = keys.some(p => p.key && p.key.trim() !== "");
        const banner = document.getElementById("no-key-banner");
        if (banner) {
            banner.style.display = hasKey ? "none" : "flex";
        }
    });
}
checkAndShowNoKeyBanner();

// ─── College Autocomplete ─────────────────────────────────────────────────────
const COLLEGE_LIST = [
    "IIT Bombay", "IIT Delhi", "IIT Madras", "IIT Kharagpur", "IIT Kanpur",
    "IIT Roorkee", "IIT Guwahati", "IIT Hyderabad", "IIT Indore", "IIT Jodhpur",
    "IIT Bhubaneswar", "IIT Gandhinagar", "IIT Patna", "IIT Ropar", "IIT Mandi",
    "NIT Trichy", "NIT Warangal", "NIT Surathkal", "NIT Rourkela", "NIT Calicut",
    "NIT Allahabad", "NIT Durgapur", "NIT Jaipur", "NIT Bhopal", "NIT Surat",
    "BITS Pilani", "BITS Goa", "BITS Hyderabad",
    "Anna University", "VIT Vellore", "SRM Institute", "Manipal Institute of Technology",
    "Amity University", "Symbiosis Institute", "Pune University", "Mumbai University",
    "Delhi University", "Jadavpur University", "Osmania University", "Hyderabad University",
    "Jamia Millia Islamia", "AMU", "BHU", "IIIT Hyderabad", "IIIT Bangalore",
    "IIIT Allahabad", "IIIT Delhi", "IIIT Gwalior", "DTU", "NSUT", "IGDTUW",
    "Thapar University", "Chandigarh University", "LPU", "Chitkara University",
    "Savitribai Phule Pune University", "COEP", "VJTI", "ICT Mumbai",
    "PSG College of Technology", "SSN College", "SREC", "CEG Chennai",
    "DSCE Bangalore", "RV College", "BMS College", "MSRIT", "PES University",
    "JSS Academy", "Presidency University", "Vellore Institute of Technology",
    "Kalinga Institute", "SOA University", "GIET University", "CV Raman University",
    "GEC Thrissur", "Model Engineering College", "CUSAT", "NIT Calicut",
    "Rajasthan Technical University", "Poornima College", "Government College of Engineering Pune"
];

function initCollegeAutocomplete() {
    const input = document.getElementById("ob-college");
    const dropdown = document.getElementById("college-dropdown");
    if (!input || !dropdown) return;

    let activeIndex = -1;
    let currentQuery = "";

    function renderDropdown(query) {
        currentQuery = query;
        const q = query.toLowerCase().trim();
        dropdown.innerHTML = "";
        activeIndex = -1;

        const filtered = q.length > 0
            ? COLLEGE_LIST.filter(c => c.toLowerCase().includes(q)).slice(0, 12)
            : [];

        if (filtered.length === 0 && q.length === 0) {
            dropdown.classList.add("hidden"); return;
        }

        filtered.forEach((college, i) => {
            const li = document.createElement("li");
            li.textContent = college;
            li.addEventListener("mousedown", (e) => {
                e.preventDefault();
                input.value = college;
                dropdown.classList.add("hidden");
            });
            dropdown.appendChild(li);
        });

        // "Add new college" option
        if (q.length > 1) {
            const li = document.createElement("li");
            li.className = "add-new";
            li.textContent = `+ Add "${query}"`;
            li.addEventListener("mousedown", (e) => {
                e.preventDefault();
                input.value = query;
                dropdown.classList.add("hidden");
            });
            dropdown.appendChild(li);
        }

        if (dropdown.children.length > 0) dropdown.classList.remove("hidden");
        else dropdown.classList.add("hidden");
    }

    input.addEventListener("input", () => renderDropdown(input.value));
    input.addEventListener("focus", () => { if (input.value.length > 0) renderDropdown(input.value); });
    input.addEventListener("blur", () => setTimeout(() => dropdown.classList.add("hidden"), 150));

    input.addEventListener("keydown", (e) => {
        const items = dropdown.querySelectorAll("li");
        if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIndex = Math.min(activeIndex + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, -1);
            items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
        } else if (e.key === "Enter") {
            if (activeIndex >= 0 && items[activeIndex]) {
                e.preventDefault();
                const chosen = items[activeIndex].textContent.replace(/^\+ "?|"?$/g, "").replace(/^\+ /, "");
                // For "add new" items, extract the actual text
                if (items[activeIndex].classList.contains("add-new")) {
                    input.value = currentQuery;
                } else {
                    input.value = items[activeIndex].textContent;
                }
                dropdown.classList.add("hidden");
            }
        } else if (e.key === "Escape") {
            dropdown.classList.add("hidden");
        }
    });
}

// ─── City Autocomplete ────────────────────────────────────────────────────────
const CITY_LIST = [
    "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad",
    "Jaipur", "Surat", "Lucknow", "Kanpur", "Nagpur", "Indore", "Bhopal", "Patna",
    "Vadodara", "Ludhiana", "Agra", "Nashik", "Faridabad", "Meerut", "Rajkot", "Kalyan",
    "Vasai", "Varanasi", "Srinagar", "Aurangabad", "Dhanbad", "Amritsar", "Allahabad",
    "Ranchi", "Howrah", "Coimbatore", "Jabalpur", "Gwalior", "Vijayawada", "Jodhpur",
    "Madurai", "Raipur", "Kota", "Chandigarh", "Guwahati", "Solapur", "Hubli", "Bareilly",
    "Moradabad", "Mysore", "Tiruchirappalli", "Tiruppur", "Gurgaon", "Noida", "Navi Mumbai",
    "Jalandhar", "Bhubaneswar", "Salem", "Warangal", "Guntur", "Bhiwandi", "Saharanpur",
    "Gorakhpur", "Bikaner", "Amravati", "Jamshedpur", "Bhilai", "Cuttack", "Firozabad",
    "Kochi", "Dehradun", "Durgapur", "Asansol", "Nanded", "Kolhapur", "Ajmer", "Gulbarga",
    "Jamnagar", "Ujjain", "Loni", "Siliguri", "Jhansi", "Ulhasnagar", "Mangalore",
    "Erode", "Vellore", "Tirunelveli", "Malegaon", "Akola", "Gaya", "Udaipur",
    "Patiala", "Rohtak", "Bokaro", "Aligarh", "Bhavnagar", "Davangere", "Ghaziabad",
    "Thrissur", "Kozhikode", "Thiruvananthapuram", "Puducherry", "Shimla", "Imphal", "Shillong"
];

function initCityAutocomplete() {
    const input = document.getElementById("ob-city");
    const dropdown = document.getElementById("city-dropdown");
    if (!input || !dropdown) return;

    let activeIndex = -1;
    let currentQuery = "";

    function render(query) {
        currentQuery = query;
        const q = query.toLowerCase().trim();
        dropdown.innerHTML = "";
        activeIndex = -1;

        const filtered = q.length > 0 ? CITY_LIST.filter(c => c.toLowerCase().includes(q)).slice(0, 10) : [];
        if (filtered.length === 0 && q.length === 0) { dropdown.classList.add("hidden"); return; }

        filtered.forEach(item => {
            const li = document.createElement("li");
            li.textContent = item;
            li.addEventListener("mousedown", e => { e.preventDefault(); input.value = item; dropdown.classList.add("hidden"); });
            dropdown.appendChild(li);
        });

        if (q.length > 1) {
            const li = document.createElement("li");
            li.className = "add-new";
            li.textContent = `+ Add "${query}"`;
            li.addEventListener("mousedown", e => { e.preventDefault(); input.value = query; dropdown.classList.add("hidden"); });
            dropdown.appendChild(li);
        }

        dropdown.children.length > 0 ? dropdown.classList.remove("hidden") : dropdown.classList.add("hidden");
    }

    input.addEventListener("input", () => render(input.value));
    input.addEventListener("focus", () => { if (input.value.length > 0) render(input.value); });
    input.addEventListener("blur", () => setTimeout(() => dropdown.classList.add("hidden"), 150));
    input.addEventListener("keydown", e => {
        const items = dropdown.querySelectorAll("li");
        if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle("active", i === activeIndex)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, -1); items.forEach((el, i) => el.classList.toggle("active", i === activeIndex)); }
        else if (e.key === "Enter" && activeIndex >= 0 && items[activeIndex]) { e.preventDefault(); input.value = items[activeIndex].classList.contains("add-new") ? currentQuery : items[activeIndex].textContent; dropdown.classList.add("hidden"); }
        else if (e.key === "Escape") dropdown.classList.add("hidden");
    });
}

// ─── Onboarding Submit ────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initCollegeAutocomplete();
    initCityAutocomplete();

    const obSubmitBtn = document.getElementById("ob-submit-btn");
    const obError = document.getElementById("ob-error");

    if (obSubmitBtn) {
        obSubmitBtn.addEventListener("click", async () => {
            const name   = document.getElementById("ob-name").value.trim();
            const email  = document.getElementById("ob-email").value.trim();
            const college= document.getElementById("ob-college").value.trim();
            const city   = document.getElementById("ob-city").value.trim();
            const branch = document.getElementById("ob-branch").value.trim();
            const year   = document.getElementById("ob-year").value;

            if (!name || !email || !college || !city || !branch || !year) {
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
                    body: JSON.stringify({ name, email, college, city, branch, year })
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
            // Show only vendor name, not the model — e.g. "GROQ" not "GROQ/LLAMA-3"
            const vendor = state.providerUsed.split("/")[0].toUpperCase();
            providerBadge.innerText = `via ${vendor}`;
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
                const vendor = state.providerUsed.split("/")[0].toUpperCase();
                providerBadge.innerText = `via ${vendor}`;
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
        checkAndShowNoKeyBanner(); // Update the no-key banner immediately
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
    // (keys are saved in the callback below — see CRITICAL FIX)

    errorBox.style.display = "none";
    providerBadge.style.display = "none";
    resetProgress();

    setTimeout(() => {
        updateStatus("Analyzing page structure...", "analyzing");
        setProgress(10);
    }, 10);

    // CRITICAL FIX: storage.set MUST complete before background reads providerKeys.
    // Previously this was fire-and-forget, causing background to read empty keys.
    chrome.storage.local.set(
        { providerKeys: cleanProviders, userProfile: profile, missingContextHandling: missingContextState },
        () => {
        writeLog("UI Action", `Provider keys saved (${cleanProviders.length} providers). Now scanning form...`);
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
    }); // end chrome.tabs.query
    }); // end chrome.storage.local.set callback
}); // end solveBtn click

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



// ─── Profile Mode Toggle (Textbox vs Form) ────────────────────────────────────
const profileModeToggle = document.getElementById("profile-mode-toggle");
const profileModeThumb = document.getElementById("profile-mode-thumb");
const profileModeLabel = document.getElementById("profile-mode-label");
const profileInputTextarea = document.getElementById("profile-input");
const profileFormContainer = document.getElementById("profile-form-container");
const addProfileRowBtn = document.getElementById("add-profile-row-btn");

let isProfileFormMode = false;
const DEFAULT_FORM_KEYS = ["Name", "Email", "Phone Number", "Branch", "Division", "PRN", "DOB", "Gender"];

function parseProfileTextToPairs(text) {
    if (!text || !text.trim()) return [];
    return text.split("\n").map(line => {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) return { key: line.trim(), value: "" };
        return {
            key: line.slice(0, colonIdx).trim(),
            value: line.slice(colonIdx + 1).trim()
        };
    }).filter(p => p.key);
}

function serializePairsToText() {
    const rows = profileFormContainer.querySelectorAll(".profile-form-row");
    let lines = [];
    rows.forEach(row => {
        const key = row.querySelector(".row-key").value.trim();
        const val = row.querySelector(".row-value").value.trim();
        if (key) lines.push(`${key}: ${val}`);
    });
    return lines.join("\n");
}

function renderProfileFormRows(pairs) {
    profileFormContainer.innerHTML = "";
    if (pairs.length === 0) {
        pairs = DEFAULT_FORM_KEYS.map(k => ({ key: k, value: "" }));
    }
    pairs.forEach(p => addProfileFormRow(p.key, p.value));
}

function addProfileFormRow(key = "", value = "") {
    const row = document.createElement("div");
    row.className = "profile-form-row flex gap-1 items-center";
    row.innerHTML = `
        <input type="text" class="row-key w-1/3 border-2 border-primary bg-background p-1 font-bold text-[10px] focus:outline-none placeholder:text-primary/40" placeholder="Key..." value="${key}">
        <input type="text" class="row-value w-2/3 border-2 border-primary bg-background p-1 font-mono text-[10px] focus:outline-none placeholder:text-primary/40" placeholder="Value..." value="${value}">
        <button class="remove-row-btn shrink-0 border-2 border-transparent hover:border-error text-error p-0.5 transition-all flex items-center justify-center"><span class="material-symbols-outlined" style="font-size: 14px;">close</span></button>
    `;
    row.querySelector(".remove-row-btn").addEventListener("click", () => row.remove());
    // Auto sync on input
    row.querySelectorAll("input").forEach(inp => {
        inp.addEventListener("input", () => {
            if (isProfileFormMode) profileInputTextarea.value = serializePairsToText();
        });
    });
    profileFormContainer.appendChild(row);
}

if (profileModeToggle) {
    profileModeToggle.addEventListener("click", () => {
        isProfileFormMode = !isProfileFormMode;
        if (isProfileFormMode) {
            // Switch to Form Mode
            profileModeThumb.classList.remove("translate-x-1");
            profileModeThumb.classList.add("translate-x-5");
            profileModeLabel.textContent = "Form";
            
            const pairs = parseProfileTextToPairs(profileInputTextarea.value);
            renderProfileFormRows(pairs);
            
            profileInputTextarea.style.display = "none";
            profileFormContainer.style.display = "flex";
            addProfileRowBtn.style.display = "flex";
        } else {
            // Switch to Textbox Mode
            profileModeThumb.classList.remove("translate-x-5");
            profileModeThumb.classList.add("translate-x-1");
            profileModeLabel.textContent = "Textbox";
            
            profileInputTextarea.value = serializePairsToText();
            
            profileInputTextarea.style.display = "block";
            profileFormContainer.style.display = "none";
            addProfileRowBtn.style.display = "none";
        }
    });
}

if (addProfileRowBtn) {
    addProfileRowBtn.addEventListener("click", () => addProfileFormRow());
}

// ─── Profile DB View Logic ────────────────────────────────────────────────────
const openProfileBtn = document.getElementById("open-profile-btn");
const viewProfilePane = document.getElementById("view-profile");
const backProfileBtn = document.getElementById("back-profile-btn");
const editProfileBtn = document.getElementById("edit-profile-btn");
const saveProfileBtn = document.getElementById("save-profile-btn");
const dbProfileSkeleton = document.getElementById("db-profile-skeleton");
const dbProfileForm = document.getElementById("db-profile-form");
const dbSaveContainer = document.getElementById("db-save-container");
const dbError = document.getElementById("db-error");

let isProfileEditMode = false;
let currentDbUserId = null;

function toggleProfileEditMode() {
    isProfileEditMode = !isProfileEditMode;
    const inputs = document.querySelectorAll(".db-profile-input");
    inputs.forEach(inp => inp.disabled = !isProfileEditMode);
    
    
    if (isProfileEditMode) {
        document.getElementById("edit-profile-icon").textContent = "close";
        document.getElementById("edit-profile-text").textContent = "Cancel";
        dbSaveContainer.classList.remove("hidden");
        // removed db-back-container
    } else {
        document.getElementById("edit-profile-icon").textContent = "edit";
        document.getElementById("edit-profile-text").textContent = "Edit";
        dbSaveContainer.classList.add("hidden");
        // removed db-back-container
        // Reload data to cancel changes
        if (currentDbUserId) loadDbProfile(currentDbUserId);
    }
}

if (editProfileBtn) editProfileBtn.addEventListener("click", toggleProfileEditMode);





if (openProfileBtn) {
    openProfileBtn.addEventListener("click", () => {
        document.getElementById("view-solve").classList.add("hidden-pane");
        document.getElementById("view-settings").classList.add("hidden-pane");
        viewProfilePane.classList.remove("hidden-pane");
        const toggleBtn = document.getElementById("toggle-settings-btn");
        toggleBtn.style.display = "";
        toggleBtn.innerHTML = `
          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">home</span>
          <span class="btn-label">Home</span>
        `;
        document.getElementById("open-profile-btn").style.display = "none";
        
        chrome.storage.local.get(["formAI_user_id"], (res) => {
            if (res.formAI_user_id) {
                currentDbUserId = res.formAI_user_id;
                loadDbProfile(currentDbUserId);
            } else {
                dbError.textContent = "No user ID found. Please reinstall or complete onboarding.";
                dbError.classList.remove("hidden");
            }
        });
    });
}

async function loadDbProfile(userId) {
    dbProfileSkeleton.classList.remove("hidden");
    dbProfileForm.classList.add("hidden");
    dbError.classList.add("hidden");
    try {
        const res = await fetch(`https://form-automation-eight.vercel.app/api/user?id=${userId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load profile");
        
        const user = data.user;
        document.getElementById("db-name").value = user.name || "";
        document.getElementById("db-email").value = user.email || "";
        document.getElementById("db-college").value = user.college || "";
        document.getElementById("db-city").value = user.city || "";
        document.getElementById("db-branch").value = user.branch || "";
        document.getElementById("db-year").value = user.year || "";
        document.getElementById("db-gender").value = user.gender || "";
        
    } catch (err) {
        dbError.textContent = err.message;
        dbError.classList.remove("hidden");
    } finally {
        dbProfileSkeleton.classList.add("hidden");
        dbProfileForm.classList.remove("hidden");
    }
}

if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", async () => {
        if (!currentDbUserId) return;
        dbError.classList.add("hidden");
        dbProfileSkeleton.classList.remove("hidden");
        dbProfileForm.classList.add("hidden");
        
        const payload = {
            id: currentDbUserId,
            name: document.getElementById("db-name").value.trim(),
            email: document.getElementById("db-email").value.trim(),
            college: document.getElementById("db-college").value.trim(),
            city: document.getElementById("db-city").value.trim(),
            branch: document.getElementById("db-branch").value.trim(),
            year: document.getElementById("db-year").value.trim(),
            gender: document.getElementById("db-gender").value.trim()
        };
        
        try {
            const res = await fetch("https://form-automation-eight.vercel.app/api/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to save profile");
            
            toggleProfileEditMode(); // Exit edit mode
        } catch (err) {
            dbError.textContent = err.message;
            dbError.classList.remove("hidden");
        } finally {
            dbProfileSkeleton.classList.add("hidden");
            dbProfileForm.classList.remove("hidden");
        }
    });
}

// Ensure toggle settings btn resets open profile btn display if needed
const originalToggleSettings = toggleSettingsBtn.onclick; // not used directly, it uses event listener, so we just patch the logic slightly
const oldToggleSettingsListener = toggleSettingsBtn.cloneNode(true);
toggleSettingsBtn.parentNode.replaceChild(oldToggleSettingsListener, toggleSettingsBtn);
oldToggleSettingsListener.addEventListener("click", () => {
    const viewSettings = document.getElementById("view-settings");
    const isSettingsHidden = viewSettings.classList.contains('hidden-pane');
    const viewSolve = document.getElementById("view-solve");
    const viewProfilePane = document.getElementById("view-profile");
    const isProfileHidden = viewProfilePane.classList.contains('hidden-pane');

    if (!isProfileHidden) {
        viewProfilePane.classList.add('hidden-pane');
        viewSolve.classList.remove('hidden-pane');
        oldToggleSettingsListener.innerHTML = `
          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">settings</span>
          <span class="btn-label">Settings</span>
        `;
        document.getElementById("open-profile-btn").style.display = "";

        if (typeof isProfileEditMode !== 'undefined' && isProfileEditMode) toggleProfileEditMode();
        return;
    }

    if (isSettingsHidden) {
        viewSolve.classList.add('hidden-pane');
        viewSettings.classList.remove('hidden-pane');
        oldToggleSettingsListener.innerHTML = `
          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">home</span>
          <span class="btn-label">Home</span>
        `;
        document.getElementById("open-profile-btn").style.display = "none";
    } else {
        viewSolve.classList.remove('hidden-pane');
        viewSettings.classList.add('hidden-pane');
        oldToggleSettingsListener.innerHTML = `
          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">settings</span>
          <span class="btn-label">Settings</span>
        `;
        document.getElementById("open-profile-btn").style.display = "";
    }
});

// Update saveKeyBtn logic slightly to restore open-profile-btn display
const saveKeyBtnObj = document.getElementById("save-key-btn");
if(saveKeyBtnObj) {
    saveKeyBtnObj.addEventListener("click", () => {
        document.getElementById("open-profile-btn").style.display = "";
    });
}


const backProfileBtnNew = document.getElementById("back-profile-btn");
if (backProfileBtn) {
    backProfileBtn.addEventListener("click", () => {
        const viewProfilePane = document.getElementById("view-profile");
        const viewSolve = document.getElementById("view-solve");
        
        viewProfilePane.classList.add('hidden-pane');
        viewSolve.classList.remove('hidden-pane');
        
        const oldToggleSettingsListener = document.getElementById("toggle-settings-btn");
        if (oldToggleSettingsListener) {
            oldToggleSettingsListener.innerHTML = `
              <span class="material-symbols-outlined btn-icon" style="font-size:16px;">settings</span>
              <span class="btn-label">Settings</span>
            `;
        }
        document.getElementById("open-profile-btn").style.display = "";
        
        if (typeof isProfileEditMode !== 'undefined' && isProfileEditMode) {
            toggleProfileEditMode();
        }
    });
}
