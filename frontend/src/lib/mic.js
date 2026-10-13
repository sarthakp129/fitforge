/**
 * Microphone pre-flight checks and human error messages.
 *
 * getUserMedia failures are famously cryptic (NotAllowedError, NotFoundError,
 * SecurityError…). Before starting a recording we ask two cheap questions —
 * does the browser expose any audio input, and what is the current permission
 * state — so the toast can tell the user what to DO, not just that it failed.
 */

/** @returns {Promise<{ok:boolean, reason?:string}>} */
export async function checkMic() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'Voice needs localhost or HTTPS — this connection is not secure enough for the browser to expose the mic.' };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === 'audioinput');
    if (!mics.length) {
      return { ok: false, reason: 'No microphone found on this device. Plug one in (or use a laptop/phone over HTTPS) and try again.' };
    }
  } catch {
    /* enumerate can fail before permission; getUserMedia will give the real error */
  }
  try {
    const perm = await navigator.permissions?.query?.({ name: 'microphone' });
    if (perm?.state === 'denied') {
      return { ok: false, reason: 'Microphone is blocked for this site. Click the site icon in the address bar → Permissions → allow Microphone.' };
    }
  } catch {
    /* permissions API optional */
  }
  return { ok: true };
}

/** Turn a raw getUserMedia/speech error into one actionable sentence. */
export function micErrorMessage(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone permission denied — allow it via the site icon in the address bar, then tap the mic again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No usable microphone found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'The microphone is busy in another app (calls, recorder). Close it and retry.';
  }
  if (name === 'AbortError') {
    return 'Recording was aborted — try again.';
  }
  return err?.message || 'Microphone unavailable.';
}
