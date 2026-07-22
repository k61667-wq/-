#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
숨고 견적 생성기 (로컬 · 설치/인증 불필요)
==========================================
의뢰서 텍스트를 넣으면 → 견적 기준표(CSV)에서 상품을 매칭하고
→ 수량·공급가·부가세·합계를 '코드로' 계산해 → 숨고 붙여넣기 문구 + 상세 견적서를
만들어 주고 → 견적로그.csv 에 자동 기록합니다.

핵심: 단가/부가세는 반드시 기준표에서만 온다(AI 환각 가격 원천 차단).

사용법
------
  # 1) 파일로 의뢰서 넣기
  python3 tools/견적생성기.py --의뢰서 sample.txt

  # 2) 붙여넣기(표준입력) — 붙여넣고 Ctrl+D
  python3 tools/견적생성기.py

  # 3) JSON 도 같이 보기(자동화 연동용)
  python3 tools/견적생성기.py --의뢰서 sample.txt --json

옵션
----
  --기준표 PATH   견적 기준표 CSV (기본: data/견적기준표_seed.csv)
  --로그 PATH     견적로그 CSV (기본: data/견적로그.csv, 없으면 생성)
  --담당 이름     상세 견적서 담당자명
  --연락처 번호   상세 견적서 연락처
  --no-log        로그 기록 생략
  --json          결과 JSON 도 함께 출력
