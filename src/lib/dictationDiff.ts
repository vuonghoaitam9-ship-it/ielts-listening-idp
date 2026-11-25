export type DiffTokenStatus = 'correct' | 'misspelled' | 'missing' | 'extra';

export interface DiffToken {
  word: string;
  expected?: string;
  status: DiffTokenStatus;
}

export interface DictationDiffResult {
  tokens: DiffToken[];
  accuracy: number;
  correctCount: number;
  misspelledCount: number;
  missingCount: number;
  extraCount: number;
  totalExpected: number;
}

const UK_US_SPELLING: Record<string, string> = {
  colour: 'color',
  colours: 'colors',
  coloured: 'colored',
  favour: 'favor',
  favourite: 'favorite',
  centre: 'center',
  centres: 'centers',
  theatre: 'theater',
  metre: 'meter',
  metres: 'meters',
  centimetre: 'centimeter',
  kilometre: 'kilometer',
  litre: 'liter',
  licence: 'license',
  practise: 'practice',
  travelling: 'traveling',
  travelled: 'traveled',
  cancelled: 'canceled',
  cancelling: 'canceling',
  labelling: 'labeling',
  labelled: 'labeled',
  programme: 'program',
  programmes: 'programs',
  catalogue: 'catalog',
  dialogue: 'dialog',
  cheque: 'check',
  organisation: 'organization',
  organise: 'organize',
  recognise: 'recognize',
  realise: 'realize',
  prioritise: 'prioritize',
  fertiliser: 'fertilizer',
  behaviour: 'behavior',
  neighbour: 'neighbor',
  neighbourhood: 'neighborhood',
  harbour: 'harbor',
  ageing: 'aging',
  jewellery: 'jewelry',
  grey: 'gray',
  defence: 'defense',
  offence: 'offense',
  centred: 'centered',
};

const WORD_TO_NUM: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
  first: '1st',
  second: '2nd',
  third: '3rd',
  fourth: '4th',
  fifth: '5th',
  sixth: '6th',
  seventh: '7th',
  eighth: '8th',
  ninth: '9th',
  tenth: '10th',
  eleventh: '11th',
  twelfth: '12th',
  thirteenth: '13th',
  fourteenth: '14th',
  fifteenth: '15th',
  sixteenth: '16th',
  seventeenth: '17th',
  eighteenth: '18th',
  nineteenth: '19th',
  twentieth: '20th',
  thirtieth: '30th',
};

const CONTRACTIONS: Record<string, string[]> = {
  "don't": ['do', 'not'],
  "doesn't": ['does', 'not'],
  "didn't": ['did', 'not'],
  "can't": ['can', 'not'],
  cannot: ['can', 'not'],
  "won't": ['will', 'not'],
  "wouldn't": ['would', 'not'],
  "couldn't": ['could', 'not'],
  "shouldn't": ['should', 'not'],
  "isn't": ['is', 'not'],
  "aren't": ['are', 'not'],
  "wasn't": ['was', 'not'],
  "weren't": ['were', 'not'],
  "haven't": ['have', 'not'],
  "hasn't": ['has', 'not'],
  "hadn't": ['had', 'not'],
  "mustn't": ['must', 'not'],
  "needn't": ['need', 'not'],
  "i'm": ['i', 'am'],
  "you're": ['you', 'are'],
  "we're": ['we', 'are'],
  "they're": ['they', 'are'],
  "it's": ['it', 'is'],
  "that's": ['that', 'is'],
  "there's": ['there', 'is'],
  "here's": ['here', 'is'],
  "what's": ['what', 'is'],
  "who's": ['who', 'is'],
  "where's": ['where', 'is'],
  "he's": ['he', 'is'],
  "she's": ['she', 'is'],
  "i've": ['i', 'have'],
  "you've": ['you', 'have'],
  "we've": ['we', 'have'],
  "they've": ['they', 'have'],
  "i'll": ['i', 'will'],
  "you'll": ['you', 'will'],
  "we'll": ['we', 'will'],
  "they'll": ['they', 'will'],
  "he'll": ['he', 'will'],
  "she'll": ['she', 'will'],
  "it'll": ['it', 'will'],
  "i'd": ['i', 'would'],
  "you'd": ['you', 'would'],
  "we'd": ['we', 'would'],
  "they'd": ['they', 'would'],
  "he'd": ['he', 'would'],
  "she'd": ['she', 'would'],
  "let's": ['let', 'us'],
};

