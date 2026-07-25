/**
 * VariableMapping.gs — 계약 데이터 → 템플릿 {{변수}} 매핑의 단일 정의
 * ==================================================================
 * Google Docs 템플릿에 아래 {{키}} 를 넣어두면 그대로 치환됩니다.
 * 서비스 표(8줄)는 라인별 변수로 개별 치환:  {{항목1_수량}} {{항목1_단가}} {{항목1_금액}} ...
 *   → 템플릿 표의 각 셀에 해당 변수를 미리 배치해 두세요.
 */
function buildVariableMap(ctx) {
  var c = ctx.customer, r = ctx.rep, p = ctx.pkg;
  var map = {
    // --- 계약 메타 ---
    '{{계약번호}}':   ctx.contractNo,

    // --- 갑(고객) ---
    '{{갑_상호}}':     c.company || '',
    '{{갑_대표자}}':   c.ceo || '',
    '{{갑_사업자번호}}': c.bizNo || '',
    '{{갑_소재지}}':   c.address || '',
    '{{갑_연락처}}':   c.phone || '',
    '{{갑_이메일}}':   c.email || '',

    // --- 을(커넥트와이즈, 고정) ---
    '{{을_상호}}':     CONFIG.COMPANY.name,
    '{{을_대표자}}':   CONFIG.COMPANY.ceo,
    '{{을_사업자번호}}': CONFIG.COMPANY.bizNo,
    '{{을_소재지}}':   CONFIG.COMPANY.address,
    '{{을_연락처}}':   CONFIG.COMPANY.phone,
    '{{을_이메일}}':   CONFIG.COMPANY.email,
    '{{입금계좌}}':    CONFIG.COMPANY.bank,

    // --- 담당자 ---
    '{{담당부서}}':    r.department || '영업팀',
    '{{담당자_이름}}':  r.name || '',
    '{{담당자_연락처}}': r.phone || '',
    '{{담당자_이메일}}': r.email || '',

    // --- 패키지/금액 ---
    '{{패키지명}}':    p.name,
    '{{총공급가액}}':  won(p.supply),
    '{{패키지할인}}':  (p.discount > 0 ? '− ' + won(p.discount) : won(0)),
    '{{부가세}}':      won(p.vat),
    '{{총계약금액}}':  won(p.total),

    // --- 기간/날짜 ---
    '{{계약기간}}':    periodLabel(ctx.start, ctx.end, ctx.months),
    '{{계약시작일}}':  fmtDot(ctx.start),
    '{{계약종료일}}':  fmtDot(ctx.end),
    '{{계약기간개월}}': String(ctx.months),
    '{{계약체결일}}':  fmtKo(ctx.sign)
  };

  // --- 서비스 표: 최대 6줄. 패키지별 항목 수가 달라 미사용 줄은 빈칸 처리 ---
  // (미사용 줄은 ContractGenerator 의 trimEmptyServiceRows 가 문서에서 제거)
  var MAX_ROWS = 6;
  for (var i = 1; i <= MAX_ROWS; i++) {
    var l = p.lines[i - 1];
    map['{{항목' + i + '_명}}']   = l ? l.item : '';
    map['{{항목' + i + '_세부}}'] = l ? l.desc : '';
    map['{{항목' + i + '_수량}}'] = l ? String(l.qty) : '';
    map['{{항목' + i + '_개월}}'] = l ? String(l.months) : '';
    map['{{항목' + i + '_단가}}'] = l ? comma(l.unitPrice) : '';
    map['{{항목' + i + '_금액}}'] = l ? comma(l.amount) : '';
  }
  return map;
}
