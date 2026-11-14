// Small line icons for the side bar, so it can shrink to a narrow strip.
// They use the text colour, so they follow the link's state.
const P = {
  '/home': <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  '/': <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
  '/tnpds': <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h4" /></>,
  '/voter': <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 12l3 3 5-6" /></>,
  Aadhaar: <path d="M12 4a7 7 0 0 0-7 7v2M19 13v-2a7 7 0 0 0-3.5-6M12 8a3 3 0 0 0-3 3v3a6 6 0 0 0 1 3.5M15 11v2a9 9 0 0 1-1.2 5M12 11v4" />,
  '/aadhaar': <path d="M12 4a7 7 0 0 0-7 7v2M19 13v-2a7 7 0 0 0-3.5-6M12 8a3 3 0 0 0-3 3v3a6 6 0 0 0 1 3.5M15 11v2a9 9 0 0 1-1.2 5M12 11v4" />,
  '/aadhaar/name': <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.5 2.7-6 6-6M14 19l5.5-5.5 2 2L16 21h-2z" /></>,
  PAN: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.5" /><path d="M5.5 16.5c.9-1.6 6.1-1.6 7 0M15 10h3M15 13h3" /></>,
  '/ttd': <path d="M4 21h16M6 21V11M18 21V11M3 11h18M12 3l7 8H5zM10 21v-5h4v5" />,
  Others: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
  '/followups': <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 3h6" /></>,
  '/dues': <path d="M7 5h10M7 9h10M8 5c6 0 6 8 0 8l7 7" />,
  '/renewals': <><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></>,
  '/admin': <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.4-4.6-3.5-5.5" /></>,
  '/admin/billing': <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  '/admin/reports': <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  '/admin/notices': <path d="M3 10v4h3l7 5V5L6 10zM17 9a4 4 0 0 1 0 6" />,
};

export default function NavIcon({ name }) {
  const shape = P[name];
  if (!shape) return null;
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {shape}
    </svg>
  );
}