interface AtomToken {
  display: string;
  norm: string;
  groupId: number;
  groupDisplay: string;
}

function normalizeAtomicWord(word: string): string {
  let w = word
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[£$€]+/, '')
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/^[^a-z0-9']+|[^a-z0-9'%]+$/g, '');

  if (UK_US_SPELLING[w]) w = UK_US_SPELLING[w];
  if (WORD_TO_NUM[w]) w = WORD_TO_NUM[w];
  return w;
}

function tokenizeToAtoms(text: string): AtomToken[] {
  const rawWords = text.trim().split(/\s+/).filter(Boolean);
  const atoms: AtomToken[] = [];

  rawWords.forEach((rawWord, groupId) => {
    const cleaned = rawWord
      .replace(/[’‘]/g, "'")
      .replace(/^[£$€]+/, '')
      .replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9'%]+$/g, '');

    if (!cleaned) return;
    const lower = cleaned.toLowerCase();

    // Check contractions
    if (CONTRACTIONS[lower]) {
      for (const part of CONTRACTIONS[lower]) {
        atoms.push({
          display: part,
          norm: part,
          groupId,
          groupDisplay: cleaned,
        });
      }
      return;
    }

    // Split hyphenated or slashed compounds e.g. self-catering -> [self, catering]
    if (/[-–/]/.test(cleaned) && !/^\d+[-/]\d+$/.test(cleaned)) {
      const subParts = cleaned.split(/[-–/]+/).filter(Boolean);
      for (const sp of subParts) {
        const norm = normalizeAtomicWord(sp);
        if (norm) {
          atoms.push({
            display: sp,
            norm,
            groupId,
            groupDisplay: cleaned,
          });
        }
      }
      return;
    }

    // Handle 20% -> [20, percent]
    const pctMatch = lower.match(/^(\d+(?:\.\d+)?)%$/);
    if (pctMatch) {
      atoms.push({ display: pctMatch[1], norm: pctMatch[1], groupId, groupDisplay: cleaned });
      atoms.push({ display: 'percent', norm: 'percent', groupId, groupDisplay: cleaned });
      return;
    }

    const norm = normalizeAtomicWord(cleaned);
    if (norm) {
      atoms.push({
        display: cleaned,
        norm,
        groupId,
        groupDisplay: cleaned,
      });
    }
  });

  return atoms;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function isNearMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen <= 2) return false;
  const dist = levenshtein(a, b);
  return dist <= Math.max(1, Math.floor(maxLen * 0.45));
}

