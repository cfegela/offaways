/**
 * Thin fetch wrapper. Reads the token from sessionStorage automatically.
 * All methods return parsed JSON or throw on non-2xx.
 */

const API = (() => {
  function token() {
    return sessionStorage.getItem('access_token');
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = token();
    if (t) headers['Authorization'] = `Bearer ${t}`;

    const res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({ message: res.statusText }));

    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    return data;
  }

  return {
    get:    (path)         => request('GET',    path),
    post:   (path, body)   => request('POST',   path, body),
    put:    (path, body)   => request('PUT',    path, body),
    delete: (path)         => request('DELETE', path),
  };
})();

window.API = API;
