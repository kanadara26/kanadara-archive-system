import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
// 요율표 패널은 열 때만 불러옴 (첫 화면 로딩 가볍게)
const RateTablePanel = lazy(() => import('../RateTablePanel').then((m) => ({ default: m.RateTablePanel })));
import {
  LayoutDashboard,
  FilePlus2,
  Calculator,
  Settings,
  CheckCircle2,
  ShieldCheck,
  UserCheck,
  ChevronDown,
  KeyRound,
  LogOut,
  UserPlus,
  FileSpreadsheet,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

export const AppShellV2: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    currentUser,
    users,
    quickSwitchUser,
    login,
    logout,
    draftsV2,
    lastMasterSheetSyncedAt,
    isSheetReady,
    refreshFromSheet,
    isRateTableSplitOpen,
    setRateTableSplitOpen,
    pushToast,
  } = useApp();
  const navigate = useNavigate();

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginIdInput, setLoginIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const adminUsers = users.filter((u) => u.role === 'ADMIN' && u.isActive);
  const agUsers = users.filter((u) => u.role === 'AG' && u.isActive);
  const isAdmin = currentUser?.role === 'ADMIN';

  const handleDirectLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdInput.trim()) return;
    const res = await login(loginIdInput.trim(), passwordInput);
    if (!res.ok) {
      pushToast({ type: 'error', title: '로그인 실패', description: res.message });
      return;
    }
    setLoginModalOpen(false);
    setAccountMenuOpen(false);
    setLoginIdInput('');
    setPasswordInput('');
  };

  const navItems = [
    {
      to: '/dashboard',
      label: '대시보드',
      shortLabel: '대시보드',
      icon: LayoutDashboard,
    },
    {
      to: '/register',
      label: '거래 승인건 등록',
      shortLabel: '승인건 등록',
      icon: FilePlus2,
      badge: draftsV2.length > 0 ? draftsV2.length : undefined,
    },
    {
      to: '/settlements',
      label: '월별 수수료 정산',
      shortLabel: '월별 정산',
      icon: Calculator,
    },
    {
      to: '/settings',
      label: '설정',
      shortLabel: '설정',
      icon: Settings,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* 상단 고정 네비게이션 바 (충분한 상하 여백 py-4 sm:py-5 적용) */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          {/* 좌측: 브랜드 로고 (클릭 시 대시보드 이동) + PC 상단 탭 메뉴 */}
          <div className="flex min-w-0 items-center gap-4 lg:gap-6">
            <button
              type="button"
              onClick={() => navigate('/v2/dashboard')}
              className="group flex shrink-0 items-center gap-2.5 text-left focus-visible:outline-none"
              title="대시보드로 이동"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-base font-black text-white transition-transform group-hover:scale-105">
                K
              </div>
              <div className="hidden flex-col sm:flex">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-extrabold tracking-tight text-slate-900">
                    카나다라
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 border border-slate-200">
                    Ver 2
                  </span>
                </div>
                <span className="hidden whitespace-nowrap text-[11px] font-medium text-slate-400 xl:block">
                  거래 승인 · 수수료 정산 시스템
                </span>
              </div>
            </button>

            {/* PC 상단 탭 메뉴 */}
            <nav className="hidden md:flex items-center gap-1" aria-label="주요 메뉴">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    title={item.label}
                    className={({ isActive }) =>
                      `inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold transition-colors lg:px-3.5 ${
                        isActive
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.shortLabel}</span>
                    {item.badge !== undefined && (
                      <span className="ml-0.5 rounded-full bg-slate-700 px-1.5 py-0.5 text-[11px] font-bold text-white tabular-nums">
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          {/* 우측: 요율표 · 시트 새로고침 · 계정 메뉴 */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setRateTableSplitOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>요율표</span>
            </button>

            {/* 실제 연결 상태 표시: 시트를 못 불러왔으면 저장이 중지된 상태 */}
            {isSheetReady ? (
              <button
                type="button"
                disabled={isRefreshing}
                onClick={async () => {
                  setIsRefreshing(true);
                  await refreshFromSheet();
                  setIsRefreshing(false);
                }}
                title={`다른 사람이 등록한 거래까지 최신으로 불러옵니다 (3분마다 자동). 최근 동기화: ${lastMasterSheetSyncedAt}`}
                aria-label="시트 새로고침"
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60"
              >
                {isRefreshing ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-500" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">새로고침</span>
              </button>
            ) : (
              <span
                title="구글 시트를 불러오지 못해 저장이 중지된 상태입니다. 설정 > 시트 연결 테스트로 확인하세요."
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl bg-rose-50 px-3 text-xs font-bold text-rose-700"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>시트 미연결</span>
              </span>
            )}

            {/* 현재 접속 계정 및 전환 메뉴 */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-xs font-bold transition-colors ${
                  isAdmin
                    ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                    : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                {isAdmin ? (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-amber-300" />
                ) : (
                  <UserCheck className="h-4 w-4 shrink-0 text-slate-600" />
                )}
                <span className="hidden max-w-[110px] truncate lg:inline">{currentUser?.name ?? '계정 선택'}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                    isAdmin
                      ? 'bg-white/15 text-amber-200'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {isAdmin ? 'ADMIN' : 'AG'}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-75" />
              </button>

              {accountMenuOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl z-50">
                  <div className="border-b border-slate-100 pb-2.5 mb-2.5">
                    <p className="text-[11px] font-bold text-slate-400">현재 로그인 계정</p>
                    <div className="mt-1 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-extrabold text-slate-900">
                          {currentUser?.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          ID: <span className="font-mono font-semibold">{currentUser?.loginId}</span> ·{' '}
                          {currentUser?.affiliation || currentUser?.role}
                        </p>
                      </div>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          isAdmin
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {currentUser?.role}
                      </span>
                    </div>
                  </div>

                  {/* 어드민 계정 목록 */}
                  <div className="mb-2">
                    <p className="px-2 py-1 text-[11px] font-bold text-slate-400">
                      Ver 2 어드민 (ADMIN)
                    </p>
                    <div className="space-y-1">
                      {adminUsers.map((admin) => {
                        const active = currentUser?.id === admin.id;
                        return (
                          <button
                            key={admin.id}
                            type="button"
                            onClick={() => {
                              quickSwitchUser(admin.id);
                              setAccountMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs font-bold transition-colors ${
                              active
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              <div>
                                <span>{admin.name}</span>
                                <span
                                  className={`ml-1.5 font-mono text-[11px] ${
                                    active ? 'text-slate-300' : 'text-slate-400'
                                  }`}
                                >
                                  ({admin.loginId})
                                </span>
                              </div>
                            </div>
                            {active && (
                              <span className="text-[10px] font-semibold text-amber-300">
                                사용중
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 발급된 AG 계정 목록 */}
                  <div className="mb-2.5">
                    <p className="px-2 py-1 text-[11px] font-bold text-slate-400">
                      발급된 AG 계정 ({agUsers.length}명)
                    </p>
                    <div className="max-h-44 space-y-1 overflow-y-auto pr-0.5">
                      {agUsers.map((ag) => {
                        const active = currentUser?.id === ag.id;
                        return (
                          <button
                            key={ag.id}
                            type="button"
                            onClick={() => {
                              quickSwitchUser(ag.id);
                              setAccountMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs font-bold transition-colors ${
                              active
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <UserCheck className="h-3.5 w-3.5 shrink-0" />
                              <div className="truncate">
                                <span>{ag.name}</span>
                                <span
                                  className={`ml-1.5 font-mono text-[11px] ${
                                    active ? 'text-slate-300' : 'text-slate-400'
                                  }`}
                                >
                                  ({ag.loginId})
                                </span>
                              </div>
                            </div>
                            {active && (
                              <span className="shrink-0 text-[10px] font-semibold text-emerald-300">
                                사용중
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 하단 액션: ID/PW 직접 로그인 & 설정에서 AG 계정 발급 */}
                  <div className="border-t border-slate-100 pt-2 flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/v2/settings');
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      <UserPlus className="h-3.5 w-3.5 text-slate-500" />
                      <span>설정에서 AG 계정 발급 / 관리</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setLoginModalOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      <KeyRound className="h-3.5 w-3.5 text-slate-500" />
                      <span>아이디 / 비밀번호로 직접 로그인</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        logout();
                        navigate('/login');
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>로그아웃</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 영역 */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:px-6 md:py-8 md:pb-12">
        {children}

        {/* 요율표·프로모션·요율표 이미지 조회 (ADMIN은 등록·수정) */}
        {isRateTableSplitOpen && (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
            onClick={() => setRateTableSplitOpen(false)}
            onKeyDown={(e) => e.key === 'Escape' && setRateTableSplitOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="요율표 · 프로모션 조견표"
              className="h-full w-full max-w-4xl overflow-y-auto bg-slate-50 p-3 sm:p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <Suspense fallback={<p className="p-6 text-sm text-slate-500">요율표 불러오는 중…</p>}>
                <RateTablePanel onCloseSplit={() => setRateTableSplitOpen(false)} />
              </Suspense>
            </div>
          </div>
        )}
      </main>

      {/* 모바일 하단 고정 탭 바 (4개 메뉴) */}
      <nav
        aria-label="모바일 하단 메뉴"
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-xs md:hidden"
      >
        <div className="grid grid-cols-4 h-16">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `relative flex flex-col items-center justify-center gap-1 text-xs font-bold transition-colors ${
                    isActive
                      ? 'text-slate-900'
                      : 'text-slate-400 hover:text-slate-700'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute top-0 h-0.5 w-10 rounded-full bg-slate-900" />
                    )}
                    <div className="relative">
                      <Icon className="h-5 w-5" />
                      {item.badge !== undefined && (
                        <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-bold text-white">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <span>{item.shortLabel}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* 아이디/비밀번호 직접 로그인 모달 */}
      {loginModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  Ver 2 계정 로그인
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  발급받은 어드민 또는 AG 아이디와 비밀번호를 입력하세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLoginModalOpen(false)}
                className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleDirectLogin} className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-700">
                  아이디 (ID)
                </label>
                <input
                  type="text"
                  value={loginIdInput}
                  onChange={(e) => setLoginIdInput(e.target.value)}
                  placeholder="예: admin 또는 ag_jihun"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-700">
                  비밀번호 (PW)
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="비밀번호 입력"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setLoginModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
                >
                  로그인
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
