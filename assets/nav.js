/* ═══════════════════════════════════════════
   PUNARVASU — Shared Navigation
   ═══════════════════════════════════════════ */

const NAV = [
  {
    label: 'Home',
    href: '/index.html',
    single: true
  },
  {
    label: 'Mission & Vision',
    href: '/mission-vision/index.html',
    single: true
  },
  {
    label: 'Philosophy',
    href: '/philosophy/index.html',
    pages: [
      { title: 'Overview',              href: '/philosophy/index.html' },
      { title: 'The Winding Metaphor',  href: '/philosophy/winding.html' },
      { title: 'How Disease Progresses',href: '/philosophy/disease.html' },
      { title: 'How Cure Happens',      href: '/philosophy/cure.html' },
      { title: 'Wave Theory',           href: '/philosophy/wave-theory.html' },
      { title: 'The Body as One Entity',href: '/philosophy/single-entity.html' },
    ]
  },
  {
    label: 'Treatment',
    href: '/treatment/index.html',
    pages: [
      { title: 'Overview',              href: '/treatment/index.html' },
      { title: 'Case Taking',           href: '/treatment/case-taking.html' },
      { title: 'Constitutional Remedy', href: '/treatment/remedy.html' },
      { title: 'Follow-up & Unfolding', href: '/treatment/follow-up.html' },
      { title: 'What to Expect',        href: '/treatment/what-to-expect.html' },
      { title: 'Evidence Based Treatment', href: '/treatment/evidence.html' },
    ]
  },
  {
    label: 'Conditions',
    href: '/conditions/index.html',
    pages: [
      { title: 'Overview',              href: '/conditions/index.html' },
      { title: 'Chronic Conditions',    href: '/conditions/chronic.html' },
      { title: 'Acute Conditions',      href: '/conditions/acute.html' },
      { title: 'Mind & Emotions',       href: '/conditions/mind-emotions.html' },
      { title: 'Why We Don\'t List Diseases', href: '/conditions/why-no-list.html' },
    ]
  },
  {
    label: 'Medicine',
    href: '/medicine/index.html',
    pages: [
      { title: 'Overview',              href: '/medicine/index.html' },
      { title: 'No Fixed Medicine',     href: '/medicine/no-fixed-medicine.html' },
      { title: 'No Fixed Dose',         href: '/medicine/no-fixed-dose.html' },
      { title: 'Treatment vs Prescription', href: '/medicine/treatment-vs-prescription.html' },
    ]
  },
  {
    label: 'About Us',
    href: '/about/index.html',
    pages: [
      { title: 'Overview',              href: '/about/index.html' },
      { title: 'Dr. Yogeshwar Tiwari',  href: '/about/dr-tiwari.html' },
    ]
  },
  {
    label: 'Articles',
    href: '/articles/index.html',
    single: true
  },
  {
    label: 'Appointment',
    href: '/appointment/index.html',
    single: true
  },
];

function buildSidebar(currentPath) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  let html = '';

  NAV.forEach(section => {
    if (section.single) {
      const active = currentPath.endsWith(section.href) || currentPath === section.href ? 'active' : '';
      html += `<div class="sidebar-section">
        <a href="${section.href}" class="sidebar-link ${active}">${section.label}</a>
      </div>`;
    } else {
      const sectionActive = currentPath.includes('/' + section.href.split('/')[1] + '/');
      html += `<div class="sidebar-section">
        <span class="sidebar-section-title">${section.label}</span>`;
      section.pages.forEach(page => {
        const active = currentPath.endsWith(page.href) ? 'active' : '';
        html += `<a href="${page.href}" class="sidebar-link ${active}">${page.title}</a>`;
      });
      html += `</div><div class="sidebar-divider"></div>`;
    }
  });

  sidebar.innerHTML = html;

  // Hamburger toggle
  const hamburger = document.getElementById('hamburger');
  const overlay   = document.getElementById('sidebar-overlay');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
    });
  }
  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }
}

// Run on load
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  buildSidebar(path);
});
