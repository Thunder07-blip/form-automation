document.addEventListener('DOMContentLoaded', async () => {
  const welcomeText = document.getElementById('welcome-text');
  const userCollege = document.getElementById('user-college');
  const statForms = document.getElementById('stat-forms');
  const statQuestions = document.getElementById('stat-questions');
  const statAvgQs = document.getElementById('stat-avg-qs');
  const statAvgTime = document.getElementById('stat-avg-time');
  const activityList = document.getElementById('activity-list');
  const closeBtn = document.getElementById('close-btn');
  const logoutBtn = document.getElementById('logout-btn');

  // Load user from local storage
  const { user } = await chrome.storage.local.get('user');

  if (!user || !user.email) {
    window.location.href = '../popup/popup.html';
    return;
  }

  // In production this will be your Vercel URL
  const API_URL = `https://form-automation-eight.vercel.app/api/dashboard?email=${encodeURIComponent(user.email)}`;

  try {
    const response = await fetch(API_URL);
    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    welcomeText.textContent = `Hi, ${data.user.name?.split(' ')[0] || 'Student'}!`;
    userCollege.textContent = `${data.user.college} • Year ${data.user.year}`;

    statForms.textContent = data.stats.total_forms;
    statQuestions.textContent = data.stats.total_questions;
    statAvgQs.textContent = data.stats.avg_questions;
    statAvgTime.textContent = `${data.stats.avg_time}s`;

    // Render activity
    if (data.recent_activity.length === 0) {
      activityList.innerHTML = '<p class="text-xs font-bold text-center opacity-50 my-4">No forms processed yet.</p>';
    } else {
      activityList.innerHTML = data.recent_activity.map(act => `
        <div class="bg-background border-2 border-primary p-2 flex justify-between items-center neo-shadow">
          <div>
            <p class="text-[10px] font-black uppercase">${new Date(act.timestamp).toLocaleDateString()}</p>
            <p class="text-xs font-bold">${act.questions_filled}/${act.questions_detected} Qs Filled</p>
          </div>
          <div class="text-right">
            <span class="material-symbols-outlined text-[16px] ${act.success ? 'text-[#22c55e]' : 'text-[#e63b2e]'}">
              ${act.success ? 'check_circle' : 'error'}
            </span>
            <p class="text-[9px] font-black uppercase opacity-70">${act.time_taken_seconds}s</p>
          </div>
        </div>
      `).join('');
    }

  } catch (err) {
    console.error('Dashboard Error:', err);
    welcomeText.textContent = 'Error loading stats';
    userCollege.textContent = 'Please check your connection.';
    activityList.innerHTML = '';
  }

  closeBtn.addEventListener('click', () => {
    window.location.href = '../popup/popup.html';
  });

  logoutBtn.addEventListener('click', async () => {
    // Clear user session
    await chrome.storage.local.remove(['user', 'requires_onboarding', 'oauth_token']);
    // Best effort revoke token
    if (user.oauth_token) {
      try {
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${user.oauth_token}`);
        chrome.identity.removeCachedAuthToken({ token: user.oauth_token }, () => {});
      } catch (e) {}
    }
    window.location.href = '../popup/popup.html';
  });
});
