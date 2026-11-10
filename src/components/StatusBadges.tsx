import React from 'react';
import {
  APPROVAL_STATUS_META,
  ApprovalStatus,
  ROLE_META,
  Transaction,
  UserRole,
} from '../types';
import { CheckCircle2, FileSpreadsheet, AlertTriangle, Clock } from 'lucide-react';

export const ApprovalStatusBadge: React.FC<{ status: ApprovalStatus }> = ({ status }) => {
  const meta = APPROVAL_STATUS_META[status] ?? APPROVAL_STATUS_META.WAITING;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </span>
  );
};

export const RoleBadge: React.FC<{ role: UserRole; short?: boolean }> = ({ role, short }) => {
  const meta = ROLE_META[role];
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
    >
      {short ? meta.shortLabel : meta.label}
    </span>
  );
};

export const SlipAndSheetBadge: React.FC<{ tx: Transaction }> = ({ tx }) => {
  if (
    tx.status !== 'APPROVED' &&
    tx.status !== 'SLIP_REQUIRED' &&
    tx.status !== 'COMPLETED'
  ) {
    return <span className="text-xs text-slate-400">해당 없음</span>;
  }

  if (!tx.slip) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-600/20">
        <Clock className="h-3 w-3" />
        전표 제출 필요
      </span>
    );
  }

  if (tx.sheetSync.status === 'SYNCED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-600/20">
        <CheckCircle2 className="h-3 w-3" />
        전표·시트 완료
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/25">
      <AlertTriangle className="h-3 w-3" />
      시트 재처리 필요
    </span>
  );
};

export const SheetStatusPill: React.FC<{ tx: Transaction }> = ({ tx }) => {
  if (!tx.slip) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        전표 제출 대기
      </span>
    );
  }
  if (tx.sheetSync.status === 'SYNCED') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
        <FileSpreadsheet className="h-3.5 w-3.5" />
        {tx.sheetSync.externalRowId}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/20">
      <AlertTriangle className="h-3.5 w-3.5" />
      입력 실패 ({tx.sheetSync.errorCode ?? 'API_ERR'})
    </span>
  );
};
