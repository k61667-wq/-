# -*- coding: utf-8 -*-
"""
Seed-data generator for the ConnectWise contract-automation system.
실데이터 기반 (2026-07 사장님 제공 견적표 4종 + 직원 13명).
생성물: data/*.csv (Sheets 탭) + prototype/data.js (프로토타입) — 숫자 항상 일치.

회계 규칙:  금액 = 수량 × 단가 (공급가액, VAT 별도)
           총공급가액 = Σ금액;  net = 공급 − 할인;  VAT = net × 10%;  계약금액 = net + VAT
"""
import csv, json, os

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data"); PROTO = os.path.join(ROOT, "prototype")
os.makedirs(DATA, exist_ok=True); os.makedirs(PROTO, exist_ok=True)

# ---- 4개 실제 패키지 (기간이 다름). 각 라인: (항목, 세부내용, 수량, 단가) ----
PACKAGES = [
  {"id":"PKG-1M","name":"동네확보 프로젝트","duration":1,"discount":70000,"lines":[
     ("비즈프로필 후기","좋은 후기로 고객 신뢰도 상승",5,5000),
     ("비즈프로필 단골","실유저 단골 유입을 통한 비즈프로필 신뢰도 상승",50,500),
     ("비즈프로필 찜","찜(저장) 수 증대로 프로필 활성화 지수 상승 및 검색 노출 순위 개선",50,500),
     ("소식글 작성","홍보용 소식글 작성으로 비즈프로필 홍보",3,15000),
     ("동네생활 게시글","동네생활 게시판 게시글 등록으로 지역 커뮤니티 내 입소문 홍보 확산",5,20000),
     ("소식글 관심","홍보용 소식글 작성 후 관심으로 상위노출 확보",100,1000),
  ]},
  {"id":"PKG-3M","name":"동네선점 프로젝트","duration":3,"discount":50000,"lines":[
     ("비즈프로필 후기","좋은 후기로 고객 신뢰도 상승",60,6000),
     ("비즈프로필 단골","실유저 단골 유입을 통한 비즈프로필 신뢰도 상승",100,500),
     ("비즈프로필 찜","찜(저장) 수 증대로 프로필 활성화 지수 상승 및 검색 노출 순위 개선",100,500),
     ("소식글 작성","홍보용 소식글 작성으로 비즈프로필 홍보",12,15000),
     ("동네생활 게시글","동네생활 게시판 게시글 등록으로 지역 커뮤니티 내 입소문 홍보 확산",8,20000),
  ]},
  {"id":"PKG-6M","name":"동네점유 프로젝트","duration":6,"discount":450000,"lines":[
     ("비즈프로필 후기","실제 후기 등록으로 비즈프로필 신뢰도 및 구매 전환율 상승",150,5000),
     ("비즈프로필 단골","실유저 단골 유입을 통한 비즈프로필 신뢰도 상승",250,500),
     ("비즈프로필 찜","찜(저장) 수 증대로 프로필 활성화 지수 상승 및 검색 노출 순위 개선",250,500),
     ("소식글 작성","홍보용 소식글 작성으로 비즈프로필 홍보",30,15000),
     ("동네생활 게시글","동네생활 게시판 게시글 등록으로 지역 커뮤니티 내 입소문 홍보 확산",20,20000),
     ("쇼츠 제작","홍보용 짧은 영상(쇼츠) 제작 및 게시로 시각적 홍보 효과 강화",1,100000),
  ]},
  {"id":"PKG-12M","name":"동네장악 프로젝트","duration":12,"discount":1500000,"lines":[
     ("비즈프로필 후기","좋은 후기로 고객 신뢰도 상승",450,5000),
     ("비즈프로필 단골","실유저 단골 유입을 통한 비즈프로필 신뢰도 상승",600,500),
     ("비즈프로필 찜","찜(저장) 수 증대로 프로필 활성화 지수 상승 및 검색 노출 순위 개선",600,500),
     ("소식글 작성","홍보용 소식글 작성으로 비즈프로필 홍보",70,5000),
     ("동네생활 게시글","동네생활 게시판 게시글 등록으로 지역 커뮤니티 내 입소문 홍보 확산",45,20000),
     ("쇼츠 제작","홍보용 짧은 영상(쇼츠) 제작 및 게시로 시각적 홍보 효과 강화",4,100000),
  ]},
]

def krw_round(n): return int(round(n/1000.0)*1000)

