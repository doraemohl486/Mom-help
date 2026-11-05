// 작은 선 아이콘 모음 (24×24). 자녀·부모님 화면이 같이 쓴다.
(() => {
  const p = (d) => `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  window.ICONS = {
    taxi: p('<path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M9.5 5.5l.5-2h4l.5 2"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>'),
    transit: p('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14"/><circle cx="8.5" cy="13.5" r=".8" fill="currentColor"/><circle cx="15.5" cy="13.5" r=".8" fill="currentColor"/><path d="M8 17l-2 4M16 17l2 4"/>'),
    family: p('<path d="M4 15l1.5-4.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 15"/><rect x="2.5" y="15" width="19" height="4" rx="1.5"/><circle cx="7" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/><path d="M12 3.5c1.4-1.6 4-.6 4 1.5 0 2-4 4-4 4s-4-2-4-4c0-2.1 2.6-3.1 4-1.5z"/>'),
    병원: p('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>'),
    모임: p('<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14.5 15.5a4 4 0 0 1 6 3.5"/>'),
    경조사: p('<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M12 9v11M4 13h16"/><path d="M12 9c-1.5-3-5-3.5-5-1.2C7 9 12 9 12 9s5 0 5-1.2C17 5.5 13.5 6 12 9z"/>'),
    기타: p('<path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
    home: p('<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
    bell: p('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    users: p('<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2a4.5 4.5 0 0 1 6 4.3"/>'),
    gear: p('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
    plus: p('<path d="M12 5v14M5 12h14"/>'),
    phone: p('<path d="M5 3.5h3.2l1.6 4.2-2.1 1.3a11 11 0 0 0 5.3 5.3l1.3-2.1 4.2 1.6V17a2.5 2.5 0 0 1-2.7 2.5C9.5 19 5 14.5 4.5 6.2A2.5 2.5 0 0 1 5 3.5z"/>'),
    mic: p('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
    speaker: p('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    check: p('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    cal: p('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r=".9" fill="currentColor"/><circle cx="12" cy="14.5" r=".9" fill="currentColor"/>'),
    clock: p('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    sms: p('<path d="M4 5.5h16v11H9l-5 3.5z"/><path d="M8 10h8M8 13h5"/>'),
    edit: p('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    warn: p('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>'),
    chevron: p('<path d="M9 6l6 6-6 6"/>'),
    walk: p('<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v3M9 12.5l1.5-4 4 2 2.5 2.5M10.5 8.5L7 10v3"/>'),
  };
})();
