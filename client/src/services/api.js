const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') || '';

export async function api(path, options = {}) {
  const response = await fetch(`${configuredBase}/api${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status}). Please try again.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function queryString(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params.toString();
}
