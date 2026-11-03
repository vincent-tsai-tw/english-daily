// Listening and speaking. Sentences with a pre-recorded neural-voice clip (registered with
// addClips) play that file; anything else uses the browser's text-to-speech. Speech recognition
// is optional: callers check sttSupported() and fall back to typing.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
// Looked up on use (not at load) so tests can substitute a recogniser.
const recognition = () => (typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined);

const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|eddy|flo|fred|good news|grandma|grandpa|hysterical|jester|junior|kathy|organ|pipe|ralph|reed|rocko|sandy|shelley|superstar|trinoids|whisper|wobble|zarvox/i;

export const ttsSupported = () => Boolean(synth);

const clips = new Map();
const clipKey = (text) => String(text).trim();

// Register {text: url} clips; later registrations win.
export function addClips(map) {
  for (const [text, url] of Object.entries(map || {})) if (url) clips.set(clipKey(text), url);
}

export const hasClip = (text) => clips.has(clipKey(text));
export const canSpeak = (text) => hasClip(text) || ttsSupported();

// One shared element: iOS only lets an element play without a tap after it has played once.
let player = null;

function playClip(url, rate) {
  return new Promise((resolve) => {
    player ||= new Audio();
    const a = player;
    const finish = (ok) => { a.onended = a.onerror = a.onpause = null; resolve(ok); };
    a.onended = () => finish(true);
    a.onpause = () => finish(true);
    a.onerror = () => finish(false);
    a.src = url;
    a.defaultPlaybackRate = rate;
    a.playbackRate = rate;
    a.preservesPitch = true;
    a.play().catch(() => finish(false));
  });
}
export const sttSupported = () => Boolean(recognition());

function rank(v) {
  let score = 0;
  if (/en[-_]US/i.test(v.lang)) score += 3;
  else if (/en[-_](GB|AU|CA|IE|NZ)/i.test(v.lang)) score += 2;
  if (/premium|enhanced|natural|neural/i.test(v.name)) score += 5;
  if (/google/i.test(v.name)) score += 3;
  if (/samantha|ava|allison|evan|nathan|zoe|tom|daniel|serena|aaron|nicky|karen|moira/i.test(v.name)) score += 2;
  if (NOVELTY.test(v.name)) score -= 20;
  return score;
}

export function englishVoices() {
  if (!synth) return [];
  return synth.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang)).sort((a, b) => rank(b) - rank(a));
}

// Voices load asynchronously in Chrome and Safari; resolve once they are available.
export function voicesReady() {
  if (!synth) return Promise.resolve([]);
  if (synth.getVoices().length) return Promise.resolve(englishVoices());
  return new Promise((resolve) => {
    const done = () => resolve(englishVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

// The preferred voice plus a different second voice for the other dialogue speaker.
export function voicePair(preferredName) {
  const voices = englishVoices();
  const first = voices.find((v) => v.name === preferredName) || voices[0] || null;
  const second = voices.find((v) => v !== first && v.lang.slice(0, 2) === (first?.lang || 'en').slice(0, 2) && rank(v) > 0) || null;
  return [first, second];
}

let generation = 0;

export function stop() {
  generation += 1;
  synth?.cancel();
  if (player && !player.paused) player.pause();
}

// Short utterances avoid Chrome's habit of cutting speech off after ~15 seconds.
function sentences(text) {
  const plain = String(text)
    .replace(/\b([ap])\.m\./gi, '$1m')
    .replace(/\b(Mr|Mrs|Ms|Dr|vs|etc|e\.g|i\.e)\./gi, '$1');
  return plain.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g)?.map((s) => s.trim()).filter(Boolean) || [];
}

function utter(text, { voice, rate, pitch }) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang || 'en-US';
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = pitch;
    u.onend = resolve;
    u.onerror = resolve;
    synth.speak(u);
  });
}

async function speakOne(text, { voice, rate, pitch }, mine) {
  const url = clips.get(clipKey(text));
  // A failed clip (e.g. offline and not cached) falls back to the browser's voice.
  if (url && (await playClip(url, rate))) return;
  if (!synth || mine !== generation) return;
  for (const part of sentences(text)) {
    if (mine !== generation) return;
    await utter(part, { voice, rate, pitch });
  }
}

// Speak `text`; resolves when finished or when stop() is called.
export async function say(text, { voice = null, rate = 1, pitch = 1 } = {}) {
  stop();
  await speakOne(text, { voice, rate, pitch }, generation);
}

// Speak several texts in a row (e.g. the paragraphs of a reading).
export async function sayAll(texts, opts = {}) {
  stop();
  const mine = generation;
  for (const text of texts) {
    if (mine !== generation) return;
    await speakOne(text, { voice: null, rate: 1, pitch: 1, ...opts }, mine);
  }
}

