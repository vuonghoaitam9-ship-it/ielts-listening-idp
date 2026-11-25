import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { db } from '../db/database';
import type { VocabCard } from '../types';

interface SaveVocabModalProps {
  initialWord: string;
  initialExample: string;
  sourceTestId?: string;
  onClose: () => void;
  onSaved?: (word: string) => void;
}

export function SaveVocabModal({
  initialWord,
  initialExample,
  sourceTestId,
  onClose,
  onSaved,
}: SaveVocabModalProps) {
  const [word, setWord] = useState(initialWord);
  const [ipa, setIpa] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('noun');
  const [meaningVi, setMeaningVi] = useState('');
  const [exampleEn, setExampleEn] = useState(initialExample);
  const [paraphraseNote, setParaphraseNote] = useState('');
  const [spellingTrap, setSpellingTrap] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim() || !meaningVi.trim()) {
      setErr('Vui lòng nhập từ tiếng Anh và nghĩa tiếng Việt.');
      return;
    }
    setSaving(true);
    const now = Date.now();
    const card: VocabCard = {
      id: `user-${now}-${Math.random().toString(36).slice(2, 7)}`,
      word: word.trim(),
      ipa: ipa.trim(),
      partOfSpeech: partOfSpeech.trim() || 'phrase',
      meaningVi: meaningVi.trim(),
      exampleEn: exampleEn.trim(),
      paraphraseNote: paraphraseNote.trim(),
      spellingTrap: spellingTrap.trim(),
      category: 'saved_from_test',
      source: 'user',
      sourceTestId,
      repetitions: 0,
      intervalDays: 0,
      easeFactor: 2.5,
      nextReviewAt: now,
      createdAt: now,
    };
    await db.vocabCards.put(card);
    setSaving(false);
    onSaved?.(card.word);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white text-slate-900 border border-slate-300 rounded-md shadow-lg w-full max-w-lg">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Lưu từ vựng vào Flashcard SM-2</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 space-y-3 text-xs">
          {err && (
            <div className="p-2 rounded bg-red-50 border border-red-300 text-red-700">{err}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <label className="block sm:col-span-2">
              <span className="font-medium text-slate-700 block mb-1">Từ / Cụm từ tiếng Anh *</span>
              <input
                type="text"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                required
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700 block mb-1">Loại từ</span>
              <input
                type="text"
                value={partOfSpeech}
                onChange={(e) => setPartOfSpeech(e.target.value)}
                placeholder="noun / verb / adj"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="block">
              <span className="font-medium text-slate-700 block mb-1">Nghĩa tiếng Việt *</span>
              <input
                type="text"
                value={meaningVi}
                onChange={(e) => setMeaningVi(e.target.value)}
                placeholder="VD: sự bảo trì"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                required
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700 block mb-1">Phiên âm IPA (tùy chọn)</span>
              <input
                type="text"
                value={ipa}
                onChange={(e) => setIpa(e.target.value)}
                placeholder="/ˈmeɪntənəns/"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
            </label>
          </div>

          <label className="block">
            <span className="font-medium text-slate-700 block mb-1">Ngữ cảnh trong bài nghe</span>
            <textarea
              rows={2}
              value={exampleEn}
              onChange={(e) => setExampleEn(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="block">
              <span className="font-medium text-slate-700 block mb-1">Ghi chú Paraphrase</span>
              <input
                type="text"
                value={paraphraseNote}
                onChange={(e) => setParaphraseNote(e.target.value)}
                placeholder="VD: repair / upkeep"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700 block mb-1">Lưu ý chính tả</span>
              <input
                type="text"
                value={spellingTrap}
                onChange={(e) => setSpellingTrap(e.target.value)}
                placeholder="VD: hay sai chữ 'e' giữa"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
            </label>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-100 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 rounded bg-[#0f2942] hover:bg-[#1e3a8a] text-white font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{saving ? 'Đang lưu...' : 'Lưu Flashcard'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
