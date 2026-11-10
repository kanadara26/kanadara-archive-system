import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { RoleBadge } from './StatusBadges';
import {
  LayoutDashboard,
  FileText,
  FileSpreadsheet,
  Calculator,
  Users,
  Link2,
  Sliders,
  LogOut,
  RotateCcw,
  Menu,
  X,
  ShieldCheck,
  ArrowRightLeft,
  Columns2,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  badge?: number;
  badgeColor?: 'amber' | 'rose' | 'indigo';
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    currentUser,
    users,
    accessibleTransactions,
    systemReferenceDate,
    isRateTableSplitOpen,
    setRateTableSplitOpen,
    toggleRateTableSplit,
    getAssignedAgForCm,
    getAssignedCmsForAg,
    quickSwitchUser,
    logout,
    resetDemoData,
    setAppVersion,
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [confirmResetDemo, setConfirmResetDemo] = useState(false);

  if (!currentUser) return <>{children}</>;

  const waitingCount = accessibleTransactions.filter((t) => t.status === 'WAITING').length;
  const reviewingCount = accessibleTransactions.filter((t) => t.status === 'REVIEWING').length;
  const pendingSlipCount = accessibleTransactions.filter(
    (t) => (t.status === 'APPROVED' || t.status === 'SLIP_REQUIRED') && !t.slip
  ).length;
  const failedSheetCount = accessibleTransactions.filter(
    (t) => t.slip && t.sheetSync.status === 'FAILED'
  ).length;

  const navItems: NavItem[] = [];

  if (currentUser.role === 'CM') {
    navItems.push({
      to: '/transactions',
      label: '내 거래 내역 (CM 홈)',
      icon: FileText,
      badge: pendingSlipCount > 0 ? pendingSlipCount : undefined,
      badgeColor: 'indigo',
    });
  } else if (currentUser.role === 'AG') {
    navItems.push(
      {
        to: '/transactions',
        label: '거래 승인요청 · 작업목록',
        icon: FileText,
        badge: waitingCount + reviewingCount > 0 ? waitingCount + reviewingCount : undefined,
        badgeColor: 'amber',
      },
      {
        to: '/sheets-sync',
        label: '구글 시트 연동·재처리',
        icon: FileSpreadsheet,
        badge: failedSheetCount > 0 ? failedSheetCount : undefined,
        badgeColor: 'rose',
      },
      {
        to: '/settlements',
        label: '월별 수수료 정산·추출',
        icon: Calculator,
      },
      {
        to: '/admin/conditions',
        label: '거래 조건 · 시트 연동',
        icon: Sliders,
      },
      {
        to: '/admin/users',
        label: '사용자·CM 정보 관리',
        icon: Users,
      },
      {
        to: '/admin/assignments',
        label: 'AG 담당 CM 배정',
        icon: Link2,
      }
    );
  } else if (currentUser.role === 'ADMIN') {
    navItems.push(
      {
        to: '/admin/overview',
        label: '운영 관리자 홈',
        icon: LayoutDashboard,
      },
      {
        to: '/transactions',
        label: '승인요청 · 전체 거래목록',
        icon: FileText,
        badge: waitingCount > 0 ? waitingCount : undefined,
        badgeColor: 'amber',
      },
      {
        to: '/sheets-sync',
        label: '구글 시트 연동·재처리',
        icon: FileSpreadsheet,
        badge: failedSheetCount > 0 ? failedSheetCount : undefined,
        badgeColor: 'rose',
      },
      {
        to: '/settlements',
        label: '월별 수수료 정산·추출',
        icon: Calculator,
      },
      {
        to: '/admin/users',
        label: '사용자·CM 정보 관리',
        icon: Users,
      },
      {
        to: '/admin/assignments',
        label: '담당 CM 배정 관리',
        icon: Link2,
      },
      {
        to: '/admin/conditions',
        label: '거래 조건 · 시트 연동',
        icon: Sliders,
      }
    );
  }

  const assignedAg =
    currentUser.role === 'CM' ? getAssignedAgForCm(currentUser.id) : undefined;
  const assignedCms =
    currentUser.role === 'AG' ? getAssignedCmsForAg(currentUser.id) : [];

  const handleRoleSwitch = (userId: string) => {
    const target = users.find((u) => u.id === userId);
    if (!target) return;
    quickSwitchUser(userId);
    if (target.role === 'ADMIN') {
      navigate('/admin/overview');
    } else {
      navigate('/transactions');
    }
    setMobileMenuOpen(false);
  };

  const handleRateTableMenuClick = () => {
    if (location.pathname !== '/transactions') {
      navigate('/transactions');
      setRateTableSplitOpen(true);
    } else {
      toggleRateTableSplit();
    }
    setMobileMenuOpen(false);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const renderBadge = (count?: number, color: NavItem['badgeColor'] = 'indigo') => {
    if (!count) return null;
    const cls =
      color === 'rose'
        ? 'bg-rose-100 text-rose-700'
        : color === 'amber'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-indigo-100 text-indigo-700';
    return (
      <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${cls}`}>
        {count}
      </span>
    );
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-200">
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 font-black text-white shadow-sm">
            K
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold tracking-tight text-white">카나다라</span>
              <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                AUTO-CB
              </span>
            </div>
            <p className="text-[11px] text-slate-400">승인 · 전표 · 수수료 정산</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Ver 2 전환 배너 */}
      <div className="border-b border-slate-800 px-4 py-2.5 bg-slate-950/60">
        <button
          type="button"
          onClick={() => {
            setAppVersion('v2');
            navigate('/v2/register');
            setMobileMenuOpen(false);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-extrabold text-slate-900 hover:bg-slate-100 transition-colors"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          <span>Ver 2 (AG 간소화 모드)로 전환</span>
        </button>
      </div>

      {/* Current User Card */}
      <div className="border-b border-slate-800 p-4">
        <div className="rounded-xl bg-slate-800/80 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-white">{currentUser.name}</span>
            <RoleBadge role={currentUser.role} short />
          </div>
          <p className="mt-1 truncate text-xs text-slate-400">{currentUser.affiliation}</p>
          {currentUser.role === 'CM' && (
            <div className="mt-2.5 space-y-1 rounded-lg bg-slate-900/70 px-2.5 py-2 text-[11px] text-slate-300">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                <span className="truncate">
                  담당 AG:{' '}
                  <strong className="text-white">
                    {assignedAg ? `${assignedAg.name}` : '미배정'}
                  </strong>
                </span>
              </div>
              {currentUser.employeeId && (
                <div className="text-[10px] text-slate-400">
                  사번: {currentUser.employeeId} · 사업자: {currentUser.businessNumber}
                </div>
              )}
            </div>
          )}
          {currentUser.role === 'AG' && (
            <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-[11px] text-slate-300">
              <Users className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
              <span className="truncate">
                담당 CM:{' '}
                <strong className="text-white">
                  {assignedCms.map((c) => c.name).join(', ') || '배정 없음'}
                </strong>
              </span>
            </div>
          )}
          {currentUser.role === 'ADMIN' && (
            <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-[11px] text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-purple-400" />
              <span>본사 전체 데이터 접근 권한</span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {currentUser.role === 'CM'
            ? 'CM 카마스터 조회 메뉴'
            : currentUser.role === 'AG'
            ? 'AG 거래승인 · 정산 메뉴'
            : '본사 운영 관리 메뉴'}
        </p>

        {navItems.map((item, idx) => {
          const Icon = item.icon;
          const isTransactionsItem = item.to === '/transactions';
          return (
            <React.Fragment key={item.to}>
              <NavLink
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {renderBadge(item.badge, item.badgeColor)}
              </NavLink>

              {/* 좌측 메뉴의 [요율표 보기] 버튼 — 클릭 시 화면 좌우 2분할로 요율표(이미지/데이터 표) 동시 조회 */}
              {isTransactionsItem && (
                <button
                  type="button"
                  onClick={handleRateTableMenuClick}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-all border ${
                    isRateTableSplitOpen && location.pathname === '/transactions'
                      ? 'bg-emerald-600/95 text-white border-emerald-400 shadow-md'
                      : 'bg-slate-800/80 text-indigo-200 border-indigo-500/30 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Columns2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {currentUser.role === 'ADMIN' ? '요율표 보기·추가' : '요율표 보기'}
                  </span>
                  <span
                    className={`ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${
                      isRateTableSplitOpen && location.pathname === '/transactions'
                        ? 'bg-white text-emerald-800'
                        : 'bg-indigo-500/30 text-indigo-200'
                    }`}
                  >
                    {isRateTableSplitOpen && location.pathname === '/transactions'
                      ? '2분할 ON'
                      : '좌우 2분할'}
                  </span>
                </button>
              )}
              {idx === 0 && currentUser.role === 'CM' && (
                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-800/40 p-3 text-[11px] text-slate-400 leading-relaxed">
                  <p className="font-bold text-slate-200 mb-1">안내</p>
                  거래 승인 요청 등록은 담당 AG가 직접 진행하며, CM 화면에서는 본인 이름으로 진행된 거래 내역(CM 수수료)과 요율표를 실시간 조회할 수 있습니다.
                </div>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="border-t border-slate-800 p-3 space-y-1.5">
        {confirmResetDemo ? (
          <div className="rounded-lg border border-amber-500/40 bg-slate-800 p-2.5 space-y-2">
            <p className="text-xs font-semibold text-amber-200">
              데모 데이터를 초기 상태로 되돌릴까요?
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  resetDemoData();
                  setConfirmResetDemo(false);
                }}
                className="flex-1 rounded-md bg-amber-500 hover:bg-amber-400 px-2.5 py-1 text-xs font-bold text-slate-950 transition-colors"
              >
                초기화 확인
              </button>
              <button
                type="button"
                onClick={() => setConfirmResetDemo(false)}
                className="flex-1 rounded-md bg-slate-700 hover:bg-slate-600 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmResetDemo(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            더미 데이터 초기화
          </button>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-950/60 hover:text-rose-200 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          로그아웃
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative flex w-72 max-w-xs flex-1 flex-col">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Top Utility Header */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
              aria-label="메뉴 열기"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden sm:block">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{currentUser.affiliation}</span>
                <span>·</span>
                <span>접근 범위 격리 적용 중</span>
                <span>·</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                  기준일 {systemReferenceDate}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Demo Account Switcher */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/70 px-2.5 py-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
              <span className="hidden text-xs font-semibold text-indigo-900 md:inline">
                시연용 빠른 계정 전환:
              </span>
              <select
                aria-label="시연용 빠른 계정 전환"
                value={currentUser.id}
                onChange={(e) => handleRoleSwitch(e.target.value)}
                className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none"
              >
                {users
                  .filter((u) => u.isActive)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      [{u.role}] {u.name} ({u.affiliation})
                    </option>
                  ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex"
            >
              <LogOut className="h-3.5 w-3.5" />
              로그아웃
            </button>
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
};
