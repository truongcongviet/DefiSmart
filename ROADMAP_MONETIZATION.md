# SmartLP Roadmap (30 Ngày)

Roadmap này tập trung vào mục tiêu: biến project hiện tại thành sản phẩm có thể thu phí từ dữ liệu LPAgent + Meteora.

## 1) Mục tiêu sản phẩm

- Tạo hệ thống phân tích ví LP có thể hành động ngay: biết ví nào đáng theo dõi, pool nào đáng vào, rủi ro nào cần né.
- Tạo value lặp lại mỗi ngày: alert realtime + watchlist + score lịch sử.
- Có gói thu phí rõ ràng: Free/Pro/Team(API).

## 2) Mục tiêu kinh doanh (30 ngày)

- `MVP trả phí` có thể bật thanh toán và mở khóa tính năng Pro.
- `>= 20` người dùng test private, `>= 5` user trả phí đầu tiên.
- Tỷ lệ quay lại 7 ngày (`D7 retention`) >= `25%` cho user đã bật watchlist.

## 3) KPI kỹ thuật bắt buộc

- API 95th percentile latency < `1.5s` (endpoint cacheable).
- Tỷ lệ lỗi API nội bộ < `1%`.
- Có cache và precompute để tránh bị nghẽn rate-limit từ upstream.
- Mỗi tín hiệu phải có `timestamp`, `source`, `logic version`.

## 4) Những gì đã có (baseline)

- Trang `Analysis` + sidebar option theo từng cụm phân tích.
- Trang `Pool` hiển thị danh sách pool Meteora.
- API nội bộ đã có:
  - `/api/lpagent/address-analysis`
  - `/api/lpagent/trade-time-distribution`
  - `/api/meteora/pools-snapshot`

## 5) Roadmap triển khai theo tuần

## Tuần 1: Data Quality + Scoring v1

Mục tiêu: chuẩn hóa dữ liệu và chấm điểm ví ổn định.

- [ ] Tạo `WalletScore v1` (0-100):
  - Profit score
  - Stability score
  - Risk score
  - Pool selection score
- [ ] Chuẩn hóa công thức PnL summary (ưu tiên `overview`, fallback `positions sample`).
- [ ] Thêm confidence level: `HIGH/MEDIUM/LOW` theo coverage dữ liệu.
- [ ] Lưu snapshot score theo ngày (JSON/local DB tùy chọn).
- [ ] UI: thêm card `Score`, `Confidence`, `Reason`.

Deliverable tuần 1:
- Có endpoint mới: `/api/analysis/wallet-score?owner=...`
- Có bảng score history trong trang Analysis.

---

## Tuần 2: Watchlist + Alerts (value lặp lại)

Mục tiêu: user quay lại vì có tín hiệu mới.

- [ ] Tạo Watchlist:
  - Add/remove ví
  - Tag ví (`scalp`, `swing`, `high-risk`, ...)
- [ ] Tạo alert rule cơ bản:
  - Ví mở vị thế mới
  - Pool opportunity score vượt ngưỡng
  - Risk score tăng mạnh
- [ ] Notification channel:
  - Telegram bot webhook (ưu tiên)
  - Discord webhook (tùy chọn)
- [ ] UI: trang `Signals` hiển thị feed tín hiệu gần nhất.

Deliverable tuần 2:
- Có endpoint `POST /api/watchlist`, `GET /api/signals`.
- Alert chạy theo cron mỗi 5-10 phút.

---

## Tuần 3: Strategy Engine + Backtest nhẹ

Mục tiêu: chứng minh tín hiệu có edge (có thể bán).

- [ ] Tạo `Pool Opportunity Engine v1`:
  - score theo fee/tvl, volume, volatility, crowding, risk flags
- [ ] Tạo `Copy Simulation v2`:
  - giả lập follow top wallets với delay (5m/15m)
  - thống kê PnL giả lập theo ngày
- [ ] Backtest nhẹ 7D/30D:
  - top N ví theo score
  - so với baseline (random hoặc no-filter)
- [ ] UI: trang `Analysis` thêm tab `Backtest Snapshot`.

Deliverable tuần 3:
- Có endpoint `/api/backtest/summary`.
- Có chart so sánh strategy vs baseline.

---

## Tuần 4: Monetization + Launch private

Mục tiêu: bật thu phí và đo conversion.

- [ ] Định nghĩa plan:
  - Free: giới hạn watchlist + delayed signals
  - Pro: realtime signals + full analysis + export
  - Team/API: API key + rate cao hơn
- [ ] Gating tính năng theo plan (middleware hoặc server checks).
- [ ] Stripe checkout/subscription (hoặc cổng thanh toán bạn muốn dùng).
- [ ] Trang Pricing + Billing + Account usage.
- [ ] Telemetry funnel:
  - View analysis -> add watchlist -> bật alert -> upgrade.

Deliverable tuần 4:
- Có flow thanh toán và mở khóa tính năng Pro hoạt động end-to-end.

## 6) Backlog ưu tiên sau 30 ngày

- [ ] Portfolio mode: tổng hợp nhiều ví thành 1 basket.
- [ ] API public cho bên thứ 3 (`/v1/wallet-score`, `/v1/pool-opportunity`).
- [ ] Mobile-first signal page (đọc cảnh báo nhanh trên điện thoại).
- [ ] A/B test ngưỡng signal để tăng conversion.
- [ ] Multi-chain mở rộng (khi data source sẵn sàng).

## 7) Gợi ý kiến trúc code (để code dần)

- `src/lib/analysis/scoring.ts`
  - WalletScore formula + confidence.
- `src/lib/signals/engine.ts`
  - Rule engine sinh tín hiệu.
- `src/app/api/analysis/wallet-score/route.ts`
  - API score.
- `src/app/api/signals/route.ts`
  - Feed tín hiệu.
- `src/app/api/watchlist/route.ts`
  - CRUD watchlist.
- `src/app/signals/page.tsx`
  - UI tín hiệu realtime.
- `src/app/pricing/page.tsx`
  - Pricing/upgrade.

## 8) Definition of Done (DoD) cho mỗi tính năng

- Có test basic cho logic chính.
- Có loading/error/empty state ở UI.
- Có log debug tối thiểu cho API thất bại.
- Không phá vỡ typecheck/lint/build.
- Có mô tả ngắn trong changelog nội bộ.

## 9) Rủi ro cần kiểm soát

- Rate-limit từ upstream API => bắt buộc cache + retry + precompute.
- Dữ liệu partial => luôn hiển thị confidence/warning cho user.
- Tránh claim lợi nhuận chắc chắn; ghi rõ đây là dữ liệu phân tích, không phải cam kết.

## 10) Checklist tuần này (next action)

- [ ] Implement `/api/analysis/wallet-score`.
- [ ] Thêm card `WalletScore + Confidence` ở `Analysis`.
- [ ] Tạo model Watchlist local (file/json hoặc DB tùy bạn).
- [ ] Tạo `Signals` page bản đầu (list đơn giản).

