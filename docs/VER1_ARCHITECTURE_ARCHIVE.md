# Ver 1 (기존 전체 포털) 시스템 구조 아카이브 (Architecture Archive)

> **문서 목적**: Ver 2 중심 경량화 작업에 따라 제거되는 Ver 1의 전체 아키텍처, 데이터 모델, 페이지 명세, 구글 시트 탭 구조 및 비즈니스 로직을 상세히 기록하여, 추후 특정 기능이나 구조를 재사용하거나 복원할 때 참고할 수 있도록 보존합니다.

---

## 1. Ver 1 시스템 개요 및 설계 배경

* **시스템 명칭**: 카나다라 오토캐시백 관리 포털 (Ver 1.0)
* **설계 패러다임**: **정책 중심(Policy-First) 종합 관리 포털**
* **특징**:
  * 카드사별 조건 및 자격 요건(최소/최대금액, 선수금 비율, 채널, 카드종류 등)을 상세히 검증하는 승인 프로세스.
  * 조건 그룹 코드(`conditionGroupCode`)와 버전 번호(`versionNo`), 실행일자(`effectiveFrom`)를 통한 조건 버전 관리.
  * 기준일자 시뮬레이터(`systemReferenceDate`)를 통한 과거/미래 시점의 유효 조건 테스트.
  * 전표(Slip) 검토 및 6단계 승인 라이프사이클.

---

## 2. Ver 1 화면(페이지) 및 컴포넌트 구성

### 2.1 라우트 및 페이지 목록

| 라우트 경로 | 컴포넌트 파일 | 주요 역할 및 기능 |
| :--- | :--- | :--- |
| `/transactions` | `TransactionListPage.tsx` | 승인 요청 목록 조회, 상태별 필터(6단계), 검색, 일괄 승인/반려, TSV/CSV 내보내기, 전표 팝업 |
| `/transactions/:id` | `TransactionDetailPage.tsx` | 거래 건별 상세 조회, 승인/반려 처리, 전표 심사 및 승인번호 입력, 고객 정보 마스킹 해제 |
| `/requests/new` | `ApprovalRequestNewPage.tsx` | 신규 승인 요청서 작성 (거래조건 기반 카드사/거래방법 선택, 선수금/결제금액 검증) |
| `/admin/conditions` | `ConditionManagementPage.tsx` | 오토캐시백 거래조건 마스터 관리 (신규 조건 등록, 버전 관리, 시트 동기화, 기준일자 시뮬레이터) |
| `/settlements` | `SettlementPage.tsx` | 월별/카드사별 수수료 정산 대시보드 (AG 수수료, CM 수수료 집계 및 엑셀 다운로드) |
| `/sheets-sync` | `SheetsSyncPage.tsx` | 구글 시트 양방향 동기화 관리 콘솔 (01~04 탭 TSV 미리보기, 병합/대체 동기화 실행) |
| `/admin/overview` | `AdminOverviewPage.tsx` | 어드민 전용 종합 KPI 현황 (총 거래액, 승인 건수, 카드사별 점유율, 미승인/전표미제출 알림) |
| `/admin/users` | `UserManagementPage.tsx` | 전체 사용자(ADMIN, AG, CM) 계정 관리 및 활성/비활성 전환 |
| `/admin/assignments` | `AssignmentPage.tsx` | 대리점(AG)과 담당 영업사원(CM) 간의 1:N 배정 매핑 관리 |

### 2.2 레이아웃 및 공통 컴포넌트
* **`AppShell.tsx`**: 상단 네비게이션 바, 롤(ROLE)별 메뉴 분기(ADMIN / AG / CM), 실시간 기준일자 시뮬레이터 뱃지, Ver 2 전환 버튼.
* **`StatusBadges.tsx`**:
  * `ApprovalStatusBadge`: 요청대기, 심사중, 카드승인, 반려, 전표제출필요, 거래완료 6단계 뱃지.
  * `ConditionLifecycleBadge`: 현재적용중(`ACTIVE_NOW`), 실행예정(`SCHEDULED`), 기간만료(`EXPIRED`).
  * `RoleBadge`: ADMIN, AG, CM 역할 뱃지.

---

## 3. Ver 1 데이터 모델 및 타입 정의

```typescript
// 1. 거래조건 (DealCondition)
export interface DealCondition {
  id: string;
  conditionGroupCode: string; // 예: 'SS-PRE-3000', 'HD-DIR-2000'
  versionNo: number;          // 1, 2, ...
  effectiveFrom: string;      // 실행일자 (YYYY-MM-DD)
  effectiveTo: string | null; // 종료일자 (다음 버전 실행 시 자동 설정)
  cardCompany: CardCompany;   // 국민, 농협, 롯데, 삼성, 신한, 우리, 하나
  paymentMethod: PaymentMethod; // 일시불, 선입금, 신차할부, 다이렉트, 법인 등
  channelType: ChannelType;   // AG다이렉트, 카드사다이렉트, 일반제휴, 특판제휴
  cardKind: CardKind;         // 개인 신용, 개인 체크·선입금, 신규발급 전용, 기명 법인 등
  installmentTerms: string;   // 일시불 (1개월), 12/24/36개월 등
  downPaymentRule: string;    // 선수금 제한 없음, 10% 이상, 100% 선입금 등
  minAmount: number;          // 최소 결제금액 (원)
  maxAmount: number | null;   // 최대 결제금액 (원)
  title: string;              // 표준 조건명
  customerCashbackRate: number; // 고객 캐시백율 (%)
  agCommissionRate?: number;  // AG 수수료율 (%)
  cmCommissionRate: number | null; // CM 수수료율 (%)
  description: string;
  isActive: boolean;
  sheetRowId?: string;
  lastSyncedAt?: string;
  updatedAt: string;
}

// 2. 거래 상태 6단계
export type ApprovalStatus =
  | 'PENDING'       // 요청대기
  | 'IN_REVIEW'     // 심사중
  | 'APPROVED'      // 카드승인
  | 'REJECTED'      // 반려
  | 'SLIP_REQUIRED' // 전표제출필요
  | 'COMPLETED';    // 거래완료

// 3. AG-CM 배정 관계
export interface AgCmAssignment {
  id?: string;
  agId: string;
  cmId: string;
  assignedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

// 4. 조건 동기화 감사 로그
export interface ConditionSheetSyncLog {
  id: string;
  syncedAt: string;
  actorName: string;
  sourceLabel: string;
  addedCount?: number;
  updatedCount?: number;
  deprecatedCount?: number;
  sheetTabName?: string;
}
```

