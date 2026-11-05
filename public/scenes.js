// 일정 없는 날의 그림: 공원 산책 · 친구와 차 한잔 · 꽃 구경
// 간단한 도형으로 그린 장면 + 그 가운데 부모님 아이콘. 색은 style.css의 .sc-* 가 맡는다 (밝은/어두운 화면)
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const face = (emoji, x, y, size = 40) =>
    `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" dominant-baseline="central">${esc(emoji)}</text>`;
  const tree = (x, y, r) =>
    `<rect class="sc-trunk" x="${x - 3}" y="${y}" width="6" height="${r + 6}" rx="2"/><circle class="sc-leaf" cx="${x}" cy="${y}" r="${r}"/>`;
  const flower = (x, y, c) =>
    `<line class="sc-stem" x1="${x}" y1="${y}" x2="${x}" y2="${y + 22}"/>` +
    [0, 72, 144, 216, 288].map((a) => {
      const r = (a * Math.PI) / 180;
      return `<circle class="${c}" cx="${(x + Math.cos(r) * 5).toFixed(1)}" cy="${(y + Math.sin(r) * 5).toFixed(1)}" r="4.5"/>`;
    }).join("") + `<circle class="sc-sun" cx="${x}" cy="${y}" r="3"/>`;

  const SCENES = [
    {
      id: "park",
      caption: "공원 산책하기 좋은 날",
      svg: (me) => `
        <rect class="sc-sky" width="320" height="160"/>
        <circle class="sc-sun" cx="270" cy="34" r="16"/>
        <ellipse class="sc-hill2" cx="70" cy="150" rx="150" ry="52"/>
        <ellipse class="sc-hill" cx="250" cy="158" rx="170" ry="56"/>
        <path class="sc-path" d="M120 160 C 150 128, 190 120, 230 104 L 244 108 C 206 126, 172 136, 156 160 Z"/>
        ${tree(52, 86, 20)}${tree(92, 98, 14)}${tree(286, 92, 18)}
        <rect class="sc-bench" x="246" y="118" width="34" height="5" rx="2"/><rect class="sc-bench" x="250" y="123" width="3" height="10"/><rect class="sc-bench" x="273" y="123" width="3" height="10"/>
        ${face(me, 182, 108, 38)}${face("🐕", 214, 124, 22)}`,
    },
    {
      id: "tea",
      caption: "친구와 차 한잔하기 좋은 날",
      svg: (me, friend) => `
        <rect class="sc-wall" width="320" height="160"/>
        <rect class="sc-window" x="22" y="18" width="84" height="64" rx="6"/>
        <line class="sc-frame" x1="64" y1="18" x2="64" y2="82"/><line class="sc-frame" x1="22" y1="50" x2="106" y2="50"/>
        <circle class="sc-sun" cx="88" cy="34" r="8"/>
        <rect class="sc-pot" x="262" y="78" width="26" height="22" rx="4"/>${tree(275, 66, 14)}
        <rect class="sc-table" x="70" y="118" width="190" height="12" rx="6"/>
        <rect class="sc-table" x="160" y="130" width="10" height="30"/>
        <rect class="sc-cup" x="134" y="102" width="18" height="16" rx="4"/><rect class="sc-cup" x="178" y="102" width="18" height="16" rx="4"/>
        <path class="sc-steam" d="M140 96 q4 -6 0 -12 M188 96 q4 -6 0 -12"/>
        ${face(me, 108, 92, 40)}${face(friend, 222, 92, 40)}`,
    },
    {
      id: "garden",
      caption: "꽃 구경하기 좋은 날",
      svg: (me) => `
        <rect class="sc-sky" width="320" height="160"/>
        <circle class="sc-sun" cx="46" cy="34" r="14"/>
        <rect class="sc-ground" x="0" y="118" width="320" height="42"/>
        ${flower(74, 104, "sc-petal1")}${flower(104, 112, "sc-petal2")}${flower(226, 106, "sc-petal2")}${flower(256, 112, "sc-petal1")}${flower(286, 100, "sc-petal3")}${flower(42, 114, "sc-petal3")}
        <path class="sc-fly" d="M196 52 q-8 -10 -14 -2 q6 8 14 2 q8 -10 14 -2 q-6 8 -14 2"/>
        ${face(me, 162, 104, 42)}`,
    },
  ];

  /** 같은 사람·같은 날에는 같은 그림 */
  function pick(seed) {
    let h = 0;
    for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return SCENES[h % SCENES.length];
  }

  /** 그림 하나 (aria: 설명 글) */
  function sceneSvg(seed, avatar) {
    const s = pick(seed);
    const me = avatar || "🙂";
    const friend = me === "👴" || me === "👨‍🦳" || me === "🧓" ? "👵" : "👴";
    return {
      id: s.id,
      caption: s.caption,
      html: `<svg class="scene" viewBox="0 0 320 160" role="img" aria-label="${esc(s.caption)}" preserveAspectRatio="xMidYMid slice">${s.svg(me, friend)}</svg>`,
    };
  }

  window.SCENES = { sceneSvg };
})();
