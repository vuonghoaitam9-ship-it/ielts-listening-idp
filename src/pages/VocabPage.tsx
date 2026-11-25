import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  Download,
  Keyboard,
  Layers,
  Plus,
  RotateCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { SaveVocabModal } from '../components/SaveVocabModal';
import { db } from '../db/database';
import { seedVocabCoreIfNeeded } from '../lib/dataLoader';
import { computeSm2Review, previewSm2IntervalLabel } from '../lib/sm2';
import type { Sm2Rating, VocabCard, VocabCategory } from '../types';

type StudyMode = 'flashcard' | 'spelling';
type FilterScope = 'due' | 'all' | VocabCategory;

const CATEGORY_LABELS: Record<VocabCategory, string> = {
  dates_numbers: 'Ngày tháng & Số liệu',
  places_maps: 'Địa điểm & Bản đồ',
  academic_p3_p4: 'Học thuật Part 3–4',
  paraphrase_pairs: 'Cặp Paraphrase',
  saved_from_test: 'Lưu từ Vol 7–10',
};

export function VocabPage() {
  const [seeded, setSeeded] = useState(false);
  const [scope, setScope] = useState<FilterScope>('due');
  const [studyMode, setStudyMode] = useState<StudyMode>('flashcard');
  const [searchTerm, setSearchTerm] = useState('');
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Spelling practice state
  const [spellingInput, setSpellingInput] = useState('');
  const [spellingChecked, setSpellingChecked] = useState<boolean | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    seedVocabCoreIfNeeded().finally(() => setSeeded(true));
  }, []);

  const allCards = useLiveQuery(() => db.vocabCards.toArray(), [seeded]) ?? [];
  const now = Date.now();

  const dueCount = useMemo(
    () => allCards.filter((c) => c.nextReviewAt <= now).length,
    [allCards, now]
  );

  const filteredDeck = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allCards
      .filter((c) => {
        if (scope === 'due' && c.nextReviewAt > now) return false;
        if (
          scope !== 'due' &&
          scope !== 'all' &&
          c.category !== scope
        ) {
          return false;
        }
        if (q) {
          return (
            c.word.toLowerCase().includes(q) ||
            c.meaningVi.toLowerCase().includes(q) ||
            c.paraphraseNote.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => a.nextReviewAt - b.nextReviewAt);
  }, [allCards, scope, searchTerm, now]);

  const safeIdx = filteredDeck.length > 0 ? Math.min(cardIdx, filteredDeck.length - 1) : 0;
  const currentCard: VocabCard | null = filteredDeck[safeIdx] ?? null;

  useEffect(() => {
    setFlipped(false);
    setSpellingInput('');
    setSpellingChecked(null);
  }, [safeIdx, scope, studyMode]);

  // Space to flip flashcard when not typing in input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (studyMode !== 'flashcard' || !currentCard) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [studyMode, currentCard]);

  const handleRate = async (rating: Sm2Rating) => {
    if (!currentCard) return;
    const outcome = computeSm2Review(currentCard, rating);
    await db.vocabCards.update(currentCard.id, outcome);
    setFlipped(false);
    setSpellingInput('');
    setSpellingChecked(null);
    if (scope !== 'due') {
      setCardIdx((i) => (i + 1 >= filteredDeck.length ? 0 : i + 1));
    } else {
      setCardIdx(0);
    }
  };

  const handleCheckSpelling = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCard) return;
    const normUser = spellingInput.trim().toLowerCase();
    const normWord = currentCard.word.trim().toLowerCase();
    setSpellingChecked(normUser === normWord);
  };

  const handleDeleteCard = async (card: VocabCard) => {
    if (!window.confirm(`Xóa thẻ "${card.word}" khỏi bộ từ vựng?`)) return;
    await db.vocabCards.delete(card.id);
    setCardIdx(0);
  };

  const handleExportDeck = () => {
    const blob = new Blob([JSON.stringify(allCards, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ielts-listening-vocab-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportDeck = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as VocabCard[];
      if (!Array.isArray(data)) throw new Error('Sai định dạng JSON.');
      await db.vocabCards.bulkPut(data);
      setStatusMsg(`Đã nhập ${data.length} thẻ từ vựng.`);
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Lỗi đọc file JSON.');
    }
  };

  return (
    <div className="space-y-5">
      {statusMsg && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-xs text-blue-900">
          {statusMsg}
        </div>
      )}

      {/* Header & Summary */}
      <section className="bg-white border border-slate-300 rounded-md p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Flashcard &amp; Spaced Learning (SM-2) Từ vựng IELTS Listening
            </h1>
            <p className="text-xs text-slate-600">
              Tổng cộng {allCards.length} thẻ · Cần ôn hôm nay:{' '}
              <strong className="text-slate-900">{dueCount} thẻ</strong> · Lưu tiến độ vào IndexedDB
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="px-3 py-1.5 rounded bg-[#0f2942] hover:bg-[#1e3a8a] text-white font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm từ mới</span>
            </button>
            <button
              type="button"
              onClick={handleExportDeck}
              className="px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Sao lưu</span>
            </button>
            <label className="px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Khôi phục</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportDeck}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Filters & Mode Toggle */}
        <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setScope('due');
                setCardIdx(0);
              }}
              className={`px-2.5 py-1 rounded border font-medium cursor-pointer ${
                scope === 'due'
                  ? 'bg-[#0f2942] text-white border-[#0f2942]'
                  : 'bg-white text-slate-700 border-slate-300'
              }`}
            >
              Cần ôn hôm nay ({dueCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setScope('all');
                setCardIdx(0);
              }}
              className={`px-2.5 py-1 rounded border font-medium cursor-pointer ${
                scope === 'all'
                  ? 'bg-[#0f2942] text-white border-[#0f2942]'
                  : 'bg-white text-slate-700 border-slate-300'
              }`}
            >
              Tất cả ({allCards.length})
            </button>
            {(Object.keys(CATEGORY_LABELS) as VocabCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setScope(cat);
                  setCardIdx(0);
                }}
                className={`px-2.5 py-1 rounded border font-medium cursor-pointer ${
                  scope === cat
                    ? 'bg-[#1e40af] text-white border-[#1e40af]'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCardIdx(0);
              }}
              placeholder="Tìm từ, nghĩa, paraphrase..."
              className="px-2.5 py-1 rounded border border-slate-300 text-xs w-48"
            />
            <div className="flex items-center rounded border border-slate-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setStudyMode('flashcard')}
                className={`px-2.5 py-1 flex items-center gap-1 font-medium cursor-pointer ${
                  studyMode === 'flashcard' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Flashcard</span>
              </button>
              <button
                type="button"
                onClick={() => setStudyMode('spelling')}
                className={`px-2.5 py-1 flex items-center gap-1 font-medium cursor-pointer ${
                  studyMode === 'spelling' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
                }`}
              >
                <Keyboard className="w-3.5 h-3.5" />
                <span>Gõ chính tả</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Study Card Area */}
      {filteredDeck.length === 0 ? (
        <div className="bg-white border border-slate-300 rounded-md p-8 text-center space-y-2">
          <div className="text-sm font-semibold text-slate-900">
            {scope === 'due'
              ? 'Bạn đã hoàn thành toàn bộ thẻ cần ôn hôm nay.'
              : 'Không có thẻ từ vựng nào khớp bộ lọc.'}
          </div>
          <p className="text-xs text-slate-600">
            Chuyển sang tab “Tất cả” để ôn thêm hoặc lưu từ mới từ mục Review / Dictation.
          </p>
        </div>
      ) : (
        currentCard && (
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                Thẻ {safeIdx + 1} / {filteredDeck.length} ·{' '}
                <strong className="text-slate-800">
                  {CATEGORY_LABELS[currentCard.category]}
                </strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCardIdx((i) => Math.max(0, i - 1))}
                  disabled={safeIdx <= 0}
                  className="px-2 py-0.5 rounded border border-slate-300 bg-white disabled:opacity-40 cursor-pointer"
                >
                  Thẻ trước
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCardIdx((i) => (i + 1 >= filteredDeck.length ? 0 : i + 1))
                  }
                  className="px-2 py-0.5 rounded border border-slate-300 bg-white cursor-pointer"
                >
                  Bỏ qua
                </button>
                {currentCard.source === 'user' && (
                  <button
                    type="button"
                    onClick={() => handleDeleteCard(currentCard)}
                    className="p-1 rounded border border-slate-300 text-red-700 hover:bg-red-50 cursor-pointer"
                    title="Xóa thẻ cá nhân"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Card Box */}
            {studyMode === 'flashcard' ? (
              <div
                onClick={() => setFlipped((f) => !f)}
                className="bg-white border border-slate-300 rounded-md p-6 min-h-[260px] flex flex-col justify-between cursor-pointer select-none hover:border-slate-400 transition-colors"
              >
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{flipped ? 'Mặt sau · Nghĩa & Ngữ cảnh' : 'Mặt trước · Nhấn hoặc bấm Space để lật'}</span>
                  <span className="inline-flex items-center gap-1">
                    <RotateCw className="w-3 h-3" /> Lật thẻ
                  </span>
                </div>

                {!flipped ? (
                  <div className="py-10 text-center space-y-2">
                    <div className="text-3xl font-bold text-slate-900 tracking-tight">
                      {currentCard.word}
                    </div>
                    <div className="text-sm text-slate-500">
                      {currentCard.ipa && <span className="font-mono mr-2">{currentCard.ipa}</span>}
                      {currentCard.partOfSpeech && (
                        <span className="italic">({currentCard.partOfSpeech})</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="py-4 space-y-3">
                    <div>
                      <div className="text-xl font-bold text-slate-900">
                        {currentCard.word}{' '}
                        <span className="text-sm font-normal text-slate-500 font-mono">
                          {currentCard.ipa}
                        </span>
                      </div>
                      <div className="text-base font-semibold text-[#1e40af] mt-1">
                        {currentCard.meaningVi}
                      </div>
                    </div>

                    {currentCard.exampleEn && (
                      <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-800">
                        <span className="font-semibold">Ví dụ: </span>
                        {currentCard.exampleEn}
                      </div>
                    )}

                    {currentCard.paraphraseNote && (
                      <div className="text-xs text-slate-700">
                        <span className="font-semibold">Paraphrase / Ghi chú: </span>
                        {currentCard.paraphraseNote}
                      </div>
                    )}

                    {currentCard.spellingTrap && (
                      <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                        <span className="font-semibold">Lưu ý chính tả: </span>
                        {currentCard.spellingTrap}
                      </div>
                    )}
                  </div>
                )}

                <div className="text-[11px] text-slate-400 flex items-center justify-between pt-2 border-t border-slate-100">
                  <span>Lặp: {currentCard.repetitions} lần · Hệ số EF: {currentCard.easeFactor}</span>
                  <span>Khoảng cách hiện tại: {currentCard.intervalDays} ngày</span>
                </div>
              </div>
            ) : (
              /* Spelling Practice Mode */
              <div className="bg-white border border-slate-300 rounded-md p-6 space-y-4">
                <div className="text-xs text-slate-500">
                  Kiểm tra gõ chính tả (Spelling Practice)
                </div>

                <div className="space-y-1.5">
                  <div className="text-lg font-bold text-slate-900">
                    {currentCard.meaningVi}
                  </div>
                  <div className="text-xs text-slate-600">
                    {currentCard.ipa && <span className="font-mono mr-2">{currentCard.ipa}</span>}
                    <span>({currentCard.partOfSpeech})</span>
                  </div>
                  {currentCard.exampleEn && (
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700">
                      Ngữ cảnh:{' '}
                      {currentCard.exampleEn.replace(
                        new RegExp(currentCard.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'),
                        '______'
                      )}
                    </div>
                  )}
                </div>

                <form onSubmit={handleCheckSpelling} className="flex gap-2">
                  <input
                    type="text"
                    value={spellingInput}
                    onChange={(e) => setSpellingInput(e.target.value)}
                    placeholder="Gõ chính xác từ tiếng Anh..."
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 px-3 py-2 rounded border border-slate-300 text-sm focus:outline-2 focus:outline-[#1e40af]"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-[#0f2942] text-white text-xs font-semibold cursor-pointer"
                  >
                    Kiểm tra
                  </button>
                </form>

                {spellingChecked !== null && (
                  <div
                    className={`p-3 rounded border text-xs space-y-1.5 ${
                      spellingChecked
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : 'bg-red-50 border-red-300 text-red-900'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      {spellingChecked ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>Chính xác: {currentCard.word}</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-red-600" />
                          <span>
                            Chưa đúng. Đáp án chuẩn: <strong className="underline">{currentCard.word}</strong>
                          </span>
                        </>
                      )}
                    </div>
                    {currentCard.spellingTrap && (
                      <div>Bẫy chính tả: {currentCard.spellingTrap}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SM-2 Rating Buttons */}
            <div className="bg-white border border-slate-300 rounded-md p-3">
              <div className="text-[11px] text-slate-500 text-center mb-2">
                Đánh giá mức độ ghi nhớ (SM-2 tự động hẹn ngày ôn lại)
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {(
                  [
                    ['again', 'Quên', 'border-red-300 bg-red-50 text-red-900 hover:bg-red-100'],
                    ['hard', 'Khó', 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'],
                    ['good', 'Tốt', 'border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100'],
                    ['easy', 'Dễ', 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'],
                  ] as [Sm2Rating, string, string][]
                ).map(([rating, label, cls]) => (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => handleRate(rating)}
                    className={`py-2 px-2 rounded border font-semibold text-center cursor-pointer ${cls}`}
                  >
                    <div>{label}</div>
                    <div className="text-[11px] font-normal opacity-80">
                      {previewSm2IntervalLabel(currentCard, rating)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {showAddModal && (
        <SaveVocabModal
          initialWord=""
          initialExample=""
          onClose={() => setShowAddModal(false)}
          onSaved={(w) => {
            setStatusMsg(`Đã thêm "${w}" vào bộ Flashcard.`);
            setTimeout(() => setStatusMsg(null), 3000);
          }}
        />
      )}
    </div>
  );
}
