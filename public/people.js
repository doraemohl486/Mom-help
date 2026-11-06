// 부모님 캐릭터 (직접 그린 전신 그림 + 얼굴 아이콘). 이모지 대신 앱 그림체로 통일
// 좌표: 머리 중심이 (0,0), 반지름 14. 몸은 아래로 약 90 (발끝 y≈92)
(() => {
  const SKIN = "#f6d3b8";
  const CHARS = {
    w1: { label: "단발", hair: "bob", hairColor: "#2d2a32", top: "#ffc93c", bottom: "#2b3a8f", shoe: "#5a4636", kind: "w" },
    w2: { label: "긴 웨이브", hair: "long", hairColor: "#6b4a3a", top: "#ff9fb2", bottom: "#ff9fb2", dress: true, shoe: "#7a4b5a", kind: "w" },
    w3: { label: "짧은 파마", hair: "curly", hairColor: "#3a2f2c", top: "#7cc3e8", bottom: "#4a5568", shoe: "#3a3a46", kind: "w" },
    m1: { label: "짧은 머리", hair: "short", hairColor: "#24232a", top: "#2b3a8f", bottom: "#c8b48a", shoe: "#3a3a46", kind: "m" },
    m2: { label: "안경", hair: "side", hairColor: "#4a3b33", top: "#5aa96b", bottom: "#3a4252", shoe: "#5a4636", kind: "m", glasses: true },
    m3: { label: "모자", hair: "short", hairColor: "#2d2a32", top: "#ffb35c", bottom: "#2b3a8f", shoe: "#3a3a46", kind: "m", hat: "#e9e3d4" },
  };
  const IDS = Object.keys(CHARS);

  // 예전에 고른 이모지 아이콘 → 비슷한 캐릭터
  const LEGACY = { "👵": "w1", "👩‍🦳": "w3", "👩": "w2", "👴": "m1", "👨‍🦳": "m2", "🧓": "m3", "👨": "m1" };

  /** 저장된 아이콘 값 → 캐릭터 id. 비었거나 모르는 값이면 호칭으로 (엄마→단발, 아빠→짧은 머리) */
  function resolve(avatar, name = "") {
    if (CHARS[avatar]) return avatar;
    if (LEGACY[avatar]) return LEGACY[avatar];
    return /(아빠|아버지|아버님|할아버지|남편)/.test(name) ? "m1" : "w1";
  }

  function hairBack(c) {
    if (c.hair === "long") return `<path fill="${c.hairColor}" d="M-17 -2 C-19 -18 19 -18 17 -2 L18 22 C10 26 -10 26 -18 22 Z"/>`;
    if (c.hair === "bob") return `<path fill="${c.hairColor}" d="M-17 -2 C-18 -19 18 -19 17 -2 L17 10 C10 13 -10 13 -17 10 Z"/>`;
    return "";
  }
  function hairFront(c) {
    switch (c.hair) {
      case "bob":
      case "long":
        return `<path fill="${c.hairColor}" d="M-14.5 -3 C-14 -16 14 -16 14.5 -3 C8 -9 -3 -10 -14.5 -3 Z"/>`;
      case "curly":
        return [[-12, -6], [-8, -12], [-1, -14.5], [6, -13], [11, -8], [13.5, -2], [-14, 0]]
          .map(([x, y]) => `<circle fill="${c.hairColor}" cx="${x}" cy="${y}" r="5.2"/>`).join("");
      case "side":
        return `<path fill="${c.hairColor}" d="M-14.5 -2 C-15 -17 15 -17 14.5 -2 C10 -8 2 -11 -4 -9 C-8 -8 -12 -6 -14.5 -2 Z"/>`;
      default: // short
        return `<path fill="${c.hairColor}" d="M-14.5 -1 C-15 -17 15 -17 14.5 -1 C11 -9 -11 -9 -14.5 -1 Z"/>`;
    }
  }
  function faceParts(c) {
    let s = `<circle cx="-5" cy="1" r="1.7" fill="#2b2b33"/><circle cx="5" cy="1" r="1.7" fill="#2b2b33"/>`;
    s += `<path d="M-4.5 6.5 Q0 10 4.5 6.5" fill="none" stroke="#b5585f" stroke-width="1.6" stroke-linecap="round"/>`;
    s += `<circle cx="-9" cy="5" r="2.4" fill="#ff9e9e" opacity=".45"/><circle cx="9" cy="5" r="2.4" fill="#ff9e9e" opacity=".45"/>`;
    if (c.glasses) {
      s += `<g fill="none" stroke="#2b2b33" stroke-width="1.3"><circle cx="-5" cy="1" r="4"/><circle cx="5" cy="1" r="4"/><path d="M-1 1 h2"/></g>`;
    }
    return s;
  }
  function hat(c) {
    if (!c.hat) return "";
    return `<path fill="${c.hat}" d="M-13 -6 C-13 -19 13 -19 13 -6 Z"/><rect fill="${c.hat}" x="-18" y="-7.5" width="36" height="4" rx="2"/>`
      + `<rect fill="#c9925e" x="-13" y="-9.5" width="26" height="2.4"/>`;
  }
  function head(c) {
    return hairBack(c) + `<circle cx="0" cy="0" r="14" fill="${SKIN}"/>` + faceParts(c) + (c.hat ? hat(c) : hairFront(c));
  }

  /** 전신. pose: "walk" | "stand" | "sit" */
  function body(c, pose) {
    const arm = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${c.top}" stroke-width="7" stroke-linecap="round"/>`
      + `<circle cx="${x2}" cy="${y2}" r="3.4" fill="${SKIN}"/>`;
    const leg = (x, rot) => `<g transform="rotate(${rot} ${x} 54)"><rect x="${x - 4}" y="52" width="8" height="32" rx="3.5" fill="${c.dress ? SKIN : c.bottom}"/>`
      + `<ellipse cx="${x + (rot < 0 ? -2 : 2)}" cy="86" rx="6" ry="3.4" fill="${c.shoe}"/></g>`;
    // 앉은 모습은 탁자에 가려지므로 다리를 그리지 않는다
    const legs = pose === "walk" ? leg(-5, 12) + leg(5, -14) : pose === "sit" ? "" : leg(-5, 2) + leg(5, -2);
    const arms = pose === "walk" ? arm(-14, 24, -20, 44) + arm(14, 24, 21, 40) : pose === "sit" ? arm(-13, 24, -8, 42) + arm(13, 24, 9, 42) : arm(-14, 24, -18, 46) + arm(14, 24, 18, 46);
    const torso = c.dress
      ? `<path fill="${c.top}" d="M-12 17 C-6 14 6 14 12 17 L18 60 C6 64 -6 64 -18 60 Z"/>`
      : `<rect x="-14" y="16" width="28" height="34" rx="11" fill="${c.top}"/>`
        + (c.kind === "w" ? `<path fill="${c.bottom}" d="M-14 44 L14 44 L18 62 L-18 62 Z"/>` : `<rect x="-13" y="44" width="26" height="12" rx="4" fill="${c.bottom}"/>`);
    const neck = `<rect x="-4" y="11" width="8" height="8" rx="3" fill="${SKIN}"/>`;
    return legs + neck + torso + arms;
  }

  /** 장면 안에 넣을 사람 (머리 중심 x,y, 크기 scale) */
  function figure(id, x, y, scale = 1, pose = "stand", flip = false) {
    const c = CHARS[id] || CHARS.w1;
    return `<g transform="translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})">${body(c, pose)}${head(c)}</g>`;
  }

  /** 얼굴 아이콘 (동그라미 안). size px */
  function faceSvg(id, size = 36) {
    const c = CHARS[id] || CHARS.w1;
    return `<svg class="person-face" width="${size}" height="${size}" viewBox="-19 -19 38 38" aria-hidden="true">${head(c)}</svg>`;
  }

  /** 같은 그림체의 친구 (나와 다른 사람) */
  function friendOf(id) {
    const c = CHARS[id] || CHARS.w1;
    return c.kind === "w" ? (id === "w2" ? "w3" : "w2") : (id === "m2" ? "m3" : "m2");
  }

  window.PEOPLE = { CHARS, IDS, resolve, figure, faceSvg, friendOf };
})();
