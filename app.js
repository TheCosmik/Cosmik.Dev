const form = document.getElementById('gate-form');
const panel = document.querySelector('.panel');
const input = document.getElementById('password');
const message = document.getElementById('gate-message');
const submitBtn = form.querySelector('button');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = input.value.trim();
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: value })
    });

    if (!res.ok) throw new Error('denied');

    message.textContent = 'ACCESS GRANTED';
    message.classList.add('show', 'granted');
    setTimeout(() => {
      window.location.href = 'home.html';
    }, 700);
  } catch {
    message.textContent = 'ACCESS DENIED';
    message.classList.remove('granted');
    message.classList.add('show');
    panel.classList.remove('shake');
    void panel.offsetWidth;
    panel.classList.add('shake');
    input.value = '';
    input.focus();
    submitBtn.disabled = false;
  }
});
