// Talks to start.ng through its hidden connect page (see https://start.ng/docs.md).
export const START_NG = 'https://start.ng';
let frame;

function connectFrame() {
  frame ??= new Promise((resolve, reject) => {
    const el = document.createElement('iframe');
    el.src = `${START_NG}/connect`;
    el.hidden = true;
    el.onload = () => resolve(el);
    el.onerror = reject;
    document.body.append(el);
  });
  return frame;
}

// Sends a message and resolves to start.ng's reply, or null if it didn't answer.
export async function askStartNg(message, replyType, timeoutMs = 5000) {
  let el;
  try { el = await connectFrame(); } catch { return null; }
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const done = (reply) => { clearTimeout(timer); removeEventListener('message', onMessage); resolve(reply); };
    const timer = setTimeout(() => done(null), timeoutMs);
    function onMessage(e) {
      if (e.origin !== START_NG || e.source !== el.contentWindow) return;
      if (e.data?.type === replyType && e.data.requestId === requestId) done(e.data);
    }
    addEventListener('message', onMessage);
    el.contentWindow.postMessage({ ...message, requestId }, START_NG);
  });
}

/** -> { user, guest } or null when start.ng didn't answer (e.g. opened as a local file) */
export const whoami = () => askStartNg({ type: 'startng:whoami' }, 'startng:user', 4000);

/** Save a finished run. Stats must match startng.json. */
export const saveRun = (stats) => askStartNg({ type: 'startng:score', stats }, 'startng:scoreSaved', 6000);

/** -> { ok, entries } */
export const getBoard = (limit = 10) => askStartNg({ type: 'startng:leaderboard', limit }, 'startng:leaderboardData', 6000);

export function signIn() {
  location.href = `${START_NG}/?return_to=${encodeURIComponent(location.origin + location.pathname)}`;
}
