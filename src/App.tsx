import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { AppShellV2 } from './components/v2/AppShellV2';
import { ToastContainer } from './components/ToastContainer';
import { LoginPage } from './pages/LoginPage';
import { DashboardPageV2 } from './pages/v2/DashboardPageV2';
import { TransactionRegisterPageV2 } from './pages/v2/TransactionRegisterPageV2';
import { MonthlySettlementPageV2 } from './pages/v2/MonthlySettlementPageV2';
import { SettingsPageV2 } from './pages/v2/SettingsPageV2';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useApp();
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }
  return <AppShellV2>{children}</AppShellV2>;
};

const RootRedirect: React.FC = () => {
  const { currentUser } = useApp();
  if (!currentUser) return <Navigate to="/login" replace />;
  return <Navigate to="/dashboard" replace />;
};

const LoginRoute: React.FC = () => {
  const { currentUser } = useApp();
  if (currentUser) {
    return <Navigate to="/dashboard" replace />;
  }
  return <LoginPage />;
};

const AppRoutes: React.FC = () => {
  const { isAuthReady } = useApp();
  if (!isAuthReady) return null;
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginRoute />} />

      {/* 핵심 4대 실무 화면 */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPageV2 />
          </ProtectedRoute>
        }
      />
      <Route
        path="/register"
        element={
          <ProtectedRoute>
            <TransactionRegisterPageV2 />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settlements"
        element={
          <ProtectedRoute>
            <MonthlySettlementPageV2 />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPageV2 />
          </ProtectedRoute>
        }
      />

      {/* 구버전(/v2/*, /transactions) 호환 리다이렉트 */}
      <Route path="/v2/dashboard" element={<Navigate to="/dashboard" replace />} />
      <Route path="/v2/register" element={<Navigate to="/register" replace />} />
      <Route path="/v2/settlements" element={<Navigate to="/settlements" replace />} />
      <Route path="/v2/settings" element={<Navigate to="/settings" replace />} />
      <Route path="/transactions" element={<Navigate to="/dashboard" replace />} />
      <Route path="/transactions/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="/requests/*" element={<Navigate to="/register" replace />} />
      <Route path="/admin/*" element={<Navigate to="/settings" replace />} />
      <Route path="/sheets-sync" element={<Navigate to="/settings" replace />} />

      {/* 기타 미정의 경로는 대시보드로 이동 */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
};

export function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppRoutes />
        <ToastContainer />
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
