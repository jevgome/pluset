// Finds an open zyBooks tab and reads what we need from it: the book code
// (from the URL) and the login token (from the page's localStorage).
// The token never leaves this extension; it is only sent to zyserver.zybooks.com.

export interface ZySession {
  tabId: number;
  /** Book code from the tab URL, e.g. "UCONNME2250VivonaFall2026"; null if the tab isn't inside a book. */
  book: string | null;
  /** Candidate login tokens, best first. */
  tokens: string[];
  /** Where each token came from (localStorage key path), for diagnostics. Never the values. */
  tokenSources: string[];
}

export class NoZyBooksTabError extends Error {
  constructor() {
    super('Open zyBooks (learn.zybooks.com) in a tab and log in, then try again.');
  }
}

export function bookFromUrl(url: string | undefined): string | null {
  const m = /^https:\/\/learn\.zybooks\.com\/zybook\/([^/?#]+)/.exec(url ?? '');
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

// Runs inside the zyBooks page. Must be self-contained (it is serialized by chrome.scripting).
function scanLocalStorageForTokens(): { path: string; value: string }[] {
  const found: { path: string; value: string }[] = [];
  const visit = (v: unknown, path: string, depth: number) => {
    if (depth > 6 || v === null || v === undefined) return;
    if (typeof v === 'string') {
      const last = path.split('.').pop() ?? '';
      if (/token/i.test(last) && !/refresh|csrf/i.test(last) && v.length >= 16 && !/\s/.test(v)) {
        found.push({ path, value: v });
      }
      return;
    }
    if (typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) visit(child, `${path}.${k}`, depth + 1);
    }
  };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null) continue;
    const raw = localStorage.getItem(key);
    let value: unknown = raw;
    try {
      value = JSON.parse(raw ?? '');
    } catch {
      /* not JSON */
    }
    visit(value, key, 0);
  }
  return found;
}

export async function findZySession(): Promise<ZySession> {
  const tabs = await chrome.tabs.query({ url: 'https://learn.zybooks.com/*' });
  // Prefer a tab that is inside a book.
  const tab = tabs.find((t) => bookFromUrl(t.url)) ?? tabs[0];
  if (tab?.id === undefined) throw new NoZyBooksTabError();

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scanLocalStorageForTokens,
  });
  const candidates = (result?.result ?? []) as { path: string; value: string }[];
  // "auth_token" is the most likely name; keep the rest as fallbacks.
  candidates.sort((a, b) => Number(/auth_token/i.test(b.path)) - Number(/auth_token/i.test(a.path)));
  const unique = [...new Map(candidates.map((c) => [c.value, c])).values()];

  return {
    tabId: tab.id,
    book: bookFromUrl(tab.url),
    tokens: unique.map((c) => c.value),
    tokenSources: unique.map((c) => c.path),
  };
}
