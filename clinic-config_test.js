/* ============================================================================
   CLINIC SETTINGS  (clinic-config.js)
   ----------------------------------------------------------------------------
   All the details that belong to ONE clinic live here: its name, the doctor,
   the letterhead, the phone numbers, the website, who may sign in as a doctor
   (the admin list), the Firebase project and the WhatsApp number.
   Every page, the prescription letterhead / PDF and the message texts read
   them from here. To run the system for another clinic (or a demo), change
   this file only - never the pages.
   Hindi (hi) and Gujarati (gu) spellings are used in the messages in those
   languages.
   ========================================================================== */
window.CLINIC = {
  // ── Clinic ──
  name:      { en: 'Punarvasu Clinic', hi: 'पुनर्वसु क्लिनिक', gu: 'પુનર્વસુ ક્લિનિક' },
  shortName: 'Punarvasu',                       // page titles and the Workspace corner
  tagline:   'Renewing Life. Restoring Hope.',  // the line under the clinic name on the letterhead
  city:      { en: 'Ahmedabad', hi: 'अहमदाबाद', gu: 'અમદાવાદ' },
  address:   '307, Harvey Complex, Near Subhash Chowk, Gurukul Road, Memnagar, Ahmedabad – 380 052',

  // ── Doctor (letterhead, PDFs, messages) ──
  doctor:      { en: 'Dr. Yogeshwar Tiwari', hi: 'डॉ. योगेश्वर तिवारी', gu: 'ડૉ. યોગેશ્વર તિવારી' },
  doctorShort: { en: 'Dr. Tiwari',           hi: 'डॉ. तिवारी',         gu: 'ડૉ. તિવારી' },
  qualification: 'BHMS',
  role:          'Homeopathic Consultant',
  regNo:         'G-6424',

  // ── Contact ──
  mobile:     '9274791141',                     // as printed on the letterhead
  mobileShow: '+91 92747 91141',                // as shown to patients on the portal
  landline:   '079-4598 4135',
  email:      'dr.yogeshwar@punarvasu.clinic',

  // ── Website ──
  site:     'https://punarvasu.clinic',         // the public site (patient portal, story form, intake wizard)
  siteName: 'www.punarvasu.clinic',             // as written at the end of messages
  // Patients' own sign-in names end in @<accountDomain>. NEVER change this once
  // patients exist - their logins would stop working.
  accountDomain: 'punarvasu.clinic',

  // ── Who may sign in as a doctor (admin list) ──
  // The first one is the main doctor. Each doctor uses their own email and password.
  // The same list must also be in the WhatsApp Worker (wrangler.toml DOCTOR_EMAILS)
  // and in the Firebase rules.
  admins: [],                                   // the public site needs no doctor emails - the list is in the Workspace copy of this file

  // ── Firebase project (Firebase console → Project settings → Your apps) ──
  firebase: {
    apiKey: 'AIzaSyAqzKPqBzNoBJc5FWjnVXMER4prgrbhqag',
    authDomain: 'punarvasu-790a8.firebaseapp.com',
    databaseURL: 'https://punarvasu-790a8-default-rtdb.firebaseio.com',
    projectId: 'punarvasu-790a8',
    storageBucket: 'punarvasu-790a8.firebasestorage.app',
    messagingSenderId: '774115339459',
    appId: '1:774115339459:web:4ee1f45e1e25d61666c676'
  },

  // ── WhatsApp (Meta Cloud API) - the Worker holds the real settings; these are for reference ──
  whatsapp: {
    phoneNumberId: '1371010099432691',
    businessAccountId: '4745016139051674',
    workerUrl: ''                               // only the Workspace needs it
  }
};

/* ---- helpers (no need to change anything below) ---- */
(function (C) {
  C.addressHtml = C.address;
  C.isAdmin = function (email) {
    email = String(email || '').trim().toLowerCase();
    return !!email && C.admins.some(function (a) { return String(a).toLowerCase() === email; });
  };
  // the address a "forgot password" link is sent to: the typed email if it is on the list, else the main doctor
  C.adminFor = function (typed) { return C.isAdmin(typed) ? String(typed).trim() : (C.admins[0] || ''); };
  // fills the marked places on a page: <span data-ck="doctor.en">, <title data-ck-tpl="… {name.en}">, data-ck-attr="placeholder|… {doctorShort.en}"
  function val(k) {
    var at = k.charAt(0) === '@'; if (at) k = k.slice(1);
    var v = k.split('.').reduce(function (o, p) { return o == null ? o : o[p]; }, C);
    return v == null ? null : (at ? '@' : '') + v;
  }
  function tpl(s) { return s.replace(/\{([@\w.]+)\}/g, function (m, k) { var v = val(k); return v == null ? m : v; }); }
  C.fillPage = function (root) {
    root = root || document;
    root.querySelectorAll('[data-ck]').forEach(function (el) { var v = val(el.getAttribute('data-ck')); if (v != null) el.textContent = v; });
    root.querySelectorAll('[data-ck-tpl]').forEach(function (el) { var v = tpl(el.getAttribute('data-ck-tpl')); if (el.tagName === 'TITLE') document.title = v; else el.textContent = v; });
    root.querySelectorAll('[data-ck-attr]').forEach(function (el) {
      el.getAttribute('data-ck-attr').split(';;').forEach(function (pair) { var i = pair.indexOf('|'); if (i > 0) el.setAttribute(pair.slice(0, i), tpl(pair.slice(i + 1))); });
    });
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { C.fillPage(); });
    else C.fillPage();
  }
})(window.CLINIC);
