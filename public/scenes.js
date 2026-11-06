// 일정 없는 날의 그림: 공원 산책 · 친구와 차 한잔 · 꽃 구경
// 간단한 도형 장면 + 부모님 캐릭터(전신, people.js). 색은 style.css의 .sc-* 가 맡는다 (밝은/어두운 화면)
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const P = () => window.PEOPLE;
  const tree = (x, y, r) =>
    `<rect class="sc-trunk" x="${x - 3}" y="${y}" width="6" height="${r + 8}" rx="2"/><circle class="sc-leaf" cx="${x}" cy="${y}" r="${r}"/>`;
  const flower = (x, y, c) =>
    `<line class="sc-stem" x1="${x}" y1="${y}" x2="${x}" y2="${y + 22}"/>` +
    [0, 72, 144, 216, 288].map((a) => {
      const r = (a * Math.PI) / 180;
      return `<circle class="${c}" cx="${(x + Math.cos(r) * 5).toFixed(1)}" cy="${(y + Math.sin(r) * 5).toFixed(1)}" r="4.5"/>`;
    }).join("") + `<circle class="sc-sun" cx="${x}" cy="${y}" r="3"/>`;
  // 작은 강아지 (그림체 맞춤)
  const dog = (x, y) => `<g transform="translate(${x} ${y})">
    <ellipse cx="0" cy="0" rx="11" ry="6.5" fill="#e0b07a"/><circle cx="11" cy="-5" r="5.5" fill="#e0b07a"/>
    <ellipse cx="13.5" cy="-8.5" rx="2.4" ry="4" fill="#a8774d"/><circle cx="13" cy="-5.5" r=".9" fill="#2b2b33"/>
    <rect x="-8" y="4" width="3" height="7" rx="1.4" fill="#e0b07a"/><rect x="5" y="4" width="3" height="7" rx="1.4" fill="#e0b07a"/>
    <path d="M-11 -2 q-6 -4 -5 -9" stroke="#e0b07a" stroke-width="3" fill="none" stroke-linecap="round"/></g>`;

  const SCENES = [
    {
      id: "park",
      caption: "공원 산책하기 좋은 날",
      svg: (me) => `
        <rect class="sc-sky" width="320" height="160"/>
        <circle class="sc-sun" cx="276" cy="30" r="14"/>
        <ellipse class="sc-hill2" cx="70" cy="152" rx="150" ry="50"/>
        <ellipse class="sc-hill" cx="250" cy="160" rx="170" ry="54"/>
        <path class="sc-path" d="M118 160 C 150 130, 190 122, 232 108 L 246 112 C 208 128, 176 138, 160 160 Z"/>
        ${tree(40, 82, 20)}${tree(84, 96, 13)}${tree(292, 88, 17)}
        <rect class="sc-bench" x="250" y="120" width="32" height="5" rx="2"/><rect class="sc-bench" x="254" y="125" width="3" height="10"/><rect class="sc-bench" x="275" y="125" width="3" height="10"/>
        <path d="M197 86 Q214 104 228 128" stroke="#b5585f" stroke-width="1.4" fill="none"/>
        ${P().figure(me, 176, 46, 1, "walk")}${dog(220, 140)}`,
    },
    {
      id: "tea",
      caption: "친구와 차 한잔하기 좋은 날",
      svg: (me, friend) => `
        <rect class="sc-wall" width="320" height="160"/>
        <rect class="sc-window" x="124" y="14" width="72" height="52" rx="6"/>
        <line class="sc-frame" x1="160" y1="14" x2="160" y2="66"/><line class="sc-frame" x1="124" y1="40" x2="196" y2="40"/>
        <circle class="sc-sun" cx="182" cy="27" r="7"/>
        <rect class="sc-pot" x="276" y="96" width="24" height="22" rx="4"/>${tree(288, 84, 13)}
        ${P().figure(me, 96, 50, 1, "sit")}${P().figure(friend, 224, 50, 1, "sit", true)}
        <rect class="sc-table" x="50" y="102" width="220" height="12" rx="6"/>
        <rect class="sc-table" x="155" y="114" width="10" height="46"/>
        <rect class="sc-cup" x="124" y="88" width="16" height="14" rx="4"/><rect class="sc-cup" x="180" y="88" width="16" height="14" rx="4"/>
        <path class="sc-steam" d="M129 82 q4 -6 0 -12 M185 82 q4 -6 0 -12"/>`,
    },
    {
      id: "garden",
      caption: "꽃 구경하기 좋은 날",
      svg: (me) => `
        <rect class="sc-sky" width="320" height="160"/>
        <circle class="sc-sun" cx="44" cy="32" r="13"/>
        <rect class="sc-ground" x="0" y="122" width="320" height="38"/>
        ${flower(70, 108, "sc-petal1")}${flower(102, 116, "sc-petal2")}${flower(226, 110, "sc-petal2")}${flower(256, 116, "sc-petal1")}${flower(288, 104, "sc-petal3")}${flower(36, 116, "sc-petal3")}
        <path class="sc-fly" d="M206 50 q-8 -10 -14 -2 q6 8 14 2 q8 -10 14 -2 q-6 8 -14 2"/>
        ${P().figure(me, 160, 38, 1, "stand")}`,
    },
  ];

  /** 같은 사람·같은 날에는 같은 그림 */
  function pick(seed) {
    let h = 0;
    for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return SCENES[h % SCENES.length];
  }

  /** 그림 하나. avatar: 저장된 아이콘 값, name: 호칭 (캐릭터를 못 고르면 호칭으로) */
  function sceneSvg(seed, avatar, name = "") {
    const s = pick(seed);
    const me = P().resolve(avatar, name);
    const html = `<svg class="scene" viewBox="0 0 320 160" role="img" aria-label="${esc(s.caption)}" preserveAspectRatio="xMidYMid slice">${s.svg(me, P().friendOf(me))}</svg>`;
    return { id: s.id, caption: s.caption, html };
  }

  // ---------------------------------------------------------------- 가로로 긴 한 장 (자녀 화면: 여러 분 함께)
  // viewBox 320×80. people: 캐릭터 id 목록 (1~3명)
  const BANNERS = [
    {
      id: "park",
      caption: "공원 산책하기 좋은 날",
      ok: () => true,
      svg: (ids) => {
        // 사람은 오른쪽 절반에 (왼쪽 하늘에는 글이 얹힘)
        const xs = ids.length === 1 ? [238] : ids.length === 2 ? [218, 256] : [200, 236, 272];
        return `<rect class="sc-sky" width="320" height="80"/>
          <circle class="sc-sun" cx="182" cy="16" r="8"/>
          <ellipse class="sc-hill2" cx="60" cy="86" rx="140" ry="30"/><ellipse class="sc-hill" cx="250" cy="90" rx="170" ry="32"/>
          <path class="sc-path" d="M100 80 C 140 66, 200 64, 250 58 L 262 60 C 214 68, 170 74, 150 80 Z"/>
          ${tree(26, 52, 10)}${tree(150, 54, 8)}${tree(306, 46, 9)}
          ${ids.map((id, i) => P().figure(id, xs[i], 14, 0.6, "walk")).join("")}${dog(Math.min(xs[xs.length - 1] + 30, 300), 70)}`;
      },
    },
    {
      id: "tea",
      caption: "차 한잔하기 좋은 날",
      ok: (ids) => ids.length <= 2,
      svg: (ids) => {
        const [a, b] = ids.length === 1 ? [ids[0], P().friendOf(ids[0])] : ids;
        return `<rect class="sc-wall" width="320" height="80"/>
          <rect class="sc-window" x="226" y="8" width="38" height="28" rx="4"/>
          <line class="sc-frame" x1="245" y1="8" x2="245" y2="36"/><circle class="sc-sun" cx="255" cy="15" r="4"/>
          <rect class="sc-pot" x="20" y="56" width="16" height="14" rx="3"/>${tree(28, 48, 8)}
          ${P().figure(a, 206, 22, 0.6, "sit")}${P().figure(b, 284, 22, 0.6, "sit", true)}
          <rect class="sc-table" x="178" y="54" width="134" height="8" rx="4"/><rect class="sc-table" x="241" y="62" width="8" height="18"/>
          <rect class="sc-cup" x="224" y="45" width="10" height="9" rx="3"/><rect class="sc-cup" x="256" y="45" width="10" height="9" rx="3"/>`;
      },
    },
    {
      id: "garden",
      caption: "꽃 구경하기 좋은 날",
      ok: () => true,
      svg: (ids) => {
        const xs = ids.length === 1 ? [240] : ids.length === 2 ? [222, 262] : [204, 240, 276];
        return `<rect class="sc-sky" width="320" height="80"/>
          <circle class="sc-sun" cx="186" cy="16" r="8"/>
          <rect class="sc-ground" x="0" y="66" width="320" height="14"/>
          ${flower(30, 58, "sc-petal1")}${flower(70, 62, "sc-petal2")}${flower(120, 58, "sc-petal3")}${flower(170, 62, "sc-petal1")}${flower(300, 58, "sc-petal2")}
          <path class="sc-fly" d="M150 34 q-6 -8 -10 -2 q4 6 10 2 q6 -8 10 -2 q-4 6 -10 2"/>
          ${ids.map((id, i) => P().figure(id, xs[i], 10, 0.6, "stand")).join("")}`;
      },
    },
  ];

  /** 여러 분을 한 장에. people: [{ avatar, name }] */
  function bannerSvg(seed, people) {
    const ids = people.slice(0, 3).map((p) => P().resolve(p.avatar, p.name));
    let h = 0;
    for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const usable = BANNERS.filter((b) => b.ok(ids));
    const b = usable[h % usable.length];
    const html = `<svg class="scene scene-wide" viewBox="0 0 320 80" role="img" aria-label="${esc(b.caption)}" preserveAspectRatio="xMidYMid slice">${b.svg(ids)}</svg>`;
    return { id: b.id, caption: b.caption, html };
  }

  window.SCENES = { sceneSvg, bannerSvg };
})();
