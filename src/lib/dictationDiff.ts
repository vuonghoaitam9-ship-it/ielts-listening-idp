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

function normalizeToken(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
}

function tokenizeDisplay(text: string): { display: string; norm: string }[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((display) => ({ display, norm: normalizeToken(display) }))
    .filter((item) => item.norm.length > 0);
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

export function computeDictationDiff(expectedText: string, userText: string): DictationDiffResult {
  const exp = tokenizeDisplay(expectedText);
  const usr = tokenizeDisplay(userText);

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
  // LCS table on exact normalized tokens
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

  // Reconstruct raw alignment ops: match | skip_exp | skip_usr
  type Op = { kind: 'match'; expIdx: number; usrIdx: number } | { kind: 'missing'; expIdx: number } | { kind: 'extra'; usrIdx: number };
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
  while (i < m) {
    ops.push({ kind: 'missing', expIdx: i++ });
  }
  while (j < n) {
    ops.push({ kind: 'extra', usrIdx: j++ });
  }

  // Pair adjacent missing+extra runs as misspelled when lexically close (or 1-to-1)
  const tokens: DiffToken[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].kind === 'match') {
      const mOp = ops[k] as { kind: 'match'; expIdx: number; usrIdx: number };
      tokens.push({ word: exp[mOp.expIdx].display, expected: exp[mOp.expIdx].display, status: 'correct' });
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

    // Greedily pair missing & extra within the gap
    let mi = 0;
    let ui = 0;
    while (mi < missRun.length && ui < extraRun.length) {
      const eItem = exp[missRun[mi]];
      const uItem = usr[extraRun[ui]];
      if (isNearMatch(eItem.norm, uItem.norm) || (missRun.length === 1 && extraRun.length === 1)) {
        tokens.push({ word: uItem.display, expected: eItem.display, status: 'misspelled' });
        mi++;
        ui++;
      } else {
        tokens.push({ word: eItem.display, expected: eItem.display, status: 'missing' });
        mi++;
      }
    }
    while (mi < missRun.length) {
      const eItem = exp[missRun[mi++]];
      tokens.push({ word: eItem.display, expected: eItem.display, status: 'missing' });
    }
    while (ui < extraRun.length) {
      const uItem = usr[extraRun[ui++]];
      tokens.push({ word: uItem.display, status: 'extra' });
    }
  }

  const correctCount = tokens.filter((t) => t.status === 'correct').length;
  const misspelledCount = tokens.filter((t) => t.status === 'misspelled').length;
  const missingCount = tokens.filter((t) => t.status === 'missing').length;
  const extraCount = tokens.filter((t) => t.status === 'extra').length;

  const accuracy = Math.max(
    0,
    Math.min(100, Math.round(((correctCount - extraCount * 0.25) / exp.length) * 100))
  );

  return {
    tokens,
    accuracy,
    correctCount,
    misspelledCount,
    missingCount,
    extraCount,
    totalExpected: exp.length,
  };
}
