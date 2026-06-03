document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById('onboard-form');
    const submitBtn = document.getElementById('submit-btn');
    const errorMsg = document.getElementById('error-msg');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const college = document.getElementById('college').value.trim();
        const branch = document.getElementById('branch').value.trim();
        const year = document.getElementById('year').value;

        if (!name || !email || !college || !branch || !year) {
            showError("Please fill out all fields.");
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = `Saving... <span class="material-symbols-outlined animate-spin">refresh</span>`;
        errorMsg.classList.add('hidden');

        try {
            const res = await fetch("https://form-automation-eight.vercel.app/api/onboard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, email, college, branch, year })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to save profile.");
            }

            // Save the user_id to local storage
            chrome.storage.local.set({ formAI_user_id: data.user_id }, () => {
                submitBtn.innerHTML = `Saved! <span class="material-symbols-outlined">check_circle</span>`;
                submitBtn.classList.replace('bg-primary-container', 'bg-success');
                submitBtn.classList.replace('text-primary', 'text-white');
                
                // Close the tab after a short delay
                setTimeout(() => {
                    window.close();
                }, 1000);
            });

        } catch (err) {
            console.error(err);
            showError(err.message);
            submitBtn.disabled = false;
            submitBtn.innerHTML = `Let's Go! <span class="material-symbols-outlined">arrow_forward</span>`;
        }
    });

    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.classList.remove('hidden');
    }
});
