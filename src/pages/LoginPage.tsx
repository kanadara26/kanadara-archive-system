import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { RoleBadge } from '../components/StatusBadges';
import {
  ShieldCheck,
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Calculator,
  Sparkles,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { users, login, appVersion, getAssignedAgForCm, getAssignedCmsForAg } = useApp();
  const navigate = useNavigate();

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const performLogin = (targetId: string, targetPw: string) => {
    setErrorMessage(null);
    setIsSubmitting(true);
    setTimeout(() => {
      const res = login(targetId, targetPw);
      setIsSubmitting(false);
      if (!res.ok) {
        setErrorMessage(res.message);
        return;
      }
      if (appVersion === 'v2') {
        navigate('/v2/dashboard');
        return;
      }
      const matched = users.find(
        (u) => u.loginId.toLowerCase() === targetId.trim().toLowerCase()
      );
      if (matched?.role === 'ADMIN') {
        navigate('/admin/overview');
      } else {
        navigate('/transactions');
      }
    }, 280);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password.trim()) {
      setErrorMessage('아이디와 비밀번호를 모두 입력해 주세요.');
      return;
    }
    performLogin(loginId, password);
  };

  const demoAccounts = [
    users.find((u) => u.id === 'usr-v2-admin' && u.isActive),
    ...users.filter((u) => u.role === 'AG' && u.isActive),
    users.find((u) => u.id === 'usr-admin-1' && u.isActive),
    ...users.filter((u) => u.role === 'CM' && u.isActive).slice(0, 2),
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col lg:flex-row">
      {/* Left Brand / Value Proposition Panel */}
      <div className="relative flex flex-col justify-between overflow-hidden bg-slate-900 border-r border-slate-800 px-6 py-10 text-white sm:px-12 lg:w-5/12 lg:py-14">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 border border-slate-700 text-lg font-black text-white shadow-sm">
              K
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">카나다라 (KANADARA)</h1>
              <p className="text-xs text-slate-400">
                CM · AG 오토캐시백 거래 승인 · 전표 · 정산 관리 웹앱
              </p>
            </div>
          </div>

          <div className="mt-10 space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-slate-700">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              표준 승인 워크플로우 & Google Sheets 자동화
            </span>
            <h2 className="text-2xl font-bold leading-snug sm:text-3xl">
              메신저·수기 전달 없는
              <br />
              실시간 오토캐시백 통합 업무 공간
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              CM의 거래 승인 요청부터 AG의 카드사 심사 상태 공유, 매출전표 구글 시트 자동입력, 월별
              CM 수수료 정산 파일 추출까지 하나의 흐름으로 연결합니다.
            </p>
          </div>

          <div className="mt-8 space-y-3.5">
            <div className="flex items-start gap-3 rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-white">카드사·거래방법별 표준 조건 매칭</p>
                <p className="mt-0.5 text-xs text-slate-300">
                  선택한 조합에 허용된 캐시백·할부 조건만 자동 제공하여 재처리와 오입력을 방지합니다.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
              <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
              <div>
                <p className="text-sm font-semibold text-white">
                  전표 제출 즉시 구글 시트 자동입력 & 중복 방지 재처리
                </p>
                <p className="mt-0.5 text-xs text-slate-300">
                  멱등키(거래ID+전표ID) 검증으로 API 장애 재시도 시에도 중복 행 생성을 원천 차단합니다.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
              <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-white">
                  담당 범위 격리 & 월별 CM 수수료 자동 집계
                </p>
                <p className="mt-0.5 text-xs text-slate-300">
                  고객 식별정보 권한별 마스킹 및 제외·누락 사유가 명시된 정산 파일 추출을 지원합니다.
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-8 text-xs text-slate-400">
          © 2026 KANADARA Auto-Cashback Operations Platform · B2B 보안 워크스페이스
        </p>
      </div>

      {/* Right Login & One-Click Role Demo Panel */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-10 sm:px-10">
        <div className="w-full max-w-xl space-y-6">
          {/* Manual Login Form Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">업무 계정 로그인</h2>
                <p className="mt-1 text-xs text-slate-500">
                  등록된 개인 계정과 역할(CM · AG · 운영 관리자) 권한으로 접속합니다.
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>

            {errorMessage && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <div>
                  <p className="font-semibold">인증에 실패했습니다</p>
                  <p className="mt-0.5">{errorMessage}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="login-id-input" className="block text-xs font-semibold text-slate-700">
                  로그인 아이디 (이메일)
                </label>
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="login-id-input"
                    type="text"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    placeholder="example@kanadara.co.kr"
                    className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3.5 text-sm text-slate-900 focus:border-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-800/10"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-pw-input" className="block text-xs font-semibold text-slate-700">
                  비밀번호
                </label>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="login-pw-input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호 입력"
                    className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3.5 text-sm text-slate-900 focus:border-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-800/10"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60 transition-colors"
              >
                {isSubmitting ? '인증 정보 확인 중...' : '업무 화면 로그인'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>

          {/* Demo Quick-Login Account Cards */}
          <div className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  목업 시연용 역할별 원클릭 로그인
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  클릭 시 해당 역할의 허용 메뉴와 배정된 거래 범위로 즉시 진입합니다. (비밀번호 공통:{' '}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
                    password123
                  </code>
                  )
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2.5">
              {demoAccounts.map((acc) => {
                if (!acc) return null;
                const scopeNote =
                  acc.role === 'CM'
                    ? `본인 거래 전용 · 담당 AG: ${getAssignedAgForCm(acc.id)?.name ?? '미배정'}`
                    : acc.role === 'AG'
                    ? `담당 CM: ${getAssignedCmsForAg(acc.id)
                        .map((c) => c.name)
                        .join(', ')}`
                    : '전체 사용자 · 배정 · 조건 · 전표 · 월별 정산 총괄';

                return (
                  <button
                    key={acc.id}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      setLoginId(acc.loginId);
                      setPassword(acc.password);
                      performLogin(acc.loginId, acc.password);
                    }}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-left hover:border-indigo-400 hover:bg-indigo-50/50 transition-all"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <RoleBadge role={acc.role} short />
                        <span className="text-sm font-bold text-slate-900">{acc.name}</span>
                        <span className="text-xs text-slate-500">· {acc.affiliation}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-600">{scopeNote}</p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-600 ring-1 ring-slate-200 group-hover:bg-indigo-600 group-hover:text-white group-hover:ring-indigo-600 transition-colors">
                      바로 접속 →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
