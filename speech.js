// Browser text-to-speech (listening) and speech recognition (speaking). Both are optional:
// callers check ttsSupported() / sttSupported() and fall back to text when missing.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
const Recognition = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : undefined;

const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|eddy|flo|fred|good news|grandma|grandpa|hysterical|jester|junior|kathy|organ|pipe|ralph|reed|rocko|sandy|shelley|superstar|trinoids|whisper|wobble|zarvox/i;

export const ttsSupported = () => Boolean(synth);
export const sttSupported = () => Boolean(Recognition);

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

// Speak `text`; resolves when finished or when stop() is called.
export async function say(text, { voice = null, rate = 1, pitch = 1 } = {}) {
  if (!synth) return;
  stop();
  const mine = generation;
  for (const part of sentences(text)) {
    if (mine !== generation) return;
    await utter(part, { voice, rate, pitch });
  }
}

// Play a dialogue; onLine(i) fires as each line starts so the transcript can highlight it.
export async function sayLines(lines, { voices, rate = 1, onLine } = {}) {
  if (!synth) return;
  stop();
  const mine = generation;
  const [a, b] = voices || [];
  for (let i = 0; i < lines.length; i++) {
    if (mine !== generation) return;
    onLine?.(i);
    const isB = lines[i].speaker === 'B';
    const voice = isB ? b || a : a;
    const pitch = isB && !b ? 0.8 : 1;
    for (const part of sentences(lines[i].text)) {
      if (mine !== generation) return;
      await utter(part, { voice, rate, pitch });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (mine === generation) onLine?.(-1);
}

const STT_ERRORS = {
  'not-allowed': '麥克風權限被拒絕。請在瀏覽器設定允許這個網站使用麥克風。',
  'service-not-allowed': '無法使用語音辨識。iPhone 請到「設定 → 一般 → 鍵盤」開啟「聽寫」。',
  network: '語音辨識需要網路連線。',
  'audio-capture': '找不到麥克風。',
};

// Start recognising English speech. Returns { done, stop }: `done` resolves with the final
// transcript when recognition ends, or rejects with a readable Chinese message.
export function listen({ continuous = false, onText } = {}) {
  const rec = new Recognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = continuous;
  let text = '';
  const done = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      // Rebuild from every result: Safari and Chrome report continuous results differently.
      text = Array.from(e.results, (r) => r[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
      onText?.(text);
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') reject(new Error(STT_ERRORS[e.error] || `語音辨識錯誤：${e.error}`));
    };
    rec.onend = () => resolve(text);
  });
  stop();
  rec.start();
  return { done, stop: () => rec.stop() };
}
