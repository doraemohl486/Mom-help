// 체험판 틀: 탭, 부모님 화면 전환, 폰 알림 배너, 체험 도구
(() => {
  const demo = window.demo;
  const q = (s) => document.querySelector(s);
  const safe = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // alert → 토스트
  window.alert = (m) => (typeof toast === "function" ? toast(m) : console.log(m));

  // ---------------- 탭
  function showTab(name) {
    for (const b of q("#tabs").children) b.classList.toggle("on", b.dataset.tab === name);
    for (const p of document.querySelectorAll(".pane")) p.classList.toggle("on", p.id === `pane-${name}`);
    window.scrollTo(0, 0);
  }
  q("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) showTab(b.dataset.tab);
  });

  // ---------------- 부모님 화면 전환 ("엄마 화면 열기" 링크)
  function currentParent() {
    return demo.parents().find((p) => p.token === window.DEMO_PARENT_TOKEN) ?? demo.parents()[0];
  }
  function setParent(token) {
    window.DEMO_PARENT_TOKEN = token;
    const p = currentParent();
    for (const el of document.querySelectorAll(".pname")) el.textContent = p?.name ?? "부모님";
    lastSeen = Math.max(0, ...demo.parentNotifications(token).map((n) => n.id));
    q("#phoneBanner").innerHTML = "";
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="/p/"]');
    if (!a) return;
    e.preventDefault();
    setParent(a.getAttribute("href").split("/").pop());
    showTab("parent");
  }, true);

  // 실제 앱의 '문자 자동 가져오기' 주소 안내는 체험판에서 쓸 수 없으니 바꿔 보여 준다
  const inbox = q("#inboxBox");
  if (inbox) {
    inbox.style.display = "none";
    const note = document.createElement("div");
    note.className = "card demo-note";
    note.innerHTML = "체험판에서는 <b>🧪 체험 도구 → 📩 문자 오기</b>로 해 볼 수 있어요. 실제 앱에서는 부모님 폰의 예약 문자가 이 앱으로 자동 전달돼요.";
    inbox.after(note);
  }

  // ---------------- 폰 알림 배너
  let lastSeen = 0;
  function pollBanner() {
    const p = currentParent();
    if (!p) return;
    for (const el of document.querySelectorAll(".pname")) el.textContent = p.name;
    const [n] = demo.parentNotifications(p.token);
    if (n && n.id > lastSeen) {
      lastSeen = n.id;
      const div = document.createElement("div");
      div.className = "banner";
      div.innerHTML = `📱 <b>알림</b> · ${safe(n.message)}`;
      q("#phoneBanner").prepend(div);
      while (q("#phoneBanner").children.length > 2) q("#phoneBanner").lastChild.remove();
      setTimeout(() => div.remove(), 12000);
    }
  }

  // ---------------- 시계
  function tickClock() {
    q("#clock").textContent = demo.clockText();
    q("#next").textContent = demo.nextText();
    const n = demo.now();
    q("#phoneClock").textContent = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" }).format(n);
  }
  q("#skipBtn").onclick = async () => {
    const label = await demo.skip();
    toast(label ? `⏩ ${label} 시간으로 건너뛰었어요` : "다음 알림이 없어요");
    tickClock();
    pollBanner();
  };
  q("#clockReset").onclick = () => { demo.resetClock(); tickClock(); toast("지금 시간으로 돌아왔어요"); };

  // ---------------- 문자 오기
  const kdate = (days) => {
    const d = new Date(demo.now().getTime() + days * 86400000);
    const f = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).formatToParts(d);
    return `${f.find((x) => x.type === "month").value}/${f.find((x) => x.type === "day").value}`;
  };
  const samples = {
    new: () => `[Web발신]\n[서울아산병원] 김영희님 ${kdate(5)} 오후 2시 30분 심장내과 진료 예약되었습니다. 30분 전 도착 바랍니다.`,
    dup: () => `[서울아산병원] 김영희님 ${kdate(5)} 14:30 진료 예정입니다. 신분증 지참`,
    unknown: () => `[하늘정형외과의원] ${kdate(3)} 오전 10시 물리치료 예약`,
    ad: () => `(광고) 가을맞이 건강검진 30% 할인 이벤트`,
  };
  q("#smsSamples").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    q("#smsText").value = samples[b.dataset.s]();
  });
  q("#smsText").value = samples.new();
  const RESULT = {
    created: "✅ 일정을 자동으로 넣었어요 (자녀 화면 확인)",
    duplicate: "↩️ 이미 있는 예약이라 건너뛰었어요",
    review: "📝 자녀 화면 '확인이 필요한 일정'에 올렸어요",
    ignored: "🚫 예약 문자가 아니라서 무시했어요",
  };
  q("#smsSend").onclick = async () => {
    const p = currentParent();
    try {
      const r = await demo.sms(p.token, q("#smsText").value);
      q("#smsResult").textContent = RESULT[r] ?? r;
    } catch (e) {
      q("#smsResult").textContent = e.message;
    }
  };
  q("#resetBtn").onclick = () => demo.reset();

  setParent(window.DEMO_PARENT_TOKEN);
  tickClock();
  setInterval(() => { tickClock(); pollBanner(); }, 2000);
})();
