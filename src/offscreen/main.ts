// Offscreen document that hosts the Python worker for the service worker, which can't
// start workers itself. It only answers "recreate this level from the page" requests.

import { matchLevel } from '../engine/client';
import type { MatchRequest, MatchResult } from '../engine/runtime';

export interface OffscreenMatchRequest {
  type: 'pluset:offscreen:match';
  requests: MatchRequest[];
}

chrome.runtime.onMessage.addListener((msg: OffscreenMatchRequest, _sender, sendResponse) => {
  if (msg?.type !== 'pluset:offscreen:match') return false;
  void (async () => {
    const results: MatchResult[] = [];
    for (const r of msg.requests) {
      try {
        results.push(await matchLevel(r));
      } catch (e) {
        results.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    sendResponse(results);
  })();
  return true;
});