"""
import argparse
import csv
import datetime
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_기준표 = os.path.join(BASE, "data", "견적기준표_seed.csv")
DEFAULT_로그 = os.path.join(BASE, "data", "견적로그.csv")

# 수량/기간 단위 계열 — 의뢰서에서 뽑은 수량 단위가 상품 단위와 같은 계열일 때만 채택
단위계열 = {
    "건": {"건", "개", "회"},
    "개": {"건", "개", "회"},
    "회": {"건", "개", "회"},
    "명": {"명", "분", "인"},
    "월": {"월", "개월", "달"},
}

로그_헤더 = [
    "일시", "의뢰요약", "매칭상품ID", "매칭상품명", "수량", "단위",
    "공급가", "부가세", "합계", "needs_review", "review_reason", "성사여부(수기)"
]


def 기준표_읽기(path):
    if not os.path.exists(path):
        sys.exit(f"[오류] 견적 기준표를 찾을 수 없습니다: {path}")
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit(f"[오류] 견적 기준표가 비어 있습니다: {path}")
    for r in rows:
        try:
            r["_단가"] = int(str(r.get("판매단가_부가세별도", "0")).replace(",", "").strip() or 0)
        except ValueError:
            r["_단가"] = 0
        try:
            r["_최소수량"] = int(str(r.get("최소수량", "1")).replace(",", "").strip() or 1)
        except ValueError:
            r["_최소수량"] = 1
        r["_키워드"] = [k.strip() for k in str(r.get("매칭키워드", "")).split(",") if k.strip()]
    return rows


def 상품_점수(row, text):
    """의뢰서 텍스트에 상품 매칭키워드/카테고리/채널이 몇 개 등장하는지로 점수화."""
    score = 0
    hits = []
    for kw in row["_키워드"]:
        if kw and kw in text:
            score += 1
            hits.append(kw)
    for extra, w in ((row.get("카테고리", ""), 1), (row.get("채널", ""), 1)):
        extra = (extra or "").strip()
        if extra and extra in text:
            score += w
            hits.append(extra)
    return score, hits


def 수량_추출(text, unit):
    """의뢰서에서 상품 단위와 같은 계열의 수량을 찾는다. 없으면 None."""
    허용 = 단위계열.get(unit, {unit})
    best = None
    for m in re.finditer(r"([\d,]+)\s*(건|개|회|명|분|인|월|개월|달|주|일)", text):
        num = int(m.group(1).replace(",", ""))
        u = m.group(2)
        if u in 허용 and num > 0:
            # 가장 큰 명시 수량을 채택(보통 총량을 적음)
            if best is None or num > best:
                best = num
    return best


def 예산_추출(text):
    """'예산 50만원', '월 30만', '200,000원' 등에서 예산(원)을 추정. 없으면 None."""
    # NN만(원)
    m = re.search(r"(?:예산|비용|금액)?\s*([\d,]+)\s*만\s*원?", text)
    if m:
        return int(m.group(1).replace(",", "")) * 10000
    # NNN,NNN원
    m = re.search(r"([\d,]{4,})\s*원", text)
    if m:
        return int(m.group(1).replace(",", ""))
    return None


def 콤마(n):
    return f"{n:,}"


def 의뢰_요약(text):
    line = " ".join(text.split())
    return (line[:60] + "…") if len(line) > 60 else line


def 견적_계산(rows, text, 담당, 연락처):
    scored = sorted(
        ((*상품_점수(r, text), r) for r in rows),
        key=lambda x: (x[0], x[2]["_단가"]), reverse=True
    )
    top_score, top_hits, top = scored[0]

    needs_review = False
    review_reason = ""
    후보 = []

    if top_score == 0:
        needs_review = True
        review_reason = "의뢰서에서 기준표 상품과 겹치는 키워드를 못 찾음 — 수동 확인 필요"
    else:
        # 동점 최상위가 2개 이상이면 사람이 고르게
        동점 = [s for s in scored if s[0] == top_score]
        if len(동점) > 1:
            needs_review = True
            review_reason = f"동점 후보 {len(동점)}개 — 사람이 상품 선택 필요"
            후보 = 동점[:2]

    unit = (top.get("단위") or "건").strip()
    수량 = 수량_추출(text, unit)
    assumptions = []
    if 수량 is None:
        수량 = top["_최소수량"]
        assumptions.append(f"수량 미기재 → 최소수량 {콤마(수량)}{unit} 가정")

    단가 = top["_단가"]
    if 단가 <= 0:
        needs_review = True
        review_reason = (review_reason + " / " if review_reason else "") + \
            "기준표 단가가 0/미입력 — 실제 판매가 입력 필요"

    공급가 = 단가 * 수량
    부가세 = round(공급가 * 0.10)
    합계 = 공급가 + 부가세

    예산 = 예산_추출(text)
    if 예산 is not None and 합계 > 예산:
        assumptions.append(f"의뢰 예산(약 {콤마(예산)}원) 초과 — 수량 조정 또는 대안 상품 제안 필요")
        needs_review = True
        review_reason = (review_reason + " / " if review_reason else "") + "예산 초과"

    return {
        "requester_summary": 의뢰_요약(text),
        "matched": {
            "product_id": top.get("상품ID", ""),
            "product_name": top.get("상품명", ""),
            "channel": top.get("채널", ""),
            "quantity": 수량,
            "unit": unit,
            "period": (top.get("기본기간") or "").strip(),
            "unit_price": 단가,
            "amount": 공급가,
            "설명": (top.get("상품설명_견적서용") or "").strip(),
            "hits": top_hits,
            "score": top_score,
        },
        "supply_amount": 공급가,
        "vat": 부가세,
        "total": 합계,
        "assumptions": assumptions,
        "needs_review": needs_review,
        "review_reason": review_reason,
        "후보": [{"상품ID": r.get("상품ID", ""), "상품명": r.get("상품명", ""), "점수": s} for s, _, r in 후보],
        "담당": 담당,
        "연락처": 연락처,
    }


def 채팅문구(q):
    m = q["matched"]
    효과 = (m["설명"].split(".")[0] + ".") if m["설명"] else "실제 방문형 트래픽 기반으로 안정적인 결과를 만들어 드립니다."
    부가세표기 = "부가세 별도"
    return (
        f"안녕하세요, 요청 확인했습니다.\n"
        f"주신 내용 기준으로 아래와 같이 제안드립니다.\n\n"
        f"▪ 추천: {m['product_name']} ({m['channel']})\n"
        f"▪ 수량/기간: {콤마(m['quantity'])}{m['unit']} · {m['period']}\n"
        f"▪ 견적: 공급가 {콤마(q['supply_amount'])}원 / 합계 {콤마(q['total'])}원 ({부가세표기})\n\n"
        f"{효과}\n"
        f"비슷한 업종 진행 사례와 상세 플랜 바로 보내드릴 수 있어요. 편하게 문의 주세요 :)"
    )


def 상세견적서(q, 작성일):
    m = q["matched"]
    담당 = q["담당"] or "─"
    연락처 = q["연락처"] or "─"
    유효 = (datetime.date.fromisoformat(작성일) + datetime.timedelta(days=7)).isoformat()
    lines = [
        f"■ 마케팅 견적서",
        "─────────────────────────",
        f"· 작성일: {작성일}",
        f"· 담당: {담당} / {연락처}",
        "",
        "[요청 내용 요약]",
        q["requester_summary"],
        "",
        "[제안 견적]",
        f"· 상품: {m['product_name']} ({m['channel']})",
        f"· 수량/기간: {콤마(m['quantity'])}{m['unit']} · {m['period']}",
        f"· 단가: {콤마(m['unit_price'])}원 (부가세 별도)",
        "  ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈",
        f"  공급가액   {콤마(q['supply_amount'])}원",
        f"  부가세10%  {콤마(q['vat'])}원",
        f"  합계       {콤마(q['total'])}원",
        "",
        "[상품 설명]",
        f"{m['설명']}",
        "",
        "[진행 방식]",
        "1. 계약/입금 확인 → 2. 세팅 → 3. 진행현황 공유 → 4. 완료 리포트",
        "",
        "[안내]",
        f"· 상기 금액은 {유효}까지 유효합니다.",
        "· 키워드/URL/업종에 따라 단가가 조정될 수 있습니다.",
    ]
    if q["assumptions"]:
        lines += ["", "[가정/메모]"] + [f"· {a}" for a in q["assumptions"]]
    return "\n".join(lines)


def 로그_기록(path, q, 일시):
    새파일 = not os.path.exists(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        if 새파일:
            w.writerow(로그_헤더)
        m = q["matched"]
        w.writerow([
            일시, q["requester_summary"], m["product_id"], m["product_name"],
            m["quantity"], m["unit"], q["supply_amount"], q["vat"], q["total"],
            "Y" if q["needs_review"] else "N", q["review_reason"], "",
        ])


def main():
    ap = argparse.ArgumentParser(description="숨고 견적 생성기")
    ap.add_argument("--의뢰서", dest="의뢰서")
    ap.add_argument("--기준표", dest="기준표", default=DEFAULT_기준표)
    ap.add_argument("--로그", dest="로그", default=DEFAULT_로그)
    ap.add_argument("--담당", dest="담당", default="")
    ap.add_argument("--연락처", dest="연락처", default="")
    ap.add_argument("--no-log", dest="no_log", action="store_true")
    ap.add_argument("--json", dest="as_json", action="store_true")
    ap.add_argument("--today", dest="today", default=None, help="작성일 지정(YYYY-MM-DD)")
    args = ap.parse_args()

    if args.의뢰서:
        with open(args.의뢰서, encoding="utf-8") as f:
            text = f.read()
    else:
        if sys.stdin.isatty():
            print("의뢰서 내용을 붙여넣고 Ctrl+D 를 누르세요:\n", file=sys.stderr)
        text = sys.stdin.read()

    text = text.strip()
    if not text:
        sys.exit("[오류] 의뢰서 내용이 비어 있습니다.")

    rows = 기준표_읽기(args.기준표)
    q = 견적_계산(rows, text, args.담당, args.연락처)

    작성일 = args.today or datetime.date.today().isoformat()
    일시 = 작성일 + " " + datetime.datetime.now().strftime("%H:%M") if not args.today else 작성일 + " 00:00"

    # ── 출력 ──
    print("=" * 56)
    print(f"  매칭: {q['matched']['product_name']}  (점수 {q['matched']['score']}, "
          f"근거: {', '.join(q['matched']['hits']) or '없음'})")
    if q["needs_review"]:
        print(f"  ⚠ 검토필요: {q['review_reason']}")
        if q["후보"]:
            print("    후보: " + " / ".join(f"{c['상품명']}({c['상품ID']})" for c in q["후보"]))
    print("=" * 56)
    print("\n[① 숨고 채팅 붙여넣기용]\n")
    print(채팅문구(q))
    print("\n" + "-" * 56)
    print("\n[② 상세 견적서]\n")
    print(상세견적서(q, 작성일))

    if not args.no_log:
        로그_기록(args.로그, q, 일시)
        print("\n" + "-" * 56)
        print(f"\n✔ 견적로그 기록됨 → {args.로그}")
        print("  (성사되면 '성사여부(수기)' 칸에 Y/N 를 채워 월간 품질개선에 활용하세요.)")

    if args.as_json:
        import json
        print("\n[③ JSON]\n")
        print(json.dumps(q, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
