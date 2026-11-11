import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  ShieldCheck,
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Calculator,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useApp();
  const navigate = useNavigate();

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const performLogin = async (targetId: string, targetPw: string) => {
    setErrorMessage(null);
    setIsSubmitting(true);
    const res = await login(targetId, targetPw);
    setIsSubmitting(false);
    if (!res.ok) {
      setErrorMessage(res.message);
      return;
    }
    navigate('/dashboard');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password.trim()) {
      setErrorMessage('아이디와 비밀번호를 모두 입력해 주세요.');
      return;
    }
    performLogin(loginId, password);
  };

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
                오토캐시백 거래 승인 · 요율표 · 월별 정산 관리 시스템
              </p>
            </div>
          </div>

          <div className="mt-10 space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-slate-700">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              실시간 Google Sheets 마스터 연동
            </span>
            <h2 className="text-2xl font-bold leading-snug sm:text-3xl">
              빠르고 직관적인
              <br />
              오토캐시백 실무 플랫폼
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              카드사별 실시간 요율표 조회, 신속한 분할결제 승인 등록, 월별 수수료 자동 정산 및
              구글 시트 영구 저장을 하나의 화면에서 원활하게 처리합니다.
            </p>
          </div>

          <div className="mt-8 space-y-3.5">
            <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-800/60 p-3.5">
              <div className="mt-0.5 rounded-lg bg-slate-700/80 p-2 text-slate-300">
                <FileSpreadsheet className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white">Google Sheet 실시간 마스터 동기화</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  카드사 요율표, 프로모션, 승인 거래내역, 사용자 계정이 실시간으로 유지됩니다.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-800/60 p-3.5">
              <div className="mt-0.5 rounded-lg bg-slate-700/80 p-2 text-slate-300">
                <Calculator className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white">자동 수수료 계산 & 월별 정산</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  일시불/할부/다이렉트 복합 결제에 대한 캐시백과 AG·CM 수수료를 실시간 연산합니다.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-slate-800 pt-6 text-xs text-slate-500 flex items-center justify-between">
          <span>KANADARA System</span>
          <span>Ver 2.0 (실무 간소화 모드)</span>
        </div>
      </div>

      {/* Right Login Action Panel */}
      <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 xl:px-24 bg-slate-50">
        <div className="mx-auto w-full max-w-md space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">시스템 로그인</h2>
                <p className="text-xs text-slate-500">발급받으신 계정 정보를 입력해 주세요.</p>
              </div>
            </div>

            {errorMessage && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="login-id-input" className="block text-xs font-semibold text-slate-700">
                  아이디
                </label>
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="login-id-input"
                    type="text"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    placeholder="아이디 입력 (예: admin)"
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

        </div>
      </div>
    </div>
  );
};
