import {
  CardPromotionItem,
  RateTableImageItem,
  RateTableRowItem,
  User,
} from '../types';

// 실제 데이터(요율·프로모션·거래·계정)는 모두 구글 시트에서 로그인 후 불러옴.
// 여기에는 로그인 전 화면이 깨지지 않을 최소 초기값만 둔다. (가짜 업무 데이터 금지)
export const INITIAL_USERS: User[] = [
  {
    id: 'usr-v2-admin',
    loginId: 'admin',
    password: '', // 비밀번호는 구글 시트 09 탭에서만 관리 (빈 값이면 로그인 불가)
    name: '총괄 관리자',
    role: 'ADMIN',
    affiliation: '카나다라 본사 어드민',
    phone: '',
    employeeId: 'KND-ADMIN-V2',
    isActive: true,
    createdAt: '2026-01-01 09:00',
  },
];

export const INITIAL_RATE_TABLE_IMAGES: RateTableImageItem[] = [];
export const INITIAL_RATE_TABLE_ROWS: RateTableRowItem[] = [];
export const INITIAL_CARD_PROMOTIONS: CardPromotionItem[] = [];
