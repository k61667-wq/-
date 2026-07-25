/**
 * Config.gs — 전역 설정 (한 곳에서만 관리)
 * ------------------------------------------------------------------
 * 배포 시 아래 3개의 ID만 실제 값으로 교체하면 됩니다.
 *  1) TEMPLATE_DOC_ID : {{변수}} 가 들어간 Google Docs 계약서 템플릿 ID
 *  2) ROOT_FOLDER_ID  : 생성된 계약서(PDF/Doc)가 저장될 최상위 Drive 폴더 ID
 *  3) COMPANY.*       : 을(커넥트와이즈) 고정 정보 (거의 바뀌지 않음)
 */
var CONFIG = {
  TEMPLATE_DOC_ID: 'PASTE_TEMPLATE_DOC_ID_HERE',
  ROOT_FOLDER_ID:  'PASTE_ROOT_DRIVE_FOLDER_ID_HERE',

  // 시트 탭 이름 (Database.gs 가 참조)
  SHEETS: {
    REPS:      'SalesReps',
    PACKAGES:  'Packages',
    PKG_ITEMS: 'PackageItems',
    CUSTOMERS: 'Customers',
    CONTRACTS: 'Contracts'
  },

  VAT_RATE: 0.10,          // 부가세율
  ROUND_UNIT: 1000,        // 할인·부가세 반올림 단위(원)
  CONTRACT_PREFIX: 'CW',   // 계약번호 접두사  → CW-YYYYMMDD-####

  // 을(대행사) 고정 정보 — 템플릿에서 {{을_상호}} 등으로 사용
  COMPANY: {
    name:    '주식회사 커넥트와이즈',
    ceo:     '임민규',
    bizNo:   '234-87-03014',
    address: '경기도 고양시 덕양구 지축1로 39, 5층 502호(지축동, 지축프라자)',
    phone:   '010-9394-9953',
    email:   '',                                   // 계산서 발행용
    bank:    '카카오뱅크 3333-3032-94626 / 유병헌'
  },

  // 자동 이메일 발송 여부(사장님 검토 후 수동 발송을 권장 → 기본 false)
  AUTO_EMAIL: false,
  // 갱신 알림: 종료 며칠 전에 담당자에게 메일
  RENEWAL_NOTICE_DAYS: 14
};
