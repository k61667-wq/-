# 시드 데이터 (Google Sheets 5개 탭)

각 CSV 를 동일 이름의 시트 탭에 붙여넣으세요. **모든 숫자는 예시** — 실제 값으로 교체하세요.
(`build_data.py` 로 재생성 가능. CSV 와 `prototype/data.js` 숫자가 항상 일치합니다.)

| 파일 | 탭 | 교체 대상 |
|---|---|---|
| `SalesReps.csv` | SalesReps | 담당자 이름·연락처·이메일 |
| `Packages.csv` | Packages | 4개 패키지의 기간·할인 (net/vat/total 은 비워도 자동) |
| `PackageItems.csv` | PackageItems | **가장 중요** — 항목별 수량·단가 |
| `Customers.csv` | Customers | 자주 계약하는 고객(선택) |
| `Contracts.csv` | Contracts | 헤더만 — 생성 이력이 자동 append |

## 회계 규칙
```
금액 = 수량 × 단가            (공급가액, VAT 별도)
총공급가액 = Σ금액
계약금액 = (공급가액 − 할인) + 부가세(=할인후공급×10%, 1,000원 반올림)   ← VAT 포함
```
할인·부가세 계산은 `apps-script/Calc.gs` 에 정의되어 있습니다.
