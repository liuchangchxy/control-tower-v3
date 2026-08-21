import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/common/Toast';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { ProfileEditorPage } from './pages/ProfileEditorPage';
import { BenchmarkPage } from './pages/BenchmarkPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ChatPage } from './pages/ChatPage';
import { ExperimentsPage } from './pages/ExperimentsPage';

export default function App() {
  return (
    <ToastProvider>
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
    </ToastProvider>
  );
}
