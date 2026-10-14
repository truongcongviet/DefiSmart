# LP Smart Wallet Radar

Dashboard Next.js để theo dõi và phân loại ví LP thông minh. Toàn bộ dữ liệu
vị thế được tính trực tiếp từ on-chain qua Meteora Data API (miễn phí, không
cần API key):

- DLMM: `https://dlmm.datapi.meteora.ag` (portfolio, PnL từng vị thế, lịch sử sự kiện)
- DAMM v2: `https://damm-v2.datapi.meteora.ag` (vị thế đang mở và đã đóng của ví)
- Pool discovery: `https://pool-discovery-api.datapi.meteora.ag` (danh sách pool
  Top / Trending / New / All theo timeframe, tìm kiếm, phân trang bằng `after_key`)

Tầng dữ liệu nằm ở `src/lib/api/meteora-lp.ts` (fetch + chuẩn hóa, cache 2 phút
theo ví) và `src/lib/api/lp-data.ts` (tổng hợp overview, historical, revenue, logs
cho tầng phân tích).

## Tính năng chính

- Header điều hướng: `SmartLP`, `Pool`, `Analysis`, ...
- Màn hình Smart LP dạng bảng/card theo mẫu dashboard
- Bộ lọc và sort cho danh sách LP wallets
- Smart LP (`/`): leaderboard ví LP tính từ on-chain. Quét 40 pool Top và
  Trending 24h của Meteora (`LP_LEADERBOARD_POOLS`), gom mọi ví đang cung cấp
  thanh khoản, cộng dồn PnL, fee, win rate, số pool, số lần vào pool trong 24h
  đầu rồi chấm điểm. Cache 1 giờ trong bộ nhớ và lưu snapshot (xem "Lưu trữ
  snapshot"); `pnpm leaderboard:build` để precompute, `vercel.json` có cron gọi
  `/api/leaderboard/smart-lp?refresh=1` mỗi ngày.
- Smart Traders (`/traders`): leaderboard ví trade meme token tính từ swap
  on-chain, không dùng API xếp hạng trả phí. Luồng: chọn token đang sôi động
  (Meteora discovery Trending/New/Top + DexScreener launch feed) → lấy toàn bộ
  giao dịch của các pair bận nhất qua RPC → đọc chênh lệch số dư của người ký
  để biết mua/bán, giá và giá trị USD (giá SOL theo giờ từ OHLCV Meteora) →
  PnL FIFO từng ví từng token → gộp theo ví, chấm điểm, gắn cờ `sniper`, `bot`.
  Quét tăng dần: mỗi lần chạy chỉ lấy giao dịch mới hơn lần trước. Bước mở
  rộng theo ví: các ví lãi nhất ở mỗi token được đọc toàn bộ lịch sử 30 ngày
  của chính ví (`TRADER_WALLETS` ví, `TRADER_WALLET_TX` giao dịch mỗi ví) nên
  PnL của chúng phủ mọi token đã trade, không chỉ token đang theo dõi; những ví
  này đánh dấu coverage `full`, số còn lại là `pools`.
  `pnpm traders:build [tokens] [sigsPerPair]` để quét; cron gọi
  `/api/leaderboard/smart-traders?refresh=1` mỗi ngày.
- PredictSmart (`/predict`): trader thông minh trên **Polymarket**, dữ liệu từ
  Data API và Gamma API công khai của Polymarket (không cần key), theo đúng
  cách front-end Polymarket gọi. Ứng viên lấy từ leaderboard PnL/volume theo
  tuần, tháng, toàn thời gian và theo danh mục; với mỗi ví đọc toàn bộ vị thế
  đã tất toán (lệnh thắng ở `/closed-positions`, lệnh thua nằm trong
  `/positions` ở giá 0) rồi gộp theo thị trường để tính win rate, ROI, profit
  factor, độ tập trung lợi nhuận, danh mục sở trường, mức cược, vị thế đang mở.
  Điểm ưu tiên ví có thể copy được: nhiều thị trường, lãi đều, không phải cá
  voi, còn hoạt động. Trang `/predict/[address]` hiển thị vị thế đang mở để
  copy (link thẳng sang thị trường trên Polymarket), lệnh đã tất toán gần đây
  và giao dịch mới nhất; nút theo dõi lưu trong trình duyệt.
  `pnpm predict:build [traders]` để quét; cron gọi
  `/api/leaderboard/smart-predict?refresh=1` mỗi ngày.
- Tab Perp trong PredictSmart (`/predict?tab=perp`): tài khoản trade perp trên
  Polymarket Perps, từ API info công khai `api.perpetuals.polymarket.com`
  (leaderboard theo tài khoản, bảng lệnh thắng lớn nhất, fills có PnL từng lệnh,
  portfolio, chuỗi PnL theo ngày). Mỗi tài khoản đọc 300 fill gần nhất để tính
  win rate và profit factor trên lệnh đã chốt, chuỗi PnL 30 ngày để tính số ngày
  dương và drawdown, portfolio để biết vị thế đang mở và đòn bẩy. Cờ cảnh báo:
  đã bị thanh lý, lợi nhuận tập trung một lệnh, cá voi, đòn bẩy trên 10x, không
  hoạt động. Trang `/predict/perp/[address]` có biểu đồ PnL ngày, vị thế đang
  mở để copy, lệnh đã chốt, thống kê theo thị trường. `pnpm perp:build`; cron
  gọi `/api/leaderboard/smart-perp?refresh=1`.
- Trang token (`/token/[mint]`): ví lãi nhất trong token đó, thứ hạng vào sớm,
  thời gian giữ, trạng thái đã thoát hay đang giữ, và danh sách swap gần nhất.
  Token chưa có trong snapshot được quét tại chỗ (tối đa 1.600 giao dịch).
- Phân tích ví (`/analysis`): ngoài phần LP có thêm bảng "Token trading" đọc từ
  chính giao dịch của ví trong 30 ngày (tối đa 600 giao dịch) và tính PnL theo
  từng token.
- Watchlist (`/watchlist`): theo dõi ví, xem vị thế mở hoặc đóng trong 7 ngày
  gần nhất qua `/api/wallets/[owner]/activity`. Danh sách lưu trong trình duyệt.
- Landing cũ chuyển sang `/welcome`.
- Phân tích ví theo địa chỉ: score, phân loại, timeline, phân bố giờ giao dịch
- Chi tiết pool (`/pool/[address]`): danh sách ví đang cung cấp thanh khoản trong
  pool, lấy từ on-chain qua Solana RPC, kèm tiền nạp, fee, PnL của từng ví trong
  pool đó tính từ Meteora Data API
- Hỗ trợ phân tích wallet thủ công qua `POST /api/wallets/classify`

## Cấu hình

Tạo file `.env` (mọi biến đều tùy chọn; phân tích LP không cần API key):

```bash
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
NEXT_PUBLIC_PRIVY_CLIENT_ID=optional_privy_client_id
# Số pool DLMM tối đa quét cho một ví (mặc định 80). Ví càng nhiều pool càng tốn request.
LP_DATA_MAX_POOLS=80
# Solana RPC dùng để liệt kê vị thế của một pool. Mặc định là RPC công khai
# https://api.mainnet-beta.solana.com; đặt RPC riêng (Helius, Triton...) nếu bị rate-limit.
SOLANA_RPC_URL=
# Số ví tối đa phân tích cho một pool (mặc định 120)
POOL_LPERS_MAX_WALLETS=120
# Số pool quét cho leaderboard Smart LP (mặc định 40, gồm 40% trending)
LP_LEADERBOARD_POOLS=40
# RPC đọc lịch sử giao dịch (swap). Mặc định https://solana-rpc.publicnode.com,
# miễn phí và không cần key; RPC công khai mặc định của Solana gần như không
# cho gọi getTransaction.
SOLANA_TX_RPC_URL=
# Ngân sách mỗi lần quét Smart Traders
TRADER_TOKENS=16
TRADER_PAIRS_PER_TOKEN=2
TRADER_SIGS_PER_PAIR=1500
TRADER_MAX_TX=25000
# Wallets read in full per run (their own 30-day history) and tx per wallet
TRADER_WALLETS=80
TRADER_WALLET_TX=400
# Postgres (Neon/Supabase free tier) để lưu snapshot trên Vercel; bỏ trống thì
# dùng file data/*.json
DATABASE_URL=
```

### Lưu trữ snapshot

Leaderboard và kho swap được lưu qua `src/lib/store/snapshot-store.ts`:

- Không có `DATABASE_URL`: ghi `data/<kind>.json` và giữ 20 bản gần nhất trong
  `data/history/<kind>/`. Trên Vercel hệ thống file chỉ đọc nên chỉ còn cache
  trong bộ nhớ và file đã commit cùng mã nguồn.
- Có `DATABASE_URL`: bảng `snapshots` tự tạo khi chạy lần đầu, mọi lần quét
  (local, cron, `?refresh=1`) đều ghi vào đó và được giữ 20 bản mỗi loại.

Giới hạn của nguồn on-chain:

- Chỉ phủ Meteora DLMM và DAMM v2. Vị thế trên protocol khác không được tính.
- Ví có nhiều hơn `LP_DATA_MAX_POOLS` pool DLMM sẽ được quét theo pool mới đóng
  gần nhất, kết quả có cảnh báo trong `meta.warnings` của overview.
- Lịch sử sự kiện (add/remove/claim) chỉ có cho DLMM. Số dư token không có.
- Trang chi tiết pool chỉ liệt kê được ví **đang còn vị thế mở** (account vị thế
  đã đóng không còn trên chain). PnL của mỗi ví trong pool thì tính cả các vị
  thế đã đóng của ví đó.

Giới hạn của phần Smart Traders:

- Chỉ nhận swap mà **người ký giao dịch** nhận hoặc trả token và trả hoặc nhận
  SOL/USDC/USDT. Bot MEV, swap qua tài khoản PDA và swap token-sang-token bị
  bỏ qua (chúng cũng không copy được).
- Pool trending trên PumpSwap có tới 90% giao dịch là bot không chuyển token,
  nên số swap thu được trên mỗi 1.000 giao dịch thấp; quét tăng dần qua nhiều
  ngày sẽ tích lũy đủ dữ liệu.
- Token bán mà không thấy lệnh mua trong cửa sổ quét được loại khỏi PnL
  (`untrackedSoldTokens`), nên PnL có xu hướng thấp hơn thực tế chứ không cao hơn.

Trong Privy Dashboard, bật hai phương thức đăng nhập `Wallet` và `Email`, bật
embedded wallet cho cả Solana và Ethereum, và thêm domain local/production của
ứng dụng.

## Luồng đăng nhập

Luồng mô phỏng đúng cách LP Agent onboard người dùng:

1. **Connect** trên header mở modal của app với ba lựa chọn:
   - `Solana wallet`: Phantom, Solflare, Backpack, WalletConnect QR (Privy modal, lọc `solana-only`).
   - `Robinhood Chain wallet`: MetaMask, Rabby, WalletConnect QR (Privy modal, lọc `ethereum-only`).
   - `Continue with email`: nhập email, nhận mã 6 số, nhập mã ngay trong modal (headless OTP).
     Trình duyệt trong ví mobile được nhận diện tự động như ví extension.
2. Ví ký một message không tốn gas (SIWS/SIWE do Privy xử lý).
3. **Tài khoản gắn với đúng một mạng.** Ví Solana suy ra Solana, ví 0x suy ra Robinhood Chain,
   còn email thì chọn mạng ở bước tiếp theo.
4. **Agent wallet** (Privy embedded wallet) được tạo ngay trên mạng đó. Tài khoản cũ đã có agent
   wallet thì đăng nhập xong là đóng modal, không hỏi lại.
5. Modal hiển thị địa chỉ agent wallet, gợi ý nạp `SOL` hoặc `ETH/USDG` và mức tối thiểu.
6. Menu tài khoản trên header: địa chỉ agent và ví login, link explorer, export private key,
   link thêm email hoặc ví, disconnect.
7. (Tuỳ chọn) Server đổi Privy access token lấy cookie `lps_session` httpOnly hạn **7 ngày**
   qua `POST /api/auth/session`. Cần `PRIVY_VERIFICATION_KEY` và `SESSION_SECRET`; thiếu thì
   route trả 503 và app bỏ qua phần này.

File liên quan:

- `src/components/auth/auth-flow-provider.tsx`: điều phối toàn bộ luồng.
- `src/components/auth/connect-modal.tsx`: UI các bước.
- `src/components/auth/connect-wallet-button.tsx`: nút trên header và menu tài khoản.
- `src/lib/chains.ts`: định nghĩa Robinhood Chain (id 4663) và metadata hai mạng.
- `src/lib/auth/server-session.ts`, `src/app/api/auth/session/route.ts`: session 7 ngày.

Ở giai đoạn này app chưa delegate ví, chưa cấp session signer và chưa cho agent
tự ký transaction.

## Hệ thống giao diện

Giao diện theo kỷ luật của [Hallmark](https://github.com/Nutlope/hallmark): genre
atmospheric, theme Midnight, macrostructure Workbench.

- Token màu OKLCH trong `src/app/globals.css` (`@theme`): nền `paper` than lạnh hue 250,
  chữ `ink`, một accent cyan duy nhất, không dùng đen/trắng thuần, không gradient chữ.
- Chữ: Geist (display weight 300, body 400) và Geist Mono (nhãn, địa chỉ, wordmark). Tối đa
  hai họ chữ.
- Nav dạng pill nổi (N5), footer một dòng (Ft2), hero tách đôi với khung sản phẩm thật
  thay cho lưới 3 card marketing.
- Công thức nút và ô nhập dùng chung trong `src/lib/ui.ts`; ô nhập và nút cùng cao 44px,
  focus ring bằng `outline`, slot thông báo lỗi giữ chỗ sẵn để không nhảy layout.
- Chuyển động chỉ dùng `opacity` và `transform`, có fallback `prefers-reduced-motion`.

## Test

```bash
pnpm test
```

Test đơn vị cho tầng chuẩn hóa dữ liệu Meteora (`src/lib/api/*.test.ts`) và
copy engine. Chạy bằng `node --test` qua `tsx`, không cần framework.

## Chạy local

Project dùng **pnpm** (khai báo trong `packageManager`). pnpm dùng content-addressable
store nên `node_modules` nhẹ hơn nhiều so với yarn classic với cây dependency của Privy.

```bash
pnpm install
pnpm dev
```

Mở `http://localhost:3000`.

## API nội bộ

`POST /api/wallets/classify`

Body:

```json
{
  "wallets": ["wallet1", "wallet2"]
}
```

Response gồm:

- `results`: danh sách wallet đã phân tích
- `errors`: wallet lỗi (nếu có)
- `successCount`, `failureCount`

`GET /api/meteora/pools?timeframe=2h&category=top&q=&after_key=&quality=1`

Proxy có cache 45 giây tới pool discovery API. `quality=0` tắt bộ lọc chất
lượng mặc định của Meteora. Trang `/pool` render lần đầu bằng dữ liệu live và
tự rơi về `data/met_pools_2h_top.json` nếu API không phản hồi.

`GET /api/pools/[address]/lpers?protocol=dlmm|damm_v2`

Trả về metadata pool, tổng hợp và danh sách ví đang trong pool kèm PnL. Thêm
`refresh=1` để bỏ qua cache 3 phút.

`GET /api/leaderboard/smart-traders`

Snapshot Smart Traders (không kèm swap thô). `refresh=1` chạy quét tăng dần và
chờ kết quả; `tokens`, `sigs` giới hạn ngân sách cho lần chạy đó. Trả 503 khi
chưa có snapshot nào.

`GET /api/tokens/[mint]/traders`

Ví đã trade token đó trong 14 ngày: PnL FIFO, số lệnh, thời gian giữ, thứ hạng
mua sớm, cùng điểm tổng thể nếu ví có trong leaderboard. Token chưa được theo
dõi sẽ được quét tại chỗ qua DexScreener + RPC, cache 3 phút.

`GET /api/wallets/[owner]/trades?limit=600`

Lịch sử swap của một ví trong 30 ngày đọc trực tiếp từ RPC, PnL theo từng token,
điểm và cờ. `limit` là số giao dịch tối đa được đọc (50–1000).

`GET /api/leaderboard/smart-predict`

Leaderboard PredictSmart có phân trang: `page`, `pageSize`, `sort`, `dir`,
`minMarkets`, `minWin`, `maxStake`, `category`, `hideInactive`, `hideWhales`,
`q`. `refresh=1` quét lại và chờ kết quả.

`GET /api/predict/traders/[address]`

Hồ sơ một ví Polymarket bất kỳ: chỉ số, vị thế đang mở, lệnh đã tất toán,
giao dịch gần đây. Cache 5 phút.

`GET /api/leaderboard/smart-perp`

Leaderboard Perp có phân trang: `page`, `pageSize`, `sort`, `dir`, `minTrades`,
`minWin`, `maxFill`, `category` (crypto, equity, index, commodity),
`hideInactive`, `hideLiquidated`, `hideWhales`, `q`. Kèm 20 lệnh thắng lớn nhất
tháng. `refresh=1` quét lại.

`GET /api/predict/perps/[address]`

Hồ sơ một tài khoản Perps: chỉ số, chuỗi PnL ngày, vị thế mở, 100 fill gần nhất.

`GET /api/lpagent/smart-lp`

Đọc từ seed snapshot cục bộ, hỗ trợ `page`, `pageSize`, `orderBy`, `minTotalLp`,
`minWinRateNative`, `minTotalPnlNative`. Tham số `lastActivity` được chấp nhận
nhưng bỏ qua vì snapshot là dữ liệu tĩnh.

Ví dụ query:

```text
/api/lpagent/smart-lp?page=1&pageSize=12&orderBy=total_pnl_native:desc&lastActivity=1D&minWinRateNative=0.7&minAvgMonthlyPnlNative=6&minTotalLp=1000
```

## Copy Engine Core

Dự án có một copy-engine độc lập với loại chiến lược. Bản đầu theo dõi transaction Solana, xác minh leader là signer thật, chuẩn hóa thay đổi tài sản, chống xử lý trùng, xếp hàng theo follower wallet và lưu audit state. Execution hiện khóa ở observe-only/dry-run cho đến khi có adapter LP, swap hoặc farming.

Xem [docs/COPY_ENGINE.md](docs/COPY_ENGINE.md) để chạy worker và tích hợp adapter.
