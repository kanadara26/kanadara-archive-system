import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { AppShell } from './components/AppShell';
import { AppShellV2 } from './components/v2/AppShellV2';
import { ToastContainer } from './components/ToastContainer';
import { LoginPage } from './pages/LoginPage';
import { TransactionListPage } from './pages/TransactionListPage';
import { DashboardPageV2 } from './pages/v2/DashboardPageV2';
import { TransactionRegisterPageV2 } from './pages/v2/TransactionRegisterPageV2';
import { MonthlySettlementPageV2 } from './pages/v2/MonthlySettlementPageV2';
import { SettingsPageV2 } from './pages/v2/SettingsPageV2';

// Route-level code-splitting for Ver 1 secondary and admin pages
const TransactionDetailPage = lazy(() =>
  import('./pages/TransactionDetailPage').then((m) => ({ default: m.TransactionDetailPage }))
);
const SheetsSyncPage = lazy(() =>
  import('./pages/SheetsSyncPage').then((m) => ({ default: m.SheetsSyncPage }))
);
const SettlementPage = lazy(() =>
  import('./pages/SettlementPage').then((m) => ({ default: m.SettlementPage }))
);
const AdminOverviewPage = lazy(() =>
  import('./pages/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage }))
);
const UserManagementPage = lazy(() =>
  import('./pages/UserManagementPage').then((m) => ({ default: m.UserManagementPage }))
);
const AssignmentPage = lazy(() =>
  import('./pages/AssignmentPage').then((m) => ({ default: m.AssignmentPage }))
);
const ConditionManagementPage = lazy(() =>
  import('./pages/ConditionManagementPage').then((m) => ({ default: m.ConditionManagementPage }))
);

const PageFallback: React.FC = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
      <span>페이지를 불러오는 중입니다...</span>
    </div>
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useApp();
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }
  return <AppShell>{children}</AppShell>;
};

const ProtectedRouteV2: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useApp();
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }
  return <AppShellV2>{children}</AppShellV2>;
};

const RootRedirect: React.FC = () => {
  const { currentUser, appVersion } = useApp();
  if (!currentUser) return <Navigate to="/login" replace />;
  if (appVersion === 'v2') {
    return <Navigate to="/v2/dashboard" replace />;
  }
  if (currentUser.role === 'ADMIN') return <Navigate to="/admin/overview" replace />;
  return <Navigate to="/transactions" replace />;
};

const LoginRoute: React.FC = () => {
  const { currentUser, appVersion } = useApp();
  if (currentUser) {
    if (appVersion === 'v2') {
      return <Navigate to="/v2/dashboard" replace />;
    }
    return (
      <Navigate
        to={currentUser.role === 'ADMIN' ? '/admin/overview' : '/transactions'}
        replace
      />
    );
  }
  return <LoginPage />;
};

const AppRoutes: React.FC = () => {
  return (
    <>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginRoute />} />

          {/* =============================================================== */}
          {/* Ver 2 (AG 간소화 버전 - 대시보드 + 3대 핵심 페이지) */}
          {/* =============================================================== */}
          <Route
            path="/v2/dashboard"
            element={
              <ProtectedRouteV2>
                <DashboardPageV2 />
              </ProtectedRouteV2>
            }
          />
          <Route
            path="/v2/register"
            element={
              <ProtectedRouteV2>
                <TransactionRegisterPageV2 />
              </ProtectedRouteV2>
            }
          />
          <Route
            path="/v2/settlements"
            element={
              <ProtectedRouteV2>
                <MonthlySettlementPageV2 />
              </ProtectedRouteV2>
            }
          />
          <Route
            path="/v2/settings"
            element={
              <ProtectedRouteV2>
                <SettingsPageV2 />
              </ProtectedRouteV2>
            }
          />

          {/* =============================================================== */}
          {/* Ver 1 (기존 전체 기능 버전 - 그대로 보존) */}
          {/* =============================================================== */}
          <Route
            path="/transactions"
            element={
              <ProtectedRoute>
                <TransactionListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/requests/new"
            element={<Navigate to="/transactions" replace />}
          />
          <Route
            path="/transactions/:id"
            element={
              <ProtectedRoute>
                <TransactionDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sheets-sync"
            element={
              <ProtectedRoute>
                <SheetsSyncPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settlements"
            element={
              <ProtectedRoute>
                <SettlementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/overview"
            element={
              <ProtectedRoute>
                <AdminOverviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute>
                <UserManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/assignments"
            element={
              <ProtectedRoute>
                <AssignmentPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/conditions"
            element={
              <ProtectedRoute>
                <ConditionManagementPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </Suspense>
      <ToastContainer />
    </>
  );
};

export const App: React.FC = () => {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProvider>
  );
};

export default App;
