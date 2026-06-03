document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('onboarding-form');
  const errorBox = document.getElementById('error-box');
  const submitBtn = document.getElementById('submit-btn');

  // Pre-fill name if we have it from login
  const { user } = await chrome.storage.local.get('user');
  if (user && user.name) {
    document.getElementById('name').value = user.name;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');

    const name = document.getElementById('name').value.trim();
    const gender = document.getElementById('gender').value;
    const college = document.getElementById('college').value.trim();
    const branch = document.getElementById('branch').value.trim();
    const year = document.getElementById('year').value;

    if (!name || !gender || !college || !branch || !year) {
      errorBox.textContent = 'Please fill in all fields.';
      errorBox.classList.remove('hidden');
      return;
    }

    submitBtn.textContent = 'SAVING...';
    submitBtn.disabled = true;

    try {
      // Get the email from local storage (set during login)
      const email = user?.email;
      if (!email) throw new Error('User email not found. Please log in again.');

      // In production this will be your Vercel URL
      const API_URL = 'https://form-automation-eight.vercel.app/api/onboarding';

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, gender, college, branch, year })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save onboarding data.');
      }

      // Update local storage
      await chrome.storage.local.set({ user: data.user, requires_onboarding: false });

      // Redirect to dashboard
      window.location.href = 'dashboard.html';

    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove('hidden');
      submitBtn.textContent = 'Save & Continue';
      submitBtn.disabled = false;
    }
  });
});
