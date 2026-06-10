const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'popup', 'popup.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix toggleProfileEditMode so it doesn't crash
content = content.replace(
    'document.getElementById("db-back-container").classList.add("hidden");',
    '// removed db-back-container'
);
content = content.replace(
    'document.getElementById("db-back-container").classList.remove("hidden");',
    '// removed db-back-container'
);

// 2. Update openProfileBtn logic to show "Home" button
content = content.replace(
    'document.getElementById("toggle-settings-btn").style.display = "none";',
    'document.getElementById("toggle-settings-btn").style.display = "";\\n        document.getElementById("toggle-settings-btn").innerHTML = `\\n          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">home</span>\\n          <span class="btn-label">Home</span>\\n        `;'
);

// 3. Update oldToggleSettingsListener logic to handle profile view closing
const toggleSettingsLogic = `oldToggleSettingsListener.addEventListener("click", () => {
    const viewSettings = document.getElementById("view-settings");
    const isSettingsHidden = viewSettings.classList.contains('hidden-pane');
    const viewSolve = document.getElementById("view-solve");
    const viewProfilePane = document.getElementById("view-profile");
    const isProfileHidden = viewProfilePane.classList.contains('hidden-pane');

    if (!isProfileHidden) {
        viewProfilePane.classList.add('hidden-pane');
        viewSolve.classList.remove('hidden-pane');
        oldToggleSettingsListener.innerHTML = \`
          <span class="material-symbols-outlined btn-icon" style="font-size:16px;">settings</span>
          <span class="btn-label">Settings</span>
        \`;
        document.getElementById("open-profile-btn").style.display = "";
        if (typeof isProfileEditMode !== 'undefined' && isProfileEditMode) toggleProfileEditMode();
        return;
    }`;

content = content.replace(
    'oldToggleSettingsListener.addEventListener("click", () => {\\n    const viewSettings = document.getElementById("view-settings");\\n    const isSettingsHidden = viewSettings.classList.contains(\\\'hidden-pane\\\');\\n    const viewSolve = document.getElementById("view-solve");',
    toggleSettingsLogic
);

// It's safer to use regex or string replace if exact match fails
// Let's use string slice and replace for toggleSettingsListener
let idx = content.indexOf('oldToggleSettingsListener.addEventListener("click", () => {');
if (idx !== -1) {
    let endIdx = content.indexOf('if (isSettingsHidden) {', idx);
    if (endIdx !== -1) {
        let chunk = content.substring(idx, endIdx);
        content = content.replace(chunk, toggleSettingsLogic + '\\n\\n    ');
    }
}

// 4. Remove backProfileBtn logic as it's no longer needed and might cause issues
// (Actually `if (backProfileBtn)` protects it, but it's good to clean it)

fs.writeFileSync(filePath, content, 'utf8');
console.log("Updated popup.js to use universal Home button.");
