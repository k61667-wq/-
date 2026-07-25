/**
 * Code.gs — 진입점 / 메뉴 / 사이드바 서버 핸들러 / 계약 생성 오케스트레이션
 * ==================================================================
 * 사용 흐름
 *   시트 열기 → 상단 메뉴 "📄 계약서 자동생성 → 계약서 만들기"
 *   → 사이드바에서 고객·담당자·패키지·날짜 선택 → [계약서 생성]
 *   → Docs 병합 → PDF 변환 → Drive 저장 → Contracts 로그 → (선택)메일
 */

/** 스프레드시트 열릴 때 커스텀 메뉴 추가 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📄 계약서 자동생성')
    .addItem('계약서 만들기', 'showSidebar')
    .addSeparator()
    .addItem('갱신 예정 계약 확인(수동)', 'checkRenewalsNow')
    .addItem('초기 설정 점검', 'runSetupCheck')
    .addToUi();
}

/** 사이드바 표시 */
function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('계약서 자동 작성')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

/* ---------------- 사이드바 → 서버 데이터 공급 ---------------- */

/** 드롭다운 초기 데이터(고객·담당자·패키지 요약)를 한 번에 반환 */
function getFormData() {
  return {
    reps: getReps().map(function (r) {
      return { id: r.rep_id, name: r.name, phone: r.phone, email: r.email, dept: r.department };
    }),
    customers: getCustomers().map(function (c) {
      return { id: c.customer_id, company: c.company, ceo: c.ceo, bizNo: c.biz_no,
               address: c.address, phone: c.phone, email: c.email };
    }),
    packages: getPackages().map(function (p) {
      var calc = computePackage(p.package_id);
      return { id: p.package_id, name: calc.name, duration: calc.durationMonths, total: calc.total };
    })
  };
}

/** 패키지 선택 시 라인/합계 미리보기 반환 */
function previewPackage(packageId) {
  var c = computePackage(packageId);
  return {
    name: c.name, duration: c.durationMonths,
    lines: c.lines.map(function (l) {
      return { no: l.no, item: l.item, qty: l.qty, months: l.months,
               unit: l.unitPrice, amount: l.amount };
    }),
    supply: c.supply, discount: c.discount, vat: c.vat, total: c.total
  };
}

/* ---------------- 계약 생성 (핵심) ---------------- */

/**
 * 사이드바가 넘긴 payload 로 계약서를 생성한다.
 * payload = {customerId, repId, packageId, startDate('yyyy-MM-dd'),
 *            months, signDate('yyyy-MM-dd'), sendEmail(bool),
 *            manualCustomer? {company,ceo,bizNo,address,phone,email}}
 * @return {{ok, contractNo, pdfUrl, docUrl, folderUrl, message}}
 */
function createContract(payload) {
  try {
    // 1) 데이터 수집 -------------------------------------------------
    var rep = findRep(payload.repId);
    if (!rep) throw new Error('담당자를 선택하세요.');
    var pkg = computePackage(payload.packageId);

    var cust = payload.customerId ? findCustomer(payload.customerId) : null;
    var customer = cust ? {
      company: cust.company, ceo: cust.ceo, bizNo: cust.biz_no,
      address: cust.address, phone: cust.phone, email: cust.email
    } : (payload.manualCustomer || {});

    // 2) 날짜/기간/계약번호 -----------------------------------------
    var start = parseDate(payload.startDate);
    var months = Number(payload.months) || pkg.durationMonths;
    var end = addMonthsEnd(start, months);
    var sign = parseDate(payload.signDate);
    var contractNo = nextContractNo(sign);

    // 3) 변수 맵 구성 (VariableMapping.gs 참조) ---------------------
    var vars = buildVariableMap({
      contractNo: contractNo, customer: customer, rep: rep,
      pkg: pkg, start: start, end: end, months: months, sign: sign
    });

    // 4) Docs 병합 → PDF → Drive 저장 -------------------------------
    var out = generateDocuments(contractNo, customer, pkg, start, vars);

    // 5) Contracts 시트에 로그 --------------------------------------
    logContract({
      contractNo: contractNo, customerId: payload.customerId || '', customer: customer,
      rep: rep, packageId: payload.packageId, pkg: pkg,
      start: start, end: end, sign: sign, pdfUrl: out.pdfUrl, docUrl: out.docUrl
    });

    // 6) 이메일(선택) ----------------------------------------------
    var emailed = false;
    if (payload.sendEmail && customer.email) {
      emailContract(customer.email, contractNo, customer, pkg, out.pdfBlob);
      emailed = true;
    }

    return {
      ok: true, contractNo: contractNo,
      pdfUrl: out.pdfUrl, docUrl: out.docUrl, folderUrl: out.folderUrl,
      message: '계약서 생성 완료' + (emailed ? ' · 이메일 발송됨' : '')
    };
  } catch (e) {
    return { ok: false, message: '오류: ' + e.message };
  }
}

/** Contracts 탭에 한 줄 추가 (상태 추적) */
function logContract(o) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.CONTRACTS);
  sh.appendRow([
    o.contractNo, new Date(), (o.customerId || ''), o.customer.company,
    o.rep.rep_id, o.rep.name, (o.packageId || ''), o.pkg.name,
    o.pkg.supply, o.pkg.discount, o.pkg.vat, o.pkg.total,
    fmtDot(o.start), fmtDot(o.end), fmtDot(o.sign),
    '작성완료', o.pdfUrl, o.docUrl
  ]);
}

/** 메뉴에서 수동 갱신 체크 */
function checkRenewalsNow() {
  var n = checkRenewals();
  SpreadsheetApp.getUi().alert(n + '건의 갱신 예정 계약에 대해 담당자 알림을 발송했습니다.');
}
