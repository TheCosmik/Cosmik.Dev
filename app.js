const ACCESS_CODE = 'cosmik';

const form = document.getElementById('gate-form');
const panel = document.querySelector('.panel');
const input = document.getElementById('password');
const message = document.getElementById('gate-message');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = input.value.trim().toLowerCase();

  if (value === ACCESS_CODE) {
    message.textContent = 'ACCESS GRANTED';
    message.classList.add('show', 'granted');
    form.querySelector('button').disabled = true;
    setTimeout(() => {
      window.location.href = 'home.html';
    }, 700);
  } else {
    message.textContent = 'ACCESS DENIED';
    message.classList.remove('granted');
    message.classList.add('show');
    panel.classList.remove('shake');
    void panel.offsetWidth;
    panel.classList.add('shake');
    input.value = '';
    input.focus();
  }
});
