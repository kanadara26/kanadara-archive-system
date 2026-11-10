import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { User, UserRole } from '../types';
import { RoleBadge } from '../components/StatusBadges';
import {
  UserPlus,
  Edit3,
  Link2,
  ShieldAlert,
  X,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

export const UserManagementPage: React.FC = () => {
  const {
    currentUser,
    users,
    getAssignedAgForCm,
    getAssignedCmsForAg,
    saveUserAccount,
  } = useApp();

  const [roleFilter, setRoleFilter] = useState<UserRole | 'ALL'>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('CM');
  const [affiliation, setAffiliation] = useState('');
  const [phone, setPhone] = useState('');
  const [rrn, setRrn] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  if (!currentUser) return null;

  if (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG') {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">접근 권한이 없습니다</h2>
        <p className="mt-1.5 text-xs text-slate-600">
          사용자 계정 및 CM 정보 관리 화면은 운영 관리자와 권한 있는 AG만 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  const openCreateModal = () => {
    setEditingUser(null);
    setLoginId('');
    setPassword('password123');
    setName('');
    setRole('CM');
    setAffiliation('');
    setPhone('010-');
    setRrn('900101-1234567');
    setBusinessNumber('214-88-10293');
    setEmployeeId('HD-SC-202601');
    setIsActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (u: User) => {
    setEditingUser(u);
    setLoginId(u.loginId);
    setPassword('');
    setName(u.name);
    setRole(u.role);
    setAffiliation(u.affiliation);
    setPhone(u.phone);
    setRrn(u.rrn || '');
    setBusinessNumber(u.businessNumber || '');
    setEmployeeId(u.employeeId || '');
    setIsActive(u.isActive);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const res = saveUserAccount({
      id: editingUser?.id,
      loginId,
      password,
      name,
      role,
      affiliation,
      phone,
      rrn,
      businessNumber,
      employeeId,
      isActive,
    });
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setModalOpen(false);
  };

  const filteredUsers = users.filter((u) => (roleFilter === 'ALL' ? true : u.role === roleFilter));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            사용자 계정 및 CM 등록 데이터 관리
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            CM 등록 시 저장되는 <strong>이름 · 주민등록번호 · 사업자등록번호 · 전화번호 · 소속 · 사번</strong> 데이터는 AG의 거래승인 요청 화면에 그대로 자동 연동됩니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/assignments"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Link2 className="h-4 w-4 text-indigo-600" />
            AG 담당 CM 배정 화면 이동
          </Link>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <UserPlus className="h-4 w-4" />
            신규 CM / 계정 등록
          </button>
        </div>
      </div>

      {/* Role Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {(['ALL', 'CM', 'AG', 'ADMIN'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRoleFilter(r)}
            className={`rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              roleFilter === r
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {r === 'ALL'
              ? `전체 (${users.length})`
              : r === 'CM'
              ? `CM 카마스터 (${users.filter((u) => u.role === 'CM').length})`
              : r === 'AG'
              ? `AG 에이전트 (${users.filter((u) => u.role === 'AG').length})`
              : `운영 관리자 (${users.filter((u) => u.role === 'ADMIN').length})`}
          </button>
        ))}
      </div>

      {/* Users Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-5 py-3.5">이름 / 역할 / 사번</th>
                <th className="px-4 py-3.5">주민등록번호 / 사업자등록번호</th>
                <th className="px-4 py-3.5">소속 / 전화번호</th>
                <th className="px-4 py-3.5">로그인 아이디</th>
                <th className="px-4 py-3.5">담당 연결 현황</th>
                <th className="px-4 py-3.5">상태</th>
                <th className="px-5 py-3.5 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((u) => {
                const assignedAg = u.role === 'CM' ? getAssignedAgForCm(u.id) : undefined;
                const assignedCms = u.role === 'AG' ? getAssignedCmsForAg(u.id) : [];

                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{u.name}</span>
                        <RoleBadge role={u.role} short />
                      </div>
                      <div className="mt-0.5 font-mono text-xs font-bold text-indigo-600">
                        사번: {u.employeeId || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-700">
                      {u.role === 'CM' ? (
                        <div className="space-y-0.5">
                          <div>주민: {u.rrn || '-'}</div>
                          <div>사업자: {u.businessNumber || '-'}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">해당 없음 (본사/AG)</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      <div className="font-semibold text-slate-800">{u.affiliation}</div>
                      <div className="font-mono text-slate-500">{u.phone}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-700">{u.loginId}</td>
                    <td className="px-4 py-3.5 text-xs">
                      {u.role === 'CM' && (
                        <span>
                          담당 AG:{' '}
                          <strong className="text-indigo-700">
                            {assignedAg ? assignedAg.name : '미배정'}
                          </strong>
                        </span>
                      )}
                      {u.role === 'AG' && (
                        <span>
                          담당 CM ({assignedCms.length}명):{' '}
                          <strong className="text-slate-800">
                            {assignedCms.map((c) => c.name).join(', ') || '없음'}
                          </strong>
                        </span>
                      )}
                      {u.role === 'ADMIN' && (
                        <span className="text-slate-500">전체 운영 데이터 총괄</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> 활성
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                          <XCircle className="h-3 w-3" /> 비활성
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-600"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        수정
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingUser ? '계정 및 CM 등록 데이터 수정' : '신규 사용자 · CM 등록'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSave} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">이름 *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="예: 김민준"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">사번 *</label>
                  <input
                    type="text"
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    placeholder="예: HD-SC-201904"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">
                    주민등록번호 (CM 자동연동용)
                  </label>
                  <input
                    type="text"
                    value={rrn}
                    onChange={(e) => setRrn(e.target.value)}
                    placeholder="예: 880415-1248512"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">
                    사업자등록번호 (CM 자동연동용)
                  </label>
                  <input
                    type="text"
                    value={businessNumber}
                    onChange={(e) => setBusinessNumber(e.target.value)}
                    placeholder="예: 214-19-48102"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">소속 *</label>
                  <input
                    type="text"
                    required
                    value={affiliation}
                    onChange={(e) => setAffiliation(e.target.value)}
                    placeholder="예: 현대자동차 서초지점"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">전화번호 *</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">
                  로그인 아이디 (이메일 — 중복 불가) *
                </label>
                <input
                  type="email"
                  required
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="cm.kim@autodealer.kr"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">지정 역할 *</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    disabled={currentUser.role === 'AG'}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
                  >
                    <option value="CM">CM (카마스터)</option>
                    <option value="AG">AG (본사·에이전트)</option>
                    <option value="ADMIN">운영 관리자</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">계정 활성 상태</label>
                  <select
                    value={isActive ? 'ACTIVE' : 'INACTIVE'}
                    onChange={(e) => setIsActive(e.target.value === 'ACTIVE')}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="ACTIVE">활성 (로그인 허용)</option>
                    <option value="INACTIVE">비활성 (접속 차단)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">
                  비밀번호 {editingUser ? '(변경 시에만 입력)' : '(기본값 password123)'}
                </label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editingUser ? '변경하지 않으려면 비워두세요' : 'password123'}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  저장하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
