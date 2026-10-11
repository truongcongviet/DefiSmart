# LP Smart Wallet Radar

Dashboard Next.js để theo dõi và phân loại ví LP thông minh bằng dữ liệu kết hợp:

- LP Agent API (`smart-lp` + `open-api`)
- Meteora public APIs (DLMM + DAMM v2)

## Tính năng chính

- Header điều hướng: `SmartLP`, `Pool`, `Analysis`, ...
- Màn hình Smart LP dạng bảng/card theo mẫu dashboard
- Bộ lọc và sort cho danh sách LP wallets
- API proxy server-side tới `https://api.lpagent.io/api/v1/smart-lp`
- Hỗ trợ phân tích wallet thủ công qua `POST /api/wallets/classify`

## Cấu hình

Tạo file `.env`:

```bash
API_KEY_LPSMART=your_lpagent_key_or_token
LPAGENT_BEARER_TOKEN=optional_bearer_token_for_smart_lp
LPAGENT_TURNSTILE_TOKEN=optional_turnstile_token
LPAGENT_CHAIN=SOL
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
NEXT_PUBLIC_PRIVY_CLIENT_ID=optional_privy_client_id
```

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

## Chạy local

```bash
yarn dev
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

`GET /api/lpagent/smart-lp`

Ví dụ query:

```text
/api/lpagent/smart-lp?page=1&pageSize=12&orderBy=total_pnl_native:desc&lastActivity=1D&minWinRateNative=0.7&minAvgMonthlyPnlNative=6&minTotalLp=1000
```

## Copy Engine Core

Dự án có một copy-engine độc lập với loại chiến lược. Bản đầu theo dõi transaction Solana, xác minh leader là signer thật, chuẩn hóa thay đổi tài sản, chống xử lý trùng, xếp hàng theo follower wallet và lưu audit state. Execution hiện khóa ở observe-only/dry-run cho đến khi có adapter LP, swap hoặc farming.

Xem [docs/COPY_ENGINE.md](docs/COPY_ENGINE.md) để chạy worker và tích hợp adapter.
