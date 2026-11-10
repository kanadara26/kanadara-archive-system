import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  Link2,
  Save,
  ShieldAlert,
  Users,
  CheckCircle2,
  Info,
} from 'lucide-react';

export const AssignmentPage: React.FC = () => {
  const {
    currentUser,
    users,
    assignments,
    transactions,
    getAssignedAgForCm,
    saveAgAssignments,
  } = useApp();

  const agUsers = useMemo(() => users.filter((u) => u.role === 'AG' && u.isActive), [users]);
  const cmUsers = useMemo(() => users.filter((u) => u.role === 'CM'), [users]);

  const [selectedAgId, setSelectedAgId] = useState<string>(agUsers[0]?.id ?? '');
  const [checkedCmIds, setCheckedCmIds] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedAgId && agUsers.length > 0) {
      setSelectedAgId(agUsers[0].id);
      return;
    }
    const assigned = assignments
      .filter((a) => a.agId === selectedAgId)
      .map((a) => a.cmId);
    setCheckedCmIds(assigned);
  }, [selectedAgId, assignments, agUsers]);

  if (!currentUser) return null;

  if (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG') {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">담당 CM 배정 권한이 없습니다</h2>
      </div>
    );
  }

  const selectedAg = agUsers.find((a) => a.id === selectedAgId);

  const toggleCm = (cmId: string) => {
    setCheckedCmIds((prev) =>
      prev.includes(cmId) ? prev.filter((id) => id !== cmId) : [...prev, cmId]
    );
  };

  const handleSave = () => {
    if (!selectedAgId) return;
    saveAgAssignments(selectedAgId, checkedCmIds);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            AG별 담당 CM 배정 관리
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            AG와 CM 사이의 담당 관계를 설정하고 저장합니다. 저장된 담당 범위는 해당 AG의 거래 목록
            조회, 승인 상태 변경 권한, 월별 수수료 정산 집계 범위에 즉시 적용됩니다.
          </p>
        </div>

        <Link
          to="/admin/users"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Users className="h-4 w-4" />
          사용자 계정 목록으로 이동
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: AG List */}
        <div className="space-y-3 lg:col-span-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            1. 배정 대상 AG 선택 ({agUsers.length}명)
          </h2>
          {agUsers.map((ag) => {
            const count = assignments.filter((a) => a.agId === ag.id).length;
            const active = ag.id === selectedAgId;
            return (
              <button
                key={ag.id}
                type="button"
                onClick={() => setSelectedAgId(ag.id)}
                className={`w-full rounded-2xl border p-4 text-left transition-all ${
                  active
                    ? 'border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-600'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">{ag.name} AG</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    담당 CM {count}명
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{ag.affiliation}</p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">{ag.loginId}</p>
              </button>
            );
          })}
        </div>

        {/* Right: CM Assignment Checklist */}
        <div className="lg:col-span-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  2. {selectedAg?.name} AG에게 배정할 담당 CM 선택
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  체크 후 [담당 CM 배정 저장]을 누르면 즉시 거래 접근 권한이 재설정됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                <Save className="h-4 w-4" />
                담당 CM 배정 저장 ({checkedCmIds.length}명)
              </button>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl bg-indigo-50/60 p-3 text-xs text-indigo-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
              <span>
                타 AG에 배정되어 있던 CM을 선택해 저장하면 현재 선택한{' '}
                <strong>{selectedAg?.name} AG</strong> 소속으로 자동 전환되며, 기존 거래의 승인 결과
                자체는 변경되지 않습니다.
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {cmUsers.map((cm) => {
                const isChecked = checkedCmIds.includes(cm.id);
                const currentAg = getAssignedAgForCm(cm.id);
                const cmTxCount = transactions.filter((t) => t.cmId === cm.id).length;

                return (
                  <label
                    key={cm.id}
                    onClick={() => toggleCm(cm.id)}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                      isChecked
                        ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900">{cm.name} CM</span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          누적 거래 {cmTxCount}건
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-600">{cm.affiliation}</p>
                      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                        <Link2 className="h-3 w-3 text-slate-400" />
                        {currentAg?.id === selectedAgId ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" /> 현재 {selectedAg?.name} AG 배정됨
                          </span>
                        ) : currentAg ? (
                          <span className="text-amber-700 font-medium">
                            현재 배정: {currentAg.name} AG
                          </span>
                        ) : (
                          <span className="text-rose-600 font-semibold">현재 미배정</span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
