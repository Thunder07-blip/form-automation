const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'popup', 'popup.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add radio button logic to toggleProfileEditMode
content = content.replace(
    'inputs.forEach(inp => inp.disabled = !isProfileEditMode);',
    'inputs.forEach(inp => inp.disabled = !isProfileEditMode);\n    document.querySelectorAll(".db-profile-radio").forEach(r => r.disabled = !isProfileEditMode);'
);

// 2. Add radio button change listeners right after editProfileBtn listener
content = content.replace(
    'if (editProfileBtn) editProfileBtn.addEventListener("click", toggleProfileEditMode);',
    'if (editProfileBtn) editProfileBtn.addEventListener("click", toggleProfileEditMode);\n\n// Sync radio buttons to hidden input\ndocument.querySelectorAll(".db-profile-radio").forEach(radio => {\n    radio.addEventListener("change", (e) => {\n        document.getElementById("db-gender").value = e.target.value;\n    });\n});'
);

// 3. Update loadDbProfile to set radio buttons
content = content.replace(
    'document.getElementById("db-gender").value = user.gender || "";',
    'const genderVal = user.gender || "";\n        document.getElementById("db-gender").value = genderVal;\n        document.querySelectorAll(".db-profile-radio").forEach(r => {\n            r.checked = (r.value === genderVal);\n        });'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Updated popup.js with radio button logic safely.");
