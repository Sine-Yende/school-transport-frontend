const tokenStorageKey = "saferoute-token";

export function getToken() {
  return localStorage.getItem(tokenStorageKey);
}

export function setToken(token) {
  if (token) localStorage.setItem(tokenStorageKey, token);
  else localStorage.removeItem(tokenStorageKey);
}

export async function apiRequest(path, { body, method = "GET", token = getToken() } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}

export async function uploadDocument(applicationId, documentName, file) {
  const content = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.readAsDataURL(file);
  });
  return apiRequest(`/applications/${encodeURIComponent(applicationId)}/documents`, {
    method: "POST",
    body: { documentName, fileName: file.name, contentType: file.type, content },
  });
}
