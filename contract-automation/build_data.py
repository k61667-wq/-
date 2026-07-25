# -*- coding: utf-8 -*-
"""
Seed-data generator for the ConnectWise contract-automation system.
Runs once to produce consistent numbers across:
  - data/*.csv        (Google Sheets seed tables)
  - prototype/data.js  (standalone HTML prototype)
All monetary values are 공급가액 기준(VAT 별도). 총계약금액 = (공급가액-할인) * 1.1 (반올림).
NOTE: every number here is an EXAMPLE. Replace with real company data.
"""
import csv, json, os, math

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
PROTO = os.path.join(ROOT, "prototype")
os.makedirs(DATA, exist_ok=True)
os.makedirs(PROTO, exist_ok=True)

# ---- 8 service line items (order matches the contract Section II) ----
ITEMS = [
    # key,            item_name,        spec_unit,  unit_price(공급가), desc
    ("review",  "비즈프로필 후기",   "건",  15000, "좋은 후기와 단골 숫자로 고객 신뢰도 상승"),
    ("regular", "비즈프로필 단골",   "명",   3000, "좋은 후기와 단골 숫자로 고객 신뢰도 상승"),
    ("like",    "비즈프로필 찜",     "건",   3000, "저장(찜)으로 프로필 활성화 및 검색시 상단 노출"),
    ("post",    "소식글 작성",       "건",  30000, "업체 홍보 소식글 작성으로 비즈프로필 유입"),
    ("postlike","소식글 찜",         "건",   2000, "소식글 저장(찜)으로 노출 기간 연장 및 재방문 유도"),
    ("town",    "동네생활 게시글",   "건",  50000, "당근 동네생활 채널 운영정책을 준수한 게시글 기획·작성"),
    ("shortform","쇼폼 영상 제작",   "편", 150000, "업체 홍보 쇼폼 영상 기획·촬영·편집"),
    ("ops",     "운영·리포트",       "월", 100000, "전담 관리팀 배치, 상담 지원, 보고 리포트 발행"),
]

# ---- 4 fixed packages: quantity per line item + duration ----
# columns align to ITEMS order
PACKAGES = [
    # id,        name,          duration, qty[8],                             disc_rate
    ("PKG-STD",  "스탠다드",  3,  [20,  50,  30,  8,  40, 2, 0, 3],  0.10),
    ("PKG-DLX",  "디럭스",    6,  [40, 100,  60, 16,  80, 4, 1, 6],  0.12),
    ("PKG-PRM",  "프리미엄",  6,  [60, 150, 100, 24, 120, 8, 2, 6],  0.15),
    ("PKG-ENT",  "엔터프라이즈",12,[100,300, 200, 48, 240,16, 4,12], 0.18),
]

def krw_round(n):  # round discount / vat to nearest 1,000 won for clean quotes
    return int(round(n / 1000.0) * 1000)

# ---- build package detail + headers ----
pkg_items_rows = []
pkg_header_rows = []
packages_json = []
for pid, pname, dur, qtys, drate in PACKAGES:
    list_supply = 0
    lines = []
    for (key, iname, unit, price, desc), qty in zip(ITEMS, qtys):
        amount = qty * price
        list_supply += amount
        lines.append({"key": key, "item": iname, "unit": unit,
                      "qty": qty, "unitPrice": price, "amount": amount, "desc": desc})
        pkg_items_rows.append([pid, pname, iname, f"{qty} {unit}", qty, unit, price, amount, desc])
    discount = krw_round(list_supply * drate)
    net = list_supply - discount
    vat = krw_round(net * 0.1)
    total = net + vat
    pkg_header_rows.append([pid, pname, dur, list_supply, discount, net, vat, total, "TRUE"])
    packages_json.append({
        "id": pid, "name": pname, "durationMonths": dur,
        "listSupply": list_supply, "discount": discount, "netSupply": net,
        "vat": vat, "contractTotal": total, "lines": lines,
    })

# ---- SalesReps (example DB) ----
reps = [
    ["REP-01", "김수인", "010-1234-4567", "sikim@connectwise.co.kr",  "영업팀", "TRUE"],
    ["REP-02", "이민호", "010-2222-3456", "mhlee@connectwise.co.kr",  "영업팀", "TRUE"],
    ["REP-03", "박지훈", "010-3333-7890", "jhpark@connectwise.co.kr", "영업2팀", "TRUE"],
    ["REP-04", "정하나", "010-4444-1212", "hjung@connectwise.co.kr",  "영업2팀", "TRUE"],
]

# ---- Customers (example) ----
customers = [
    ["CUS-0001", "행복한치과의원", "김철수", "111-22-33333", "서울시 강남구 테헤란로 1", "010-9000-0001", "happy@dental.kr"],
    ["CUS-0002", "우리동네카페",   "이영희", "444-55-66666", "경기도 고양시 덕양구 2", "010-9000-0002", "cafe@town.kr"],
]

# ---- write CSVs ----
def w(name, header, rows):
    with open(os.path.join(DATA, name), "w", newline="", encoding="utf-8-sig") as f:
        cw = csv.writer(f)
        cw.writerow(header)
        cw.writerows(rows)

w("SalesReps.csv",
  ["rep_id","name","phone","email","department","active"], reps)
w("Packages.csv",
  ["package_id","package_name","duration_months","list_supply","discount","net_supply","vat","contract_total","active"],
  pkg_header_rows)
w("PackageItems.csv",
  ["package_id","package_name","item_name","spec","qty","unit","unit_price","amount","description"],
  pkg_items_rows)
w("Customers.csv",
  ["customer_id","company","ceo","biz_no","address","phone","email"], customers)
w("Contracts.csv",
  ["contract_no","created_at","customer_id","company","rep_id","rep_name","package_id","package_name",
   "supply","discount","vat","total","start_date","end_date","sign_date","status","pdf_url","doc_url"],
  [])  # empty log table (headers only)

# ---- write prototype data.js ----
proto = {
    "items": [{"key":k,"item":i,"unit":u,"unitPrice":p,"desc":d} for (k,i,u,p,d) in ITEMS],
    "packages": packages_json,
    "reps": [{"id":r[0],"name":r[1],"phone":r[2],"email":r[3],"dept":r[4]} for r in reps],
    "customers": [{"id":c[0],"company":c[1],"ceo":c[2],"bizNo":c[3],"address":c[4],"phone":c[5],"email":c[6]} for c in customers],
}
with open(os.path.join(PROTO, "data.js"), "w", encoding="utf-8") as f:
    f.write("// AUTO-GENERATED by build_data.py — example data, replace with real values.\n")
    f.write("window.CONTRACT_DB = ")
    json.dump(proto, f, ensure_ascii=False, indent=2)
    f.write(";\n")

# ---- console summary ----
print("Packages summary (예시):")
for p in packages_json:
    print(f"  {p['name']:>7} | {p['durationMonths']}개월 | 공급 {p['listSupply']:,} - 할인 {p['discount']:,} "
          f"+ VAT {p['vat']:,} = 총 {p['contractTotal']:,}원")
print("\nWrote CSVs to data/ and prototype/data.js")
