import { reconnect, serverUrl } from "./store";

// Admin sign-in lives on the plant server. It answers with an HttpOnly cookie, so this page never holds a token.
function apiUrl(path: string) {
  const ws = serverUrl();
  return ws ? ws.replace(/^ws/, "http").replace(/\/ws$/, path) : null;
}

// Whether this server offers sign-in at all (a laptop demo with OPEN_CONTROL doesn't need it).
export async function signInOffered() {
  const url = apiUrl("/api/session");
  if (!url) return false;
  try {
    const res = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(5000) });
    return res.ok && (await res.json()).signIn === true;
  } catch {
    return false;
  }
}

export async function signIn(password: string): Promise<string | null> {
  const url = apiUrl("/api/login");
  if (!url) return "No plant server connected.";
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return (await res.json().catch(() => ({}))).error ?? "Sign-in failed.";
    reconnect();
    return null;
  } catch {
    return "No answer from the plant server.";
  }
}

export async function signOut() {
  const url = apiUrl("/api/logout");
  if (url) await fetch(url, { method: "POST", credentials: "include" }).catch(() => {});
  reconnect();
}