pkg_items_rows, pkg_header_rows, packages_json = [], [], []
for p in PACKAGES:
    supply=0; lines=[]
    for idx,(item,desc,qty,unit) in enumerate(p["lines"], start=1):
        amount=qty*unit; supply+=amount
        lines.append({"no":idx,"item":item,"desc":desc,"qty":qty,"unit":"개",
                      "months":p["duration"],"unitPrice":unit,"amount":amount})
        pkg_items_rows.append([p["id"],p["name"],idx,item,desc,qty,"개",p["duration"],unit,amount])
    discount=p["discount"]; net=supply-discount; vat=krw_round(net*0.1); total=net+vat
    pkg_header_rows.append([p["id"],p["name"],p["duration"],supply,discount,net,vat,total,"TRUE"])
    packages_json.append({"id":p["id"],"name":p["name"],"durationMonths":p["duration"],
        "listSupply":supply,"discount":discount,"netSupply":net,"vat":vat,
        "contractTotal":total,"lines":lines})

# ---- 직원 13명 (이름/전화 순서 매칭) ----
rep_raw = [
    ("김호재","010 2439 6233"),("이화인","010 2321 3431"),("한영숙","010 2588 2101"),
    ("김철현","010 9135 0979"),("김사랑","010 3496 7834"),("장민환","010 5429 5016"),
    ("최원태","010 7374 4423"),("강종섭","010 7928 1110"),("박성준","010 5733 3773"),
    ("김수인","010 5670 0588"),("이병우","010 5729 8201"),("김대환","010 5747 8499"),
    ("이푸름","010 6722 2694"),
]
def fmt_phone(s): d=s.replace(" ",""); return d[:3]+"-"+d[3:7]+"-"+d[7:]
reps=[]
for i,(name,phone) in enumerate(rep_raw, start=1):
    reps.append(["REP-%02d"%i, name, fmt_phone(phone), "", "영업팀", "TRUE"])

# ---- 고객 예시(고객 DB 미제공 → 직접 입력 가능, 예시 2건) ----
customers = [
    ["CUS-0001","(예시)행복한치과의원","김철수","111-22-33333","서울시 강남구 테헤란로 1","010-9000-0001","happy@dental.kr"],
    ["CUS-0002","(예시)우리동네카페","이영희","444-55-66666","경기도 고양시 덕양구 2","010-9000-0002","cafe@town.kr"],
]

def w(name, header, rows):
    with open(os.path.join(DATA,name),"w",newline="",encoding="utf-8-sig") as f:
        cw=csv.writer(f); cw.writerow(header); cw.writerows(rows)

w("SalesReps.csv",["rep_id","name","phone","email","department","active"],reps)
w("Packages.csv",["package_id","package_name","duration_months","list_supply","discount","net_supply","vat","contract_total","active"],pkg_header_rows)
w("PackageItems.csv",["package_id","package_name","line_no","item_name","description","qty","unit","months","unit_price","amount"],pkg_items_rows)
w("Customers.csv",["customer_id","company","ceo","biz_no","address","phone","email"],customers)
w("Contracts.csv",["contract_no","created_at","customer_id","company","rep_id","rep_name","package_id","package_name","supply","discount","vat","total","start_date","end_date","sign_date","status","pdf_url","doc_url"],[])

proto={"packages":packages_json,
       "reps":[{"id":r[0],"name":r[1],"phone":r[2]} for r in reps],
       "customers":[{"id":c[0],"company":c[1],"ceo":c[2],"bizNo":c[3],"address":c[4],"phone":c[5],"email":c[6]} for c in customers]}
with open(os.path.join(PROTO,"data.js"),"w",encoding="utf-8") as f:
    f.write("// AUTO-GENERATED by build_data.py — 실데이터(2026-07). 값 변경은 build_data.py 또는 Sheets 에서.\n")
    f.write("window.CONTRACT_DB = "); json.dump(proto,f,ensure_ascii=False,indent=2); f.write(";\n")

print("패키지 요약 (실데이터):")
for p in packages_json:
    print(f"  {p['name']:>4} | {p['durationMonths']:>2}개월 | 공급 {p['listSupply']:>9,} - 할인 {p['discount']:>9,} "
          f"+ VAT {p['vat']:>7,} = 총 {p['contractTotal']:>9,}원  ({len(p['lines'])}개 항목)")
print(f"직원 {len(reps)}명, 고객예시 {len(customers)}건 · CSV/prototype 생성 완료")
