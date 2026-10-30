/* Generic authenticated webhook boundary. A provider-specific adapter can replace this
   interface later without coupling order workflows to a mail/SMS vendor. */
export async function dispatchExternalNotification(channel, payload, env = process.env, fetchImpl = fetch) {
  const prefix = channel === 'email' ? 'EMAIL_PROVIDER' : channel === 'sms' ? 'SMS_PROVIDER' : null;
  if (!prefix) throw new Error('Unsupported notification channel.');
  const url = env[`${prefix}_URL`], token = env[`${prefix}_API_KEY`];
  if (!url || !token) return { state: 'not_configured' };
  let parsed;
  try { parsed = new URL(url); } catch { return { state: 'invalid_configuration' }; }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return { state: 'invalid_configuration' };
  try {
    const response = await fetchImpl(parsed, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, ...payload })
    });
    return response.ok ? { state: 'accepted' } : { state: 'provider_error', status: response.status };
  } catch (error) {
    return { state: 'delivery_error', name: error.name || 'Error' };
  }
}

export async function dispatchOrderNotifications({ email, phone, orderNumber, status, message }, env = process.env, fetchImpl = fetch) {
  const results = [];
  if (email) results.push(['email', await dispatchExternalNotification('email', { to: email, subject: `Laundry order ${orderNumber} update`, text: message, orderNumber, status }, env, fetchImpl)]);
  if (phone) results.push(['sms', await dispatchExternalNotification('sms', { to: phone, text: `${orderNumber}: ${message}`, orderNumber, status }, env, fetchImpl)]);
  for (const [channel, result] of results) {
    if (!['accepted', 'not_configured'].includes(result.state)) console.warn(JSON.stringify({ level: 'warn', event: 'external_notification_failed', channel, state: result.state, status: result.status }));
  }
  return results;
}
