import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { User } from '../../types';
import { GOOGLE_SHEET_TABS } from '../../constants/googleSheetConfig';
import {
  Check,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  Layers,
  Plus,
  RotateCcw,
  ShieldCheck,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';

export const SettingsPageV2: React.FC = () => {
  const {
    currentUser,
    users,
    transactions,
    rateTableRows,
    cardPromotions,
    saveUserAccount,
    quickSwitchUser,
    lastMasterSheetSyncedAt,
    isSyncingMasterSheet,
    pullRateAndPromotionsFromGoogleSheet,
    pushAllMasterTabsToGoogleSheet,
    importRateTableRowsFromSheetTsv,
    setAppVersion,
    resetDemoData,
  } = useApp();
  const navigate = useNavigate();

  const isAdmin = currentUser?.role === 'ADMIN';
  const adminUser = useMemo(
    () =>
      users.find((u) => u.id === 'usr-v2-admin') ||
      users.find((u) => u.role === 'ADMIN' && u.isActive),
    [users]
  );

  // =========================================================================
  // ADMIN 전용: AG 계정 발급 및 수정 상태
  // =========================================================================
  const [editingAgId, setEditingAgId] = useState<string | undefined>(undefined);
  const [agName, setAgName] = useState<string>('');
  const [agLoginId, setAgLoginId] = useState<string>('');
  const [agPassword, setAgPassword] = useState<string>('[REDACTED]');
  const [agAffiliation, setAgAffiliation] = useState<string>('');
  const [agPhone, setAgPhone] = useState<string>('');

  const agUsers = useMemo(
    () => users.filter((u) => u.role === 'AG'),
    [users]
  );

  const txCountByAg = useMemo(() => {
    const map = new Map<string, number>();
    transactions.forEach((tx) => {
      map.set(tx.agId, (map.get(tx.agId) || 0) + 1);
    });
    return map;
  }, [transactions]);

  const handleResetAgForm = () => {
    setEditingAgId(undefined);
    setAgName('');
    setAgLoginId('');
    setAgPassword('[REDACTED]');
    setAgAffiliation('');
    setAgPhone('');
  };

  const handleEditAg = (ag: User) => {
    setEditingAgId(ag.id);
    setAgName(ag.name);
    setAgLoginId(ag.loginId);
    setAgPassword(ag.password);
    setAgAffiliation(ag.affiliation);
    setAgPhone(ag.phone);
  };

  const handleSaveAgAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const existing = editingAgId ? users.find((u) => u.id === editingAgId) : undefined;
    const res = saveUserAccount({
      id: editingAgId,
      loginId: agLoginId.trim(),
      password: agPassword.trim() || '[REDACTED]',
      name: agName.trim(),
      role: 'AG',
      affiliation: agAffiliation.trim() || '카나다라 오토금융팀',
      phone: agPhone.trim() || '010-0000-0000',
      isActive: existing ? existing.isActive : true,
    });
    if (res.ok) {
      handleResetAgForm();
    }
  };

  const handleToggleAgActive = (ag: User) => {
    if (!isAdmin) return;
    saveUserAccount({
      id: ag.id,
      loginId: ag.loginId,
      password: ag.password,
      name: ag.name,
      role: 'AG',
      affiliation: ag.affiliation,
      phone: ag.phone,
      isActive: !ag.isActive,
    });
  };

  // =========================================================================
  // CM 등록/수정 폼 상태
  // =========================================================================
  const [editingCmId, setEditingCmId] = useState<string | undefined>(undefined);
  const [cmName, setCmName] = useState<string>('');
  const [cmAffiliation, setCmAffiliation] = useState<string>('');
  const [cmPhone, setCmPhone] = useState<string>('');
  const [cmBusinessNo, setCmBusinessNo] = useState<string>('');
  const [cmRrn, setCmRrn] = useState<string>('');
  const [cmEmployeeId, setCmEmployeeId] = useState<string>('');
  const [cmSearch, setCmSearch] = useState<string>('');

  // 수동 TSV 붙여넣기 토글 (보조 기능)
  const [showTsvPaste, setShowTsvPaste] = useState<boolean>(false);
  const [tsvText, setTsvText] = useState<string>('');
  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  const cmUsers = useMemo(() => {
    const list = users.filter((u) => u.role === 'CM');
    const kw = cmSearch.trim().toLowerCase();
    if (!kw) return list;
    return list.filter((u) =>
      [u.name, u.affiliation, u.phone, u.employeeId || '']
        .join(' ')
        .toLowerCase()
        .includes(kw)
    );
  }, [users, cmSearch]);

  const txCountByCm = useMemo(() => {
    const map = new Map<string, number>();
    transactions.forEach((tx) => {
      map.set(tx.cmId, (map.get(tx.cmId) || 0) + 1);
    });
    return map;
  }, [transactions]);

  const handleResetCmForm = () => {
    setEditingCmId(undefined);
    setCmName('');
    setCmAffiliation('');
    setCmPhone('');
    setCmBusinessNo('');
    setCmRrn('');
    setCmEmployeeId('');
  };

  const handleEditCm = (cm: User) => {
    setEditingCmId(cm.id);
    setCmName(cm.name);
    setCmAffiliation(cm.affiliation);
    setCmPhone(cm.phone);
    setCmBusinessNo(cm.businessNumber || '');
    setCmRrn(cm.rrn || '');
    setCmEmployeeId(cm.employeeId || '');
  };

  const handleSaveCm = (e: React.FormEvent) => {
    e.preventDefault();
    const existing = editingCmId ? users.find((u) => u.id === editingCmId) : undefined;
    const res = saveUserAccount({
      id: editingCmId,
      loginId: existing?.loginId || `cm.${Date.now()}@autodealer.kr`,
      name: cmName,
      role: 'CM',
      affiliation: cmAffiliation || '제휴 대리점',
      phone: cmPhone || '010-0000-0000',
      businessNumber: cmBusinessNo || undefined,
      rrn: cmRrn || undefined,
      employeeId: cmEmployeeId || undefined,
      isActive: existing ? existing.isActive : true,
    });
    if (res.ok) {
      handleResetCmForm();
    }
  };

  const handleToggleCmActive = (cm: User) => {
    saveUserAccount({
      id: cm.id,
      loginId: cm.loginId,
      name: cm.name,
      role: 'CM',
      affiliation: cm.affiliation,
      phone: cm.phone,
      businessNumber: cm.businessNumber,
      rrn: cm.rrn,
      employeeId: cm.employeeId,
      isActive: !cm.isActive,
    });
  };

  return (
    <div className="space-y-6">
      {/* 상단 헤더 */}
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight text-slate-900">설정</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            AG 계정 발급(ADMIN 전용), CM 정보 저장, 구글 시트 조건 불러오기(Pull) · 내역 저장하기(Push)를 관리합니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
            접속 계정: {currentUser?.name} ({currentUser?.role})
          </span>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 1. ADMIN 전용: AG 계정 발급 및 관리 */}
      {/* =================================================================== */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-slate-900" />
                AG 계정 발급 및 관리
              </h2>
              <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">
                ADMIN 전용
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              어드민(ADMIN) 계정은 실무자용 AG 계정을 신규 발급하고 접속 정보를 관리할 수 있습니다.
            </p>
          </div>

          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
            발급된 AG {agUsers.length}명
          </span>
        </div>

        {!isAdmin ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="space-y-1">
              <p className="text-xs font-extrabold text-slate-900">
                현재 AG 계정({currentUser?.name})으로 접속 중입니다.
              </p>
              <p className="text-xs text-slate-500">
                AG 계정 신규 발급 및 관리는 어드민 계정(<strong className="font-mono text-slate-800">ID: admin / PW: [REDACTED]</strong>)에서 가능합니다.
              </p>
            </div>
            {adminUser && (
              <button
                type="button"
                onClick={() => quickSwitchUser(adminUser.id)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-slate-800 shrink-0 transition-colors"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>어드민(ADMIN) 계정으로 즉시 전환</span>
              </button>
            )}
          </div>
        ) : (
          <>
            {/* AG 계정 신규 발급 / 수정 폼 */}
            <form
              onSubmit={handleSaveAgAccount}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                  <UserPlus className="h-4 w-4 text-slate-700" />
                  {editingAgId ? 'AG 계정 정보 수정' : '신규 AG 계정 발급'}
                </span>
                {editingAgId && (
                  <button
                    type="button"
                    onClick={handleResetAgForm}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900 underline"
                  >
                    신규 발급으로 전환
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="ag-name"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    AG 담당자 성명 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="ag-name"
                    type="text"
                    required
                    value={agName}
                    onChange={(e) => setAgName(e.target.value)}
                    placeholder="예: 김태형"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ag-login-id"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    발급 아이디 (ID) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="ag-login-id"
                    type="text"
                    required
                    value={agLoginId}
                    onChange={(e) => setAgLoginId(e.target.value)}
                    placeholder="예: ag.kim@kanadara.co.kr 또는 ag.kim"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ag-password"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    발급 비밀번호 (PW) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="ag-password"
                    type="text"
                    required
                    value={agPassword}
                    onChange={(e) => setAgPassword(e.target.value)}
                    placeholder="예: [REDACTED]"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="ag-affiliation"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    소속 / 팀명
                  </label>
                  <input
                    id="ag-affiliation"
                    type="text"
                    value={agAffiliation}
                    onChange={(e) => setAgAffiliation(e.target.value)}
                    placeholder="예: 카나다라 오토금융 3팀"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ag-phone"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    연락처
                  </label>
                  <input
                    id="ag-phone"
                    type="text"
                    value={agPhone}
                    onChange={(e) => setAgPhone(e.target.value)}
                    placeholder="예: 010-8200-2103"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 transition-colors"
                  >
                    {editingAgId ? (
                      <>
                        <Check className="h-4 w-4" />
                        AG 계정 수정 저장
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        AG 계정 발급하기
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>

            {/* 발급된 AG 계정 목록 */}
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
              {agUsers.map((ag) => {
                const count = txCountByAg.get(ag.id) || 0;
                return (
                  <div
                    key={ag.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 bg-white hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-xs font-extrabold text-white">
                        AG
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-extrabold text-slate-900">
                            {ag.name}
                          </span>
                          <span className="text-xs font-medium text-slate-500">
                            {ag.affiliation}
                          </span>
                          {!ag.isActive && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                              중지됨
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          ID: <strong className="text-slate-800">{ag.loginId}</strong> · PW:{' '}
                          <strong className="text-slate-800">{ag.password}</strong> ·{' '}
                          {ag.phone} · 등록 거래 {count}건
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => quickSwitchUser(ag.id)}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                      >
                        이 계정으로 전환
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditAg(ag)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                      >
                        <Edit3 className="h-3 w-3" />
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleAgActive(ag)}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                      >
                        {ag.isActive ? '사용중지' : '활성화'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* =================================================================== */}
      {/* 2. CM 정보 저장하기 및 등록 목록 관리 */}
      {/* =================================================================== */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-700" />
              CM 정보 저장하기
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              저장한 CM은 [거래 승인건 등록] 4단계와 [월별 수수료 정산] 필터에서 바로 선택할 수 있습니다.
            </p>
          </div>
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
            등록 CM {cmUsers.length}명
          </span>
        </div>

        <form
          onSubmit={handleSaveCm}
          className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
              <UserCheck className="h-4 w-4 text-slate-700" />
              {editingCmId ? 'CM 정보 수정' : '신규 CM 등록'}
            </span>
            {editingCmId && (
              <button
                type="button"
                onClick={handleResetCmForm}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 underline"
              >
                신규 등록으로 전환
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="cm-name"
                className="block text-xs font-bold text-slate-700 mb-1"
              >
                CM 이름 <span className="text-rose-500">*</span>
              </label>
              <input
                id="cm-name"
                type="text"
                required
                value={cmName}
                onChange={(e) => setCmName(e.target.value)}
                placeholder="예: 김민준"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="cm-affiliation"
                className="block text-xs font-bold text-slate-700 mb-1"
              >
                소속 / 대리점 <span className="text-rose-500">*</span>
              </label>
              <input
                id="cm-affiliation"
                type="text"
                required
                value={cmAffiliation}
                onChange={(e) => setCmAffiliation(e.target.value)}
                placeholder="예: 현대자동차 서초지점"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="cm-phone"
                className="block text-xs font-bold text-slate-700 mb-1"
              >
                연락처
              </label>
              <input
                id="cm-phone"
                type="text"
                value={cmPhone}
                onChange={(e) => setCmPhone(e.target.value)}
                placeholder="예: 010-1234-5678"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="cm-bizno"
                className="block text-[11px] font-semibold text-slate-500 mb-1"
              >
                사업자등록번호 (선택)
              </label>
              <input
                id="cm-bizno"
                type="text"
                value={cmBusinessNo}
                onChange={(e) => setCmBusinessNo(e.target.value)}
                placeholder="예: 214-19-48102"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="cm-rrn"
                className="block text-[11px] font-semibold text-slate-500 mb-1"
              >
                주민등록번호 (선택)
              </label>
              <input
                id="cm-rrn"
                type="text"
                value={cmRrn}
                onChange={(e) => setCmRrn(e.target.value)}
                placeholder="예: 880101-1234567"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 transition-colors"
              >
                {editingCmId ? (
                  <>
                    <Check className="h-4 w-4" />
                    CM 정보 수정 저장
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    CM 정보 저장하기
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* 등록된 CM 목록 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-700">등록된 CM 목록</h3>
            <input
              type="text"
              value={cmSearch}
              onChange={(e) => setCmSearch(e.target.value)}
              placeholder="CM 이름 또는 소속 검색..."
              className="w-48 sm:w-64 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:bg-white focus:border-slate-400 focus:outline-none"
            />
          </div>

          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
            {cmUsers.map((cm) => {
              const count = txCountByCm.get(cm.id) || 0;
              return (
                <div
                  key={cm.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 bg-white hover:bg-slate-50/80 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-extrabold text-slate-700">
                      {cm.name.slice(0, 1)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold text-slate-900">
                          {cm.name}
                        </span>
                        <span className="text-xs font-medium text-slate-500">
                          {cm.affiliation}
                        </span>
                        {!cm.isActive && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                            비활성
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        {cm.phone}
                        {cm.businessNumber ? ` · 사업자 ${cm.businessNumber}` : ''} · 누적 거래{' '}
                        {count}건
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleEditCm(cm)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      <Edit3 className="h-3 w-3" />
                      수정
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleCmActive(cm)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                    >
                      {cm.isActive ? '숨김' : '활성화'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 3. 구글 시트 연동 (시트 > 웹앱 조건 불러오기 Pull / 웹앱 > 시트 내역 저장하기 Push) */}
      {/* =================================================================== */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-slate-700" />
              구글 시트 연동 (Pull / Push)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              최근 동기화: <span className="font-mono font-semibold">{lastMasterSheetSyncedAt}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <a
              href={GOOGLE_SHEET_TABS.REGISTRATION_CONSOLE.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              <ExternalLink className="h-3 w-3" />
              00_조건등록 시트
            </a>
            <a
              href={GOOGLE_SHEET_TABS.RATE_TABLE_MASTER.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              <ExternalLink className="h-3 w-3" />
              05_요율표 시트
            </a>
            <a
              href={GOOGLE_SHEET_TABS.TRANSACTION_MASTER.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              <ExternalLink className="h-3 w-3" />
              07_거래내역 시트
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 시트 > 웹앱 조건 불러오기 (Pull) */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
            <div className="space-y-1">
              <span className="inline-block rounded-md bg-white px-2 py-0.5 text-[11px] font-extrabold text-slate-700 border border-slate-200">
                PULL · 조건 동기화
              </span>
              <h3 className="text-sm font-extrabold text-slate-900 pt-1">
                시트 &gt; 웹앱 조건 불러오기 (Pull)
              </h3>
              <p className="text-xs text-slate-500">
                구글 시트에 등록된 최신 카드사별 요율표({rateTableRows.length}건) 및 프로모션 조건(
                {cardPromotions.length}건)을 웹앱으로 불러옵니다.
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                disabled={isSyncingMasterSheet}
                onClick={() => pullRateAndPromotionsFromGoogleSheet()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-900 bg-white px-4 py-3 text-xs font-extrabold text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition-colors"
              >
                <Download
                  className={`h-4 w-4 ${isSyncingMasterSheet ? 'opacity-50' : ''}`}
                />
                <span>시트 &gt; 웹앱 조건 불러오기 (Pull)</span>
              </button>

              <button
                type="button"
                onClick={() => setShowTsvPaste((prev) => !prev)}
                className="w-full text-center text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline"
              >
                {showTsvPaste
                  ? '시트 데이터 직접 붙여넣기 닫기'
                  : '시트 행(TSV) 직접 복사·붙여넣기로 조건 불러오기'}
              </button>
            </div>
          </div>

          {/* 웹앱 > 시트 내역 저장하기 (Push) */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
            <div className="space-y-1">
              <span className="inline-block rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-extrabold text-white">
                PUSH · 내역 저장
              </span>
              <h3 className="text-sm font-extrabold text-slate-900 pt-1">
                웹앱 &gt; 시트 내역 저장하기 (Push)
              </h3>
              <p className="text-xs text-slate-500">
                웹앱에 등록된 거래 승인 내역(총 {transactions.length}건)과 분할결제 데이터를 구글
                시트에 저장합니다.
              </p>
            </div>

            <button
              type="button"
              disabled={isSyncingMasterSheet}
              onClick={() => pushAllMasterTabsToGoogleSheet('Ver 2 거래내역 및 요율 전체')}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <Upload className={`h-4 w-4 ${isSyncingMasterSheet ? 'opacity-50' : ''}`} />
              <span>웹앱 &gt; 시트 내역 저장하기 (Push)</span>
            </button>
          </div>
        </div>

        {showTsvPaste && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
            <p className="text-xs font-bold text-slate-700">
              05_요율표_마스터 시트 행을 복사(Ctrl+C)한 뒤 아래에 붙여넣으면 즉시 요율표에 반영됩니다.
            </p>
            <textarea
              rows={3}
              value={tsvText}
              onChange={(e) => setTsvText(e.target.value)}
              placeholder="구글 시트에서 복사한 요율 행 데이터를 붙여넣으세요..."
              className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs font-mono text-slate-800 focus:border-slate-900 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const res = importRateTableRowsFromSheetTsv(tsvText, 'MERGE');
                  if (res.ok) {
                    setTsvText('');
                    setShowTsvPaste(false);
                  }
                }}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
              >
                조건 병합 반영하기
              </button>
            </div>
          </div>
        )}
      </section>

      {/* =================================================================== */}
      {/* 4. 버전 전환 (Ver 1 / Ver 2) 및 초기화 */}
      {/* =================================================================== */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">
            앱 버전 전환 및 초기화
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            기존 전체 기능 버전(Ver 1)은 그대로 보존되어 있으며 언제든 전환할 수 있습니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setAppVersion('v1');
              navigate('/transactions');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Ver 1 (전체 기능 버전)으로 전환</span>
          </button>

          {confirmReset ? (
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  resetDemoData();
                  setConfirmReset(false);
                }}
                className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-700"
              >
                초기화 확인
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-600"
              >
                취소
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>기본 샘플 데이터 복원</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
};
