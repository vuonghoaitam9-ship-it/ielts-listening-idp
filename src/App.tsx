import { HashRouter, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { DataManagerPage } from './pages/DataManagerPage';
import { DictationPage } from './pages/DictationPage';
import { ExamPage } from './pages/ExamPage';
import { HomePage } from './pages/HomePage';
import { ReadingExamPage } from './pages/ReadingExamPage';
import { ReadingListPage } from './pages/ReadingListPage';
import { VocabPage } from './pages/VocabPage';

function KeyedExamRoute() {
  const { vol, test } = useParams();
  const [searchParams] = useSearchParams();
  return <ExamPage key={`${vol}-${test}-${searchParams.get('attemptId') ?? ''}`} />;
}

function KeyedReadingExamRoute() {
  const { vol, test } = useParams();
  const [searchParams] = useSearchParams();
  return (
    <ReadingExamPage
      key={`${vol}-${test}-${searchParams.get('attemptId') ?? ''}-${searchParams.get('mode') ?? ''}`}
    />
  );
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/exam/:vol/:test" element={<KeyedExamRoute />} />
        <Route path="/reading/:vol/:test" element={<KeyedReadingExamRoute />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/reading" element={<ReadingListPage />} />
          <Route path="/dictation" element={<DictationPage />} />
          <Route path="/dictation/:vol/:test" element={<DictationPage />} />
          <Route path="/vocab" element={<VocabPage />} />
          <Route path="/data" element={<DataManagerPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
