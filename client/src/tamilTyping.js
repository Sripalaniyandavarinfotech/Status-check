// Tamil typing in English letters (phonetic, "Tanglish"), like the Desh and
// Google Tamil keyboards: kavithaa -> கவிதா, thangaraaj -> தங்கராஜ்.
// It all runs in the browser; nothing is sent anywhere.
//
// Long vowels are doubled or capital: aa/A ா, ee/ii/I ீ, oo/uu/U ூ, ae/E ே, oa/O ோ.
// Capitals pick the other letter of a pair: N ண, L ள, R ற, S ஸ, Z ழ.
// zh ழ, sh ஷ, th/d த, t ட, ng ங்க, nj ஞ்ச, nd ந்த, ksh க்ஷ, q ஃ.

const VOWELS = [
  ['aa', 'ஆ', 'ா'], ['ai', 'ஐ', 'ை'], ['au', 'ஔ', 'ௌ'], ['ae', 'ஏ', 'ே'], ['ee', 'ஈ', 'ீ'], ['ii', 'ஈ', 'ீ'],
  ['oo', 'ஊ', 'ூ'], ['uu', 'ஊ', 'ூ'], ['oa', 'ஓ', 'ோ'], ['ou', 'ஔ', 'ௌ'],
  ['A', 'ஆ', 'ா'], ['I', 'ஈ', 'ீ'], ['U', 'ஊ', 'ூ'], ['E', 'ஏ', 'ே'], ['O', 'ஓ', 'ோ'],
  ['a', 'அ', ''], ['i', 'இ', 'ி'], ['u', 'உ', 'ு'], ['e', 'எ', 'ெ'], ['o', 'ஒ', 'ொ'],
];

// Each consonant is one or more letters; a vowel joins the last one.
const CONSONANTS = [
  ['ksh', ['க்ஷ']], ['nth', ['ந', 'த']], ['ndh', ['ந', 'த']],
  ['ng', ['ங', 'க']], ['nj', ['ஞ', 'ச']], ['nd', ['ந', 'த']],
  ['th', ['த']], ['dh', ['த']], ['ch', ['ச']], ['sh', ['ஷ']], ['zh', ['ழ']], ['rr', ['ற']],
  ['kh', ['க']], ['gh', ['க']], ['bh', ['ப']], ['ph', ['ப']], ['jh', ['ஜ']],
  ['k', ['க']], ['g', ['க']], ['c', ['க']], ['s', ['ச']], ['S', ['ஸ']], ['j', ['ஜ']], ['J', ['ஜ']],
  ['t', ['ட']], ['T', ['ட']], ['d', ['த']], ['D', ['ட']], ['N', ['ண']], ['p', ['ப']], ['b', ['ப']],
  ['m', ['ம']], ['y', ['ய']], ['r', ['ர']], ['R', ['ற']], ['l', ['ல']], ['L', ['ள']], ['v', ['வ']],
  ['w', ['வ']], ['h', ['ஹ']], ['f', ['ஃப']], ['x', ['க', 'ஸ']], ['z', ['ஸ']], ['Z', ['ழ']],
];

const KEEP_CASE = new Set(['A', 'I', 'U', 'E', 'O', 'N', 'L', 'R', 'S', 'Z', 'T', 'D', 'J']);
const PULLI = '்';

const matchAt = (word, i, list) => list.find(([roman]) => word.startsWith(roman, i));

// One word in English letters to Tamil.
export function toTamil(input) {
  // Capitals only matter for the letters that have a pair; others are the same as small.
  const word = [...String(input || '')].map((ch, i) => (i > 0 && KEEP_CASE.has(ch) ? ch : ch.toLowerCase())).join('');
  let out = '';
  let pending = null; // consonant letters waiting for a vowel
  const flush = () => {
    if (pending) out += pending.map(b => b + PULLI).join('');
    pending = null;
  };
  for (let i = 0; i < word.length;) {
    const v = matchAt(word, i, VOWELS);
    if (v) {
      if (pending) {
        out += pending.slice(0, -1).map(b => b + PULLI).join('') + pending[pending.length - 1] + v[2];
        pending = null;
      } else out += v[1];
      i += v[0].length;
      continue;
    }
    if (word[i] === 'q') { flush(); out += 'ஃ'; i += 1; continue; }
    // n is ந at the start of a word and ன inside it, as in Tamil spelling.
    if (word[i] === 'n' && !matchAt(word, i, CONSONANTS.filter(c => c[0].length > 1 && c[0][0] === 'n'))) {
      const start = out === '' && !pending;
      flush();
      pending = [start ? 'ந' : 'ன'];
      i += 1;
      continue;
    }
    const c = matchAt(word, i, CONSONANTS);
    if (c) { flush(); pending = [...c[1]]; i += c[0].length; continue; }
    flush();
    out += word[i];
    i += 1;
  }
  flush();
  return out;
}

// A whole phrase, word by word.
export const phraseToTamil = text => String(text || '').split(/(\s+)/).map(part => (/^\s+$/.test(part) || /[஀-௿]/.test(part) ? part : toTamil(part))).join('');



