// Fetches section content from zyserver.zybooks.com using the user's existing login.
// We don't know yet exactly how zyBooks authenticates API calls, so we try the
// plausible methods in order and remember the first one that works.

const API = 'https://zyserver.zybooks.com/v1';

type AuthMethod = 'cookie' | 'bearer' | 'query';
const METHODS: AuthMethod[] = ['cookie', 'bearer', 'query'];

export class NotFoundError extends Error {}
export class AuthError extends Error {
  constructor() {
    super('zyBooks rejected the request. Make sure you are logged in at learn.zybooks.com, then click "Connect" again.');
  }
}

let workingMethod: AuthMethod | null = null;

export const sectionUrl = (book: string, chapter: number, section: number) =>
  `${API}/zybook/${encodeURIComponent(book)}/chapter/${chapter}/section/${section}`;

async function request(url: string, method: AuthMethod, token: string | undefined): Promise<Response | null> {
  if (method !== 'cookie' && !token) return null;
  const init: RequestInit = { credentials: method === 'cookie' ? 'include' : 'omit' };
  let target = url;
  if (method === 'bearer') init.headers = { Authorization: `Bearer ${token}` };
  if (method === 'query') target += `${url.includes('?') ? '&' : '?'}auth_token=${encodeURIComponent(token ?? '')}`;
  return fetch(target, init);
}

/** GETs a zyserver URL and returns parsed JSON with `success: true`. */
export async function zyGet(url: string, tokens: string[]): Promise<unknown> {
  const attempts: [AuthMethod, string | undefined][] = [];
  const order = workingMethod ? [workingMethod, ...METHODS.filter((m) => m !== workingMethod)] : METHODS;
  for (const m of order) {
    if (m === 'cookie') attempts.push([m, undefined]);
    else for (const t of tokens) attempts.push([m, t]);
  }

  let sawNotFound = false;
  for (const [method, token] of attempts) {
    const res = await request(url, method, token);
    if (!res) continue;
    if (res.status === 401 || res.status === 403) continue;
    if (res.status === 404) {
      sawNotFound = true;
      continue;
    }
    if (!res.ok) throw new Error(`zyBooks returned HTTP ${res.status}.`);
    const body = (await res.json()) as { success?: boolean; error?: { message?: string } };
    if (body?.success !== true) {
      // zyBooks reports auth problems in the body too; try the next method.
      continue;
    }
    workingMethod = method;
    return body;
  }
  if (sawNotFound) throw new NotFoundError('Not found.');
  throw new AuthError();
}

export function fetchSectionRaw(book: string, chapter: number, section: number, tokens: string[]) {
  return zyGet(sectionUrl(book, chapter, section), tokens);
}

export const authMethodInUse = () => workingMethod;