export function computeDictationDiff(
  expectedText: string,
  userText: string
): DictationDiffResult {
  const exp = tokenizeToAtoms(expectedText);
  const usr = tokenizeToAtoms(userText);

  if (exp.length === 0) {
    return {
      tokens: usr.map((u) => ({ word: u.display, status: 'extra' })),
      accuracy: usr.length === 0 ? 100 : 0,
      correctCount: 0,
      misspelledCount: 0,
      missingCount: 0,
      extraCount: usr.length,
      totalExpected: 0,
    };
  }

  const m = exp.length;
  const n = usr.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (exp[i].norm === usr[j].norm) {
        lcs[i][j] = 1 + lcs[i + 1][j + 1];
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  type Op =
    | { kind: 'match'; expIdx: number; usrIdx: number }
    | { kind: 'missing'; expIdx: number }
    | { kind: 'extra'; usrIdx: number };

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (exp[i].norm === usr[j].norm) {
      ops.push({ kind: 'match', expIdx: i, usrIdx: j });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: 'missing', expIdx: i });
      i++;
    } else {
      ops.push({ kind: 'extra', usrIdx: j });
      j++;
    }
  }
  while (i < m) ops.push({ kind: 'missing', expIdx: i++ });
  while (j < n) ops.push({ kind: 'extra', usrIdx: j++ });

  // Count how many atoms each expected groupId has
  const expGroupSize = new Map<number, number>();
  for (const atom of exp) {
    expGroupSize.set(atom.groupId, (expGroupSize.get(atom.groupId) ?? 0) + 1);
  }

  // Raw tokens before merging multi-atom correct groups
  const rawTokens: Array<DiffToken & { expGroupId?: number; expGroupDisplay?: string }> = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].kind === 'match') {
      const mOp = ops[k] as { kind: 'match'; expIdx: number; usrIdx: number };
      const eAtom = exp[mOp.expIdx];
      rawTokens.push({
        word: eAtom.display,
        expected: eAtom.display,
        status: 'correct',
        expGroupId: eAtom.groupId,
        expGroupDisplay: eAtom.groupDisplay,
      });
      k++;
      continue;
    }

    const missRun: number[] = [];
    const extraRun: number[] = [];
    while (k < ops.length && ops[k].kind !== 'match') {
      if (ops[k].kind === 'missing') {
        missRun.push((ops[k] as { kind: 'missing'; expIdx: number }).expIdx);
      } else {
        extraRun.push((ops[k] as { kind: 'extra'; usrIdx: number }).usrIdx);
      }
      k++;
    }

    // Special case: missing atoms belong to a single contraction/compound group (e.g. "don't" -> [do, not]) vs 1 mistyped word (e.g. "dont")
    if (
      missRun.length > 1 &&
      extraRun.length === 1 &&
      missRun.every((idx) => exp[idx].groupId === exp[missRun[0]].groupId)
    ) {
      const gDisp = exp[missRun[0]].groupDisplay;
      const uItem = usr[extraRun[0]];
      const gNoApos = gDisp.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (isNearMatch(gNoApos, uItem.norm)) {
        rawTokens.push({
          word: uItem.display,
          expected: gDisp,
          status: 'misspelled',
        });
        continue;
      }
    }

    let mi = 0;
    let ui = 0;
    while (mi < missRun.length && ui < extraRun.length) {
      const eItem = exp[missRun[mi]];
      const uItem = usr[extraRun[ui]];
      if (
        isNearMatch(eItem.norm, uItem.norm) ||
        (missRun.length === 1 && extraRun.length === 1)
      ) {
        rawTokens.push({
          word: uItem.display,
          expected: eItem.display,
          status: 'misspelled',
        });
        mi++;
        ui++;
      } else {
        rawTokens.push({
          word: eItem.display,
          expected: eItem.display,
          status: 'missing',
        });
        mi++;
      }
    }
    while (mi < missRun.length) {
      const eItem = exp[missRun[mi++]];
      rawTokens.push({
        word: eItem.display,
        expected: eItem.display,
        status: 'missing',
      });
    }
    while (ui < extraRun.length) {
      const uItem = usr[extraRun[ui++]];
      rawTokens.push({
        word: uItem.display,
        status: 'extra',
      });
    }
  }

  // Collapse consecutive 'correct' tokens belonging to the exact same expected word group
  const tokens: DiffToken[] = [];
  let idx = 0;
  while (idx < rawTokens.length) {
    const cur = rawTokens[idx];
    if (cur.status === 'correct' && cur.expGroupId !== undefined) {
      const gid = cur.expGroupId;
      const gSize = expGroupSize.get(gid) ?? 1;
      let runLen = 1;
      while (
        idx + runLen < rawTokens.length &&
        rawTokens[idx + runLen].status === 'correct' &&
        rawTokens[idx + runLen].expGroupId === gid
      ) {
        runLen++;
      }
      if (runLen === gSize && cur.expGroupDisplay) {
        tokens.push({
          word: cur.expGroupDisplay,
          expected: cur.expGroupDisplay,
          status: 'correct',
        });
        idx += runLen;
        continue;
      }
    }
    tokens.push({ word: cur.word, expected: cur.expected, status: cur.status });
    idx++;
  }

  const correctCount = tokens.filter((t) => t.status === 'correct').length;
  const misspelledCount = tokens.filter((t) => t.status === 'misspelled').length;
  const missingCount = tokens.filter((t) => t.status === 'missing').length;
  const extraCount = tokens.filter((t) => t.status === 'extra').length;

  // Use grouped expected token count so collapsed words score fairly
  const totalExpected = correctCount + misspelledCount + missingCount;
  const accuracy =
    totalExpected === 0
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(((correctCount - extraCount * 0.25) / totalExpected) * 100)
          )
        );

  return {
    tokens,
    accuracy,
    correctCount,
    misspelledCount,
    missingCount,
    extraCount,
    totalExpected,
  };
}
