// Sends password reset links through FormSubmit (https://formsubmit.co).
// FormSubmit asks each email address to confirm once: the first message to an
// address is its activation email, and the link only arrives after that.
const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');

async function sendResetLink(email, userId, token) {
  const base = process.env.FORMSUBMIT_URL || 'https://formsubmit.co';
  const link = `${appUrl()}/reset?token=${token}`;
  const res = await fetch(`${base}/ajax/${encodeURIComponent(email)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: appUrl() + '/' },
    body: JSON.stringify({
      _subject: 'Reset your Sir Palaniyandavar Info Tech password',
      _template: 'box',
      _captcha: 'false',
      'User ID': userId,
      message: `Open this link to choose a new password: ${link}\n\nThe link works once and ends in 30 minutes. If you did not ask for this, ignore this email.`,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const reply = await res.json().catch(() => ({}));
  if (!res.ok || String(reply.success) !== 'true') throw new Error(reply.message || `FormSubmit answered ${res.status}`);
}

module.exports = { sendResetLink };
