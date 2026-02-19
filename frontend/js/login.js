document.addEventListener('DOMContentLoaded', async () => {
  await Auth.init();
  if (Auth.getUser()) {
    window.location.href = '/index.html';
    return;
  }

  const loginForm  = document.getElementById('form-login');
  const loginError = document.getElementById('login-error');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    loginError.classList.add('hidden');

    const email    = loginForm.querySelector('[name=email]').value.trim();
    const password = loginForm.querySelector('[name=password]').value;
    const btn      = loginForm.querySelector('[type=submit]');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in…';

    try {
      await Auth.login(email, password);
      window.location.href = '/index.html';
    } catch (err) {
      loginError.textContent = err.message || 'Login failed. Check your credentials.';
      loginError.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
});
