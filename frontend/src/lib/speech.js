/**
 * Browser-native dictation via the Web Speech API (Chrome/Edge/Safari).
 *
 * Why this first, Whisper second: it is free, needs no server round-trip and
 * streams interim text into the UI while you talk. Whisper remains as the
 * fallback for browsers without SpeechRecognition (Firefox) and for uploaded
 * audio files on mic-less machines.
 *
 * Privacy note (documented in ADR-002): Chromium performs the recognition in
 * Google's cloud, so live dictation audio leaves the machine. The upload path
 * sends audio to Groq instead. Text-only input never leaves the server.
 */

const STT_PREF = 'ff-stt';   // 'whisper' once browser dictation proves unusable

/** True when the browser exposes SpeechRecognition. */
export const supportsSpeech = () =>
  typeof window !== 'undefined' &&
  Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * Chromium on many Linux distros (Kali included) ships the Web Speech API
 * WITHOUT Google's speech service, so recognition dies at runtime with
 * 'not-allowed'/'service-not-allowed' even when site permission is granted.
 * These errors mean "the service is unusable here", not "the user refused".
 */
export const sttServiceBroken = (err) =>
  ['not-allowed', 'service-not-allowed', 'network', 'UnsupportedError'].includes(err?.name);

export const preferWhisper = () => {
  try { return localStorage.getItem(STT_PREF) === 'whisper'; } catch { return false; }
};
export const rememberWhisper = () => {
  try { localStorage.setItem(STT_PREF, 'whisper'); } catch { /* private mode */ }
};

/**
 * Start one dictation session.
 *
 * @param {object} h
 * @param {(text:string)=>void} [h.onInterim] live partial transcript
 * @param {(text:string)=>void} [h.onFinal] final transcript when recognition ends
 * @param {(err:Error)=>void} [h.onError] mapped recognition error
 * @returns {()=>void} stop function
 */
export function startDictation({ lang, onInterim, onFinal, onError } = {}) {
  const Ctor = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
  if (!Ctor) {
    const e = new Error('Speech recognition not supported here.');
    e.name = 'UnsupportedError';
    onError?.(e);
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US';
  rec.interimResults = true;   // live text while speaking
  rec.continuous = false;      // one utterance per tap
  rec.maxAlternatives = 1;

  let finalText = '';
  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0]?.transcript || '';
      if (ev.results[i].isFinal) finalText += `${t} `;
      else interim += t;
    }
    onInterim?.((finalText + interim).trim());
  };
  rec.onerror = (ev) => {
    const e = new Error(ev.error || 'speech-error');
    e.name = ev.error || 'SpeechError';
    onError?.(e);
  };
  rec.onend = () => onFinal?.(finalText.trim());

  try {
    rec.start();
  } catch (err) {
    onError?.(err);
    return () => {};
  }
  return () => { try { rec.stop(); } catch { /* already stopped */ } };
}

/** Map SpeechRecognition error names to sentences a human can act on. */
export function speechErrorMessage(err) {
  switch (err?.name) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission denied — allow it via the site icon, then tap the mic again.';
    case 'audio-capture':
      return 'No microphone found on this device — type instead, or use a device with a mic.';
    case 'no-speech':
      return 'Heard nothing — tap the mic and speak after the pulse starts.';
    case 'network':
      return 'Browser dictation needs internet (Chromium uses its cloud service). Try again, or type.';
    case 'aborted':
      return 'Dictation cancelled.';
    default:
      return err?.message || 'Dictation unavailable.';
  }
}