// Play a dialogue; onLine(i) fires as each line starts so the transcript can highlight it.
// Lines with an `audio` clip play it; the others use voices[0] / voices[1] for speakers A / B.
export async function sayLines(lines, { voices, rate = 1, onLine } = {}) {
  stop();
  const mine = generation;
  const [a, b] = voices || [];
  for (let i = 0; i < lines.length; i++) {
    if (mine !== generation) return;
    onLine?.(i);
    const line = lines[i];
    const isB = line.speaker === 'B';
    if (line.audio) clips.set(clipKey(line.text), line.audio);
    await speakOne(line.text, { voice: isB ? b || a : a, rate, pitch: isB && !b ? 0.8 : 1 }, mine);
    await new Promise((r) => setTimeout(r, 250));
  }
  if (mine === generation) onLine?.(-1);
}

// --- Recording yourself (shadowing) ----------------------------------------------------------

const RECORD_MAX_MS = 20000;
const RECORD_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];

export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

// Record from the microphone until stop() or RECORD_MAX_MS. `done` resolves with an object URL
// of the recording (null if nothing was captured) or rejects with a readable Chinese message.
export async function record() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('無法使用麥克風：請在瀏覽器設定允許這個網站使用麥克風。');
  }
  stop();
  releasePlayer();
  const type = RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    rec.onerror = () => reject(new Error('錄音失敗，請再試一次。'));
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(chunks.length ? URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })) : null);
    };
  });
  rec.start();
  const cap = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, RECORD_MAX_MS);
  return { done, stop: () => { clearTimeout(cap); if (rec.state === 'recording') rec.stop(); } };
}

// Play a recording the learner made (an object URL from record()).
export function playRecording(url) {
  stop();
  const mine = generation;
  return new Promise((resolve) => {
    player ||= new Audio();
    const a = player;
    const finish = () => { a.onended = a.onerror = a.onpause = null; resolve(mine === generation); };
    a.onended = finish;
    a.onpause = finish;
    a.onerror = finish;
    a.src = url;
    a.defaultPlaybackRate = 1;
    a.playbackRate = 1;
    a.play().catch(finish);
  });
}

const STT_ERRORS = {
  'not-allowed': '麥克風權限被拒絕。請在瀏覽器設定允許這個網站使用麥克風。',
  'service-not-allowed': '無法使用語音辨識。iPhone 請到「設定 → 一般 → 鍵盤」開啟「聽寫」。',
  network: '語音辨識需要網路連線。',
  'audio-capture': '找不到麥克風。',
};

// How long recognition may run. Some browsers (notably iPhone Safari) sometimes never fire
// `end`, so listening always finishes on a timer as well.
const NO_SPEECH_MS = 8000; // nothing heard at all
const SILENCE_MS = { short: 2500, long: 4000 }; // quiet after speech: a sentence / an answer
const MAX_MS = { short: 20000, long: 90000 };
const STOP_GRACE_MS = 1500; // after the learner taps stop, wait this long for the browser

let activeRec = null;

// Free the audio channel before the microphone starts: on iPhone a clip that just played can
// keep the audio session in playback mode and the recogniser then hears nothing.
function releasePlayer() {
  if (!player) return;
  player.pause();
  player.removeAttribute('src');
  player.load();
}

// Start recognising English speech. Returns { done, stop }: `done` resolves with the transcript
// (possibly empty) or rejects with a readable Chinese message; it always settles.
export function listen({ continuous = false, onText } = {}) {
  const Rec = recognition();
  if (activeRec) {
    try { activeRec.abort(); } catch { /* already stopped */ }
    activeRec = null;
  }
  stop();
  releasePlayer();
  const kind = continuous ? 'long' : 'short';
  const rec = new Rec();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = continuous;
  let text = '';
  let heard = false;
  let finished = false;
  let quietTimer;
  let graceTimer;
  let settle;
  const done = new Promise((resolve, reject) => { settle = (err) => (err ? reject(err) : resolve(text)); });
  const capTimer = setTimeout(() => finish(), MAX_MS[kind]);
  function finish(err) {
    if (finished) return;
    finished = true;
    clearTimeout(quietTimer);
    clearTimeout(graceTimer);
    clearTimeout(capTimer);
    if (activeRec === rec) activeRec = null;
    try { rec.abort(); } catch { /* already stopped */ }
    settle(err);
  }
  const armQuiet = () => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => finish(), heard ? SILENCE_MS[kind] : NO_SPEECH_MS);
  };
  rec.onresult = (e) => {
    // Rebuild from every result: Safari and Chrome report continuous results differently.
    text = Array.from(e.results, (r) => r[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
    if (text) heard = true;
    onText?.(text);
    armQuiet();
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') finish();
    else finish(new Error(STT_ERRORS[e.error] || `語音辨識錯誤：${e.error}`));
  };
  rec.onend = () => finish();
  try {
    rec.start();
  } catch {
    finish(new Error('麥克風啟動失敗，請再按一次。'));
    return { done, stop: () => {} };
  }
  activeRec = rec;
  armQuiet();
  return {
    done,
    stop: () => {
      try { rec.stop(); } catch { /* already stopped */ }
      clearTimeout(graceTimer);
      graceTimer = setTimeout(() => finish(), STOP_GRACE_MS);
    },
  };
}
