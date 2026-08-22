import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/common/Toast';
import { Spinner } from './components/common/Spinner';
import { ErrorBoundary } from './components/common/ErrorBoundary';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ProfilesPage = lazy(() => import('./pages/ProfilesPage').then(m => ({ default: m.ProfilesPage })));
const ProfileEditorPage = lazy(() => import('./pages/ProfileEditorPage').then(m => ({ default: m.ProfileEditorPage })));
const BenchmarkPage = lazy(() => import('./pages/BenchmarkPage').then(m => ({ default: m.BenchmarkPage })));
const LogsPage = lazy(() => import('./pages/LogsPage').then(m => ({ default: m.LogsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })));
const ExperimentsPage = lazy(() => import('./pages/ExperimentsPage').then(m => ({ default: m.ExperimentsPage })));

function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner size="lg" className="text-accent" />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/profiles" element={<ProfilesPage />} />
              <Route path="/profiles/new" element={<ProfileEditorPage />} />
              <Route path="/profiles/:name/edit" element={<ProfileEditorPage />} />
              <Route path="/benchmark" element={<BenchmarkPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/experiments" element={<ExperimentsPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </ToastProvider>
  );
}