// ---- Suggestions, like the Desh keyboard ----
// Names are matched by how they sound, so "kavitha" finds கவிதா and "pradeep"
// finds பிரதீப் without typing long vowels or the exact n/ண/ன, l/ள, r/ற.

// Both English letters and Tamil are reduced to the same rough sound.
function squash(s) {
  return s
    .replace(/(.)\1+/g, '$1') // kk -> k, nn -> n
    .replace(/([kstpmnvlr])[iu](?=r)/g, '$1') // பிர / pr, ப்பிர / br: Tamil adds a vowel before r
    .replace(/i(?=[aeou])/g, 'iy'); // ia / iya: Pandian, Priya
}

export function romanKey(word) {
  const w = String(word || '').toLowerCase()
    .replace(/([^aeiou])y$/, '$1i')
    .replace(/ee|ii/g, 'i').replace(/oo|uu/g, 'u').replace(/aa/g, 'a').replace(/ae/g, 'e').replace(/oa/g, 'o').replace(/ou/g, 'au')
    .replace(/ow(?![aeiou])/g, 'au').replace(/ch/g, 's').replace(/zh/g, 'l').replace(/([ktdpbgsj])h/g, '$1')
    .replace(/sh|ch|[jz]/g, 's').replace(/x/g, 'ks').replace(/[cgq]/g, 'k').replace(/d/g, 't').replace(/[bf]/g, 'p').replace(/w/g, 'v')
    .replace(/[^a-z]/g, '');
  return squash(w);
}

const T_VOWEL = { 'அ': 'a', 'ஆ': 'a', 'இ': 'i', 'ஈ': 'i', 'உ': 'u', 'ஊ': 'u', 'எ': 'e', 'ஏ': 'e', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'o', 'ஔ': 'au' };
const T_SIGN = { 'ா': 'a', 'ி': 'i', 'ீ': 'i', 'ு': 'u', 'ூ': 'u', 'ெ': 'e', 'ே': 'e', 'ை': 'ai', 'ொ': 'o', 'ோ': 'o', 'ௌ': 'au', '்': '' };
const T_CONS = {
  'க': 'k', 'ங': 'n', 'ச': 's', 'ஜ': 's', 'ஞ': 'n', 'ட': 't', 'ண': 'n', 'த': 't', 'ந': 'n', 'ப': 'p', 'ம': 'm', 'ய': 'y',
  'ர': 'r', 'ல': 'l', 'வ': 'v', 'ழ': 'l', 'ள': 'l', 'ற': 'r', 'ன': 'n', 'ஷ': 's', 'ஸ': 's', 'ஹ': 'h', 'ஃ': 'k',
};

export function tamilKey(word) {
  let out = '';
  for (const ch of String(word || '')) {
    if (T_CONS[ch]) out += `${T_CONS[ch]}a`;
    else if (ch in T_SIGN) out = out.replace(/a$/, '') + T_SIGN[ch];
    else if (T_VOWEL[ch]) out += T_VOWEL[ch];
  }
  return squash(out);
}

let index = null;
async function names() {
  if (!index) {
    const { TAMIL_NAMES } = await import('./tamilNames.js');
    index = TAMIL_NAMES.map(name => ({ name, key: tamilKey(name) }));
  }
  return index;
}
// Loads the names list early, so the first suggestion is instant.
export const loadNames = () => names();

// The usual Tamil spelling of a word typed the everyday way: a final "a" is long
// (Kavitha), a final "y" is ி (Ramasamy), and a leading "pr"/"kr" gets its ி/ு.
export function natural(roman) {
  const w = String(roman || '').toLowerCase()
    .replace(/([^aeiou])a$/, '$1aa').replace(/([^aeiou])y$/, '$1i')
    .replace(/^t(?!h)/, 'th') // Tamil words rarely start with ட: tamil -> தமிழ்
    .replace(/^([pbtdmkg])r(?=[aeiou])/, '$1ir').replace(/i(?=[aou])/g, 'iy').replace(/ow(?![aeiou])/g, 'au');
  if (/^(sri|shri|shree|sree)$/.test(w)) return 'ஸ்ரீ';
  return toTamil(w);
}

// Up to `max` Tamil choices for one word: known names that sound the same, then
// names that start the same way, then the spelled-out forms.
export function suggest(roman, max = 6) {
  if (!roman) return [];
  const key = romanKey(roman);
  const list = index || [];
  const exact = list.filter(n => n.key === key).map(n => n.name);
  const starts = key.length >= 3 ? list.filter(n => n.key !== key && n.key.startsWith(key)).map(n => n.name).slice(0, 3) : [];
  const out = [];
  for (const s of [...exact, natural(roman), toTamil(roman), ...starts]) if (s && !out.includes(s)) out.push(s);
  return out.slice(0, max);
}

// A suggestion for the Tamil name from the English one: each word's first choice.
export const nameToTamil = name => String(name || '').trim().split(/\s+/).filter(Boolean)
  .map(w => suggest(w)[0] || natural(w)).join(' ');
