const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'popup', 'popup.js');
let content = fs.readFileSync(filePath, 'utf8');

// Also hide back container when save container is active
content = content.replace(
    'dbSaveContainer.classList.remove("hidden");',
    'dbSaveContainer.classList.remove("hidden");\\n        document.getElementById("db-back-container").classList.add("hidden");'
);

content = content.replace(
    'dbSaveContainer.classList.add("hidden");',
    'dbSaveContainer.classList.add("hidden");\\n        document.getElementById("db-back-container").classList.remove("hidden");'
);

// We should use actual newlines here instead of literals so we don't break it again
content = content.split('\\n        document.getElementById').join('\n        document.getElementById');

fs.writeFileSync(filePath, content, 'utf8');
console.log("Updated popup.js to toggle back button visibility.");
