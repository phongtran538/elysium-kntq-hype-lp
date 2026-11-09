# Pool HYPE/KNTQ trên Elysium

Đây là trang web chạy trên máy bạn, để thêm thanh khoản vào pool HYPE/KNTQ trên Uniswap V4 (phí 1%, tickSpacing 200, không có hook) ở mạng Elysium. Elysium là L2 của Kinetiq, chain id `99901`, phí gas trả bằng HYPE.

Tiền nằm trong ví của bạn. Trang này không giữ private key, không có server. Bạn tự bấm ký từng giao dịch trong ví.

Giao diện trang đang là tiếng Trung. Phần dưới giải thích từng chỗ bằng tiếng Việt, làm theo thứ tự là được.

## Cần cài gì

Cài **Node.js bản 20.19 trở lên**. Bản 22.12 trở lên cũng được. Đừng dùng bản 21.

Tải ở [https://nodejs.org](https://nodejs.org) (bản LTS). Cài xong, mở **Command Prompt** và gõ:

```bat
node -v
```

Phải thấy `v20.19...` hoặc `v22.12...` trở lên.

Cài **Git** ở [https://git-scm.com/download/win](https://git-scm.com/download/win). Next hết cũng được. Xong thì gõ:

```bat
git --version
```

## Chạy trang web

Mở Command Prompt. Copy từng dòng, dán vào, Enter.

```bat
git clone https://github.com/phongtran538/elysium-kntq-hype-lp.git
cd elysium-kntq-hype-lp
npm ci
npm run dev
```

`npm ci` cài đúng phiên bản trong `package-lock.json`. Đừng dùng `npm install` trừ khi bạn cố ý sửa thư viện.

Khi thấy dòng kiểu `Local: http://localhost:5173/`, mở trình duyệt vào:

http://localhost:5173

Muốn tắt trang thì quay lại cửa sổ đen, bấm **Ctrl+C**.

## Thêm mạng Elysium vào ví

Dùng MetaMask hoặc ví tương tự trên trình duyệt. Nếu ví chưa có mạng này, bấm nút vàng trên trang (chuyển sang Elysium) để ví tự thêm. Hoặc thêm tay:

| Ô | Điền |
| --- | --- |
| Tên mạng | Elysium |
| Chain ID | 99901 |
| Ký hiệu tiền | HYPE |
| Số thập phân | 18 |
| RPC | https://rpc-live.boxa.club |
| Explorer | https://elyscan.fun |

Trang còn hỏi thêm mấy RPC dự phòng nếu cái đầu chết: `rpc.boxa.club`, `rpc.eleos.fun`, `rpc.elysiumswap.finance`, `rpc.stockium.fun`.

Trong ví phải có một ít HYPE để trả gas, và KNTQ nếu bạn muốn bỏ KNTQ vào pool.

## Dùng trang thế nào

1. Bấm nút xanh góc trên để nối ví. Ký trong ví nếu nó hỏi.
2. Nhìn dòng giá. Đó là giá đọc từ hợp đồng, 1 HYPE đổi được bao nhiêu KNTQ.
3. Dải xanh hoặc đỏ phía trên là đối chiếu giá. Trang hỏi **ít nhất 2 RPC**. Nếu các RPC lệch nhau **quá 1%**, trang báo đỏ và **không cho gửi giao dịch**. Bấm làm mới rồi đợi chúng khớp lại.
4. Chọn khoảng giá (các nút ±2%, ±5%, ±10%, ±20%, full, hoặc tự gõ tick). Tick phải chia hết cho 200.
5. Gõ số HYPE và số KNTQ muốn bỏ vào. Nút nét đứt lấy theo số dư, nhưng chừa khoảng 0.08 HYPE trả gas.
6. Đọc cảnh báo vàng/đỏ nếu giá đang **ngoài khoảng** hoặc **cách mép khoảng trong vòng 5%**. Lúc đó vị thế gần như không nhận phí.
7. Bảng nhỏ phía dưới là **tổn thất tạm thời** (impermanent loss): nếu giá chạy ±10%, ±20%, ±50% thì vị thế có thể ít tiền hơn là cứ cầm hai đồng trong ví. Chưa tính phí swap bạn nhận được.
8. Bấm nút xanh lớn để mở bảng xác nhận. Bảng này liệt kê đúng 3 địa chỉ, có link explorer, và số lượng:
   - **PositionManager** `0x1d1c51b9d07fd27d36412a2b66cc23d19eb3e518` — hợp đồng bạn gọi để thêm/rút thanh khoản
   - **Permit2** `0x000000000022d473030f116ddee9f6b43ac78ba3` — chỉ khi cần cho phép tiêu KNTQ
   - **KNTQ** `0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0` — token
9. Đối chiếu từng địa chỉ với ví. Đúng rồi mới ký. Mỗi bước một cửa sổ: approve KNTQ, rồi Permit2, rồi giao dịch chính. Trang không xin quyền unlimited. Permit2 hết hạn khoảng 1 giờ.
10. Rút phí hoặc rút hết pool ở cột bên phải. Cũng qua bảng xác nhận, cũng bị chặn nếu các RPC lệch giá.

Ô HYPE/USD chỉ để bạn tự gõ cho dễ nhìn. Trang không tự bịa giá đô.

## Bot tự cân bằng lại

Bot là chương trình chạy trong Command Prompt. Nó canh vị thế của **một ví riêng**. Khi giá sát mép khoảng (mặc định 5%) hoặc ra ngoài khoảng, nó sẽ:

1. Rút hết thanh khoản, gom phí, đốt NFT vị thế.
2. Swap **đúng pool V4 này** vừa đủ để hai đồng khớp khoảng mới (có trần trượt giá).
3. Mở vị thế mới = giá hiện tại ±20% (làm tròn tick 200).

Mặc định `DRY_RUN=true`: nó **chỉ in ra** nó định làm gì, **không gửi** giao dịch.

### Làm ví riêng

Đừng dùng ví chính, đừng dùng ví đang giữ nhiều tiền.

1. Trong MetaMask: tạo tài khoản mới. Đặt tên kiểu `bot-lp`.
2. Chuyển sang mạng Elysium.
3. Chỉ gửi **một ít** HYPE và KNTQ vào. Mất thì chỉ mất phần đó.
4. Bấm ba chấm của tài khoản đó → Account details → Show private key. Gõ mật khẩu ví. Copy khoá. Khoá này chỉ để trong file trên máy bạn.

Đừng gửi khoá cho ai. Không gửi vào chat, không gửi cho người tự xưng hỗ trợ, không dán lên ảnh. Ai hỏi khoá cũng là lừa.

### Tạo file .env

Trong thư mục project (cùng chỗ có `package.json`), Command Prompt:

```bat
copy .env.example .env
notepad .env
```

Sửa các dòng:

- `PRIVATE_KEY=` dán khoá vừa copy. Có `0x` phía trước cũng được, không có cũng được.
- Để nguyên `DRY_RUN=true` lần đầu.
- `RANGE_PCT=20` là khoảng mới ±20%.
- `TRIGGER_PCT=5` là kích hoạt khi cách mép 5% hoặc đã ra ngoài.
- `POLL_SECONDS=30` là hỏi giá mỗi 30 giây.
- `MAX_SLIPPAGE_BPS=50` là trượt giá tối đa 0,5%.
- `MIN_REBALANCE_INTERVAL_MINUTES=60` là sau mỗi lần chuyển vị thế thì nghỉ ít nhất 60 phút.
- `MAX_GAS=1500000` là nếu gas ước lượng cao hơn thì hủy.
- `GAS_RESERVE_HYPE=0.08` là luôn để lại 0.08 HYPE trả gas, bot không đụng vào.
- `RPC_URLS` cần **ít nhất 2** địa chỉ, cách nhau bằng dấu phẩy.

Save, tắt Notepad.

File `.env` không được commit lên git. Đừng gửi file đó cho ai.

### Chạy thử, rồi mới chạy thật

Xem giá và vị thế, không gửi gì:

```bat
npm run bot -- --status
```

Nó in giá từng RPC, khoảng tick của vị thế, đang trong hay ngoài khoảng, và phí chưa rút. Log cũng ghi vào `logs\bot.log`.

Chạy vòng lặp nhưng vẫn không gửi (vì DRY_RUN=true):

```bat
npm run bot
```

Đọc chữ tiếng Việt trên màn hình. Nó sẽ nói rõ sẽ gọi hợp đồng nào, swap bao nhiêu, mint khoảng nào.

Khi bạn thấy kế hoạch đúng và chấp nhận rủi ro bên dưới, tắt bot bằng **Ctrl+C**, mở lại `.env`, đổi thành:

```bat
DRY_RUN=false
```

Rồi chạy lại:

```bat
npm run bot
```

Lúc này nó gửi giao dịch thật. Muốn dừng: bấm **Ctrl+C** một lần, đợi nó xong việc đang làm. Bấm lần nữa thì thoát ngay (giao dịch đã lên mạng vẫn cứ chạy).

Bot **không tự mở vị thế lần đầu**. Bạn tạo vị thế trên trang web trước, rồi mới để bot canh.

## Rủi ro, đọc trước khi bật DRY_RUN=false

- Mỗi lần cân bằng lại là vài giao dịch: gas HYPE cộng phí swap 1% của pool. Làm quá dày thì phí ăn hết lãi.
- Khi rút vị thế, tổn thất tạm thời thành lỗ thật, không còn “tạm” nữa.
- Private key nằm trong file `.env` trên máy. Máy dính virus là mất số tiền trong ví bot.
- Pool mỏng thì dễ bị người khác đẩy giá trước mặt bot (front-run). Bot có trần trượt giá, lệch quá thì giao dịch hủy, nhưng không chặn hết.
- RPC công cộng có thể trả giá sai. Bot hỏi nhiều RPC, lệch quá 1% thì không làm. Vẫn không bằng RPC của riêng bạn.
- Bot chỉ swap trong pool HYPE/KNTQ này, qua Universal Router `0xa13f7611115752deb2b13813bdde16a5073e4b45`.

## Lệnh cho người muốn kiểm tra code

Cần Node >= 20.19.

```bat
npm ci
npm test
npm run build
npm run bot -- --status
```

`npm test` chạy vitest cho công thức thanh khoản/tick/giá và cho logic kích hoạt bot.