---

## 4. Ver 1 구글 시트 탭 스키마 (01 ~ 04 탭)

### 4.1 `01_거래조건_마스터` (Sheet ID: 0)
* **목적**: 정책별 유효 조건의 마스터 저장소
* **컬럼 목록 (A~T열)**:
  1. `시트행ID` (`COND-ROW-001` 등)
  2. `조건그룹코드` (`SS-PRE-3000` 등 동일 조건의 버전 그룹)
  3. `버전` (1, 2...)
  4. `실행일자` (`2026-10-01`)
  5. `카드사` (삼성카드, 신한카드 등)
  6. `거래방법` (일시불 오토캐시백, 선입금 캐시백, 신차 카드할부 등)
  7. `진행경로` (AG다이렉트, 카드사다이렉트, 일반제휴 등)
  8. `카드종류` (개인 신용, 개인 체크·선입금 등)
  9. `최소금액(원)`
  10. `최대금액(원)`
  11. `선수금비율조건`
  12. `할부개월조건`
  13. `표준조건명`
  14. `고객캐시백율(%)`
  15. `AG수수료율(%)`
  16. `CM수수료율(%)`
  17. `조건상세설명`
  18. `활성여부` (TRUE/FALSE)
  19. `종료일자(계산)` (`=IFERROR(INDEX(FILTER(...)))`)
  20. `현재상태(수식)` (`=IF(TODAY()<실행일자,"실행예정",IF(OR(ISBLANK(종료일),TODAY()<=종료일),"현재적용중","기간만료"))`)

### 4.2 `02_코드표_드롭다운` (Sheet ID: 1309771947)
* **목적**: 01 탭의 데이터 유효성 검사 드롭다운 목록 제공
* **구성**: 카드사(E열), 거래방법(F열), 진행경로(G열), 카드종류(H열), 선수금비율 표준안(K열).

### 4.3 `03_카드사별_실행일정_보드` (Sheet ID: 257684152)
* **목적**: 향후 실행 예정인 조건과 현재 적용 중인 조건을 카드사별 타임라인 형태로 자동 집계하여 보여주는 대시보드 시트.

### 4.4 `04_동기화_감사로그` (Sheet ID: 1258296979)
* **목적**: 웹앱과 시트 간 동기화 이력 기록
* **컬럼**: `동기화로그ID`, `동기화일시`, `실행담당자`, `연동소스 및 방식`, `신규버전 추가건수`.

---

## 5. Ver 1 핵심 비즈니스 로직

### 5.1 조건 그룹 버전 관리 및 기간 계산 (`reconcileConditionGroupDates`)
* 같은 `conditionGroupCode`를 가진 조건들은 `effectiveFrom` 순서로 정렬됩니다.
* 다음 버전(v2)의 `effectiveFrom`이 `2026-11-05`라면, 이전 버전(v1)의 `effectiveTo`는 자동으로 `2026-11-04`로 계산되어 조건 간의 공백이나 겹침이 발생하지 않도록 조율됩니다.

### 5.2 기준일자 시뮬레이션 (`systemReferenceDate`)
* 실제 오늘 날짜(`TODAY`) 대신 임의의 기준일자(예: `2026-11-02` vs `2026-11-06`)를 지정하여, 특정 시점에 어떤 조건이 활성화되었는지 시뮬레이션 판별:
  * `systemReferenceDate < effectiveFrom` ➔ `SCHEDULED` (실행 예정)
  * `effectiveFrom <= systemReferenceDate <= (effectiveTo || 9999)` ➔ `ACTIVE_NOW` (현재 적용중)
  * `systemReferenceDate > effectiveTo` ➔ `EXPIRED` (기간 만료)

---

## 6. Ver 1 복원 및 재사용 가이드

만약 Ver 1의 특정 기능(예: AG-CM 배정 관리, 세부 승인 전표 심사 모달, 거래조건 버전 관리 등)을 다시 도입해야 하는 경우:
1. 본 문서의 **2.1절 파일 목록**과 **3절 데이터 인터페이스**를 참조합니다.
2. `git log`에서 커밋 `650b766` 또는 이전 태그를 확인하면 원본 소스코드를 확인할 수 있습니다.
3. 구글 시트 탭 구성은 본 문서 **4절 스키마**를 기반으로 재생성할 수 있습니다.
