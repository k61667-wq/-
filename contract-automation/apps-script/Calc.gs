/**
 * Calc.gs — 계약 금액 계산 로직 (단일 진실 공급원)
 * ------------------------------------------------------------------
 * 회계 규칙 (Korean 세금계산서 관행):
 *   라인 금액   = 수량 × 단가            (공급가액 기준, VAT 별도)
 *   총 공급가액 = Σ 라인 금액             (정가)
 *   할인후공급 = 총 공급가액 − 패키지할인
 *   부가세     = round(할인후공급 × 10%) → 1,000원 단위
 *   총 계약금액 = 할인후공급 + 부가세      (VAT 포함, 고객 최종 결제액)
 *
 *  Packages 시트에 계산된 값(list_supply/discount/vat/contract_total)이
 *  이미 들어 있으면 그대로 신뢰하고, 없으면 PackageItems 로 재계산합니다.
 *  → 수식이 한 곳(여기)에만 있으므로 향후 규칙 변경도 이 파일만 수정.
 */

function roundTo(n, unit) { unit = unit || CONFIG.ROUND_UNIT; return Math.round(n / unit) * unit; }

/**
 * 패키지 하나에 대한 완전한 금액표를 반환.
 * @return {{lines:Array, supply:number, discount:number, netSupply:number,
 *           vat:number, total:number, durationMonths:number, name:string}}
 */
function computePackage(packageId) {
  var pkg = findPackage(packageId);
  if (!pkg) throw new Error('패키지를 찾을 수 없습니다: ' + packageId);

  var items = getPackageItems(packageId);
  var lines = items.map(function (it) {
    var qty = Number(it.qty) || 0;
    var unit = Number(it.unit_price) || 0;
    var amount = (it.amount !== '' && it.amount != null) ? Number(it.amount) : qty * unit;
    return {
      no: Number(it.line_no) || 0, item: it.item_name, desc: it.description || '',
      qty: qty, unit: it.unit || '개', months: Number(it.months) || 0,
      unitPrice: unit, amount: amount
    };
  }).sort(function (a, b) { return a.no - b.no; });

  var supply = Number(pkg.list_supply);
  if (!supply) supply = lines.reduce(function (s, l) { return s + l.amount; }, 0);

  var discount = Number(pkg.discount) || 0;
  var net = (pkg.net_supply !== '' && pkg.net_supply != null) ? Number(pkg.net_supply) : supply - discount;
  var vat = (pkg.vat !== '' && pkg.vat != null) ? Number(pkg.vat) : roundTo(net * CONFIG.VAT_RATE);
  var total = (pkg.contract_total !== '' && pkg.contract_total != null) ? Number(pkg.contract_total) : net + vat;

  return {
    name: pkg.package_name,
    durationMonths: Number(pkg.duration_months) || 0,
    lines: lines,
    supply: supply, discount: discount, netSupply: net, vat: vat, total: total
  };
}

/** 원(₩) 포맷 */
function won(n) { return '￦' + Number(n || 0).toLocaleString('en-US'); }
/** 숫자 콤마 포맷 (₩ 없이) */
function comma(n) { return Number(n || 0).toLocaleString('en-US'); }
