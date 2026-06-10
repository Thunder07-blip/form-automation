const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'popup', 'popup.js');
let content = fs.readFileSync(filePath, 'utf8');

// Fix profile mode toggle to use style.display to guarantee no conflicts
content = content.replace(
    'profileInputTextarea.classList.add("hidden");',
    'profileInputTextarea.style.display = "none";'
);
content = content.replace(
    'profileFormContainer.classList.remove("hidden");\\n            profileFormContainer.classList.add("flex");',
    'profileFormContainer.style.display = "flex";'
);
content = content.replace(
    'addProfileRowBtn.classList.remove("hidden");',
    'addProfileRowBtn.style.display = "flex";'
);

content = content.replace(
    'profileInputTextarea.classList.remove("hidden");',
    'profileInputTextarea.style.display = "block";'
);
content = content.replace(
    'profileFormContainer.classList.add("hidden");\\n            profileFormContainer.classList.remove("flex");',
    'profileFormContainer.style.display = "none";'
);
content = content.replace(
    'addProfileRowBtn.classList.add("hidden");',
    'addProfileRowBtn.style.display = "none";'
);

// We need to do regex replacement for the multiline if there are indentation differences, let's use standard regex.
content = content.replace(/profileInputTextarea\.classList\.add\("hidden"\);/g, 'profileInputTextarea.style.display = "none";');
content = content.replace(/profileFormContainer\.classList\.remove\("hidden"\);\s*profileFormContainer\.classList\.add\("flex"\);/g, 'profileFormContainer.style.display = "flex";');
content = content.replace(/addProfileRowBtn\.classList\.remove\("hidden"\);/g, 'addProfileRowBtn.style.display = "flex";');

content = content.replace(/profileInputTextarea\.classList\.remove\("hidden"\);/g, 'profileInputTextarea.style.display = "block";');
content = content.replace(/profileFormContainer\.classList\.add\("hidden"\);\s*profileFormContainer\.classList\.remove\("flex"\);/g, 'profileFormContainer.style.display = "none";');
content = content.replace(/addProfileRowBtn\.classList\.add\("hidden"\);/g, 'addProfileRowBtn.style.display = "none";');

// Fix skeleton loader
content = content.replace(
    'const dbProfileLoading = document.getElementById("db-profile-loading");',
    'const dbProfileSkeleton = document.getElementById("db-profile-skeleton");\\nconst dbProfileForm = document.getElementById("db-profile-form");'
);

content = content.replace(
    'dbProfileLoading.classList.remove("hidden");',
    'dbProfileSkeleton.classList.remove("hidden");\\n    dbProfileForm.classList.add("hidden");'
);

content = content.replace(
    'dbProfileLoading.classList.add("hidden");',
    'dbProfileSkeleton.classList.add("hidden");\\n        dbProfileForm.classList.remove("hidden");'
);

// One more place for save btn
content = content.replace(
    'dbProfileLoading.classList.remove("hidden");',
    'dbProfileSkeleton.classList.remove("hidden");\\n        dbProfileForm.classList.add("hidden");'
);
content = content.replace(
    'dbProfileLoading.classList.add("hidden");',
    'dbProfileSkeleton.classList.add("hidden");\\n            dbProfileForm.classList.remove("hidden");'
);


fs.writeFileSync(filePath, content, 'utf8');
console.log("Updated popup.js successfully.");
