/*! NEXUS OS website lead form. Paste on your site:
 *  <div id="nexus-lead-form"></div>
 *  <script src="https://nexus-os-dashboard-six.vercel.app/embed/nexus-lead-form.js" data-nexus-key="YOUR_KEY" async></script>
 * No dependencies. User data is only ever set via textContent / value. */
(function () {
  'use strict';
  var ENDPOINT = 'https://dsvuoovivysszdoiorch.supabase.co/functions/v1/lead-intake-website';
  var script = document.currentScript || (function () {
    var s = document.querySelectorAll('script[data-nexus-key]');
    return s[s.length - 1];
  })();
  if (!script) return;
  var key = script.getAttribute('data-nexus-key') || '';
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(key)) { if (window.console) console.warn('NEXUS lead form: missing or invalid data-nexus-key'); return; }

  function uuid() {
    var c = window.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    if (c && c.getRandomValues) {
      var b = new Uint8Array(16); c.getRandomValues(b);
      b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      var h = []; for (var i = 0; i < 16; i++) h.push((b[i] + 256).toString(16).slice(1));
      return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
    }
    return null;
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  var css = '.nxlf{box-sizing:border-box;max-width:480px;width:100%;font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a}' +
    '.nxlf *{box-sizing:border-box}.nxlf label{display:block;margin:0 0 12px;font-weight:600;font-size:14px}' +
    '.nxlf input,.nxlf textarea{display:block;width:100%;margin-top:4px;padding:10px 12px;font:inherit;font-weight:400;border:1px solid #c8c8c8;border-radius:8px;background:#fff;color:#1a1a1a}' +
    '.nxlf input:focus,.nxlf textarea:focus{outline:2px solid #1f5eff;outline-offset:1px;border-color:#1f5eff}' +
    '.nxlf textarea{min-height:88px;resize:vertical}.nxlf button{width:100%;padding:12px;font:inherit;font-weight:600;border:0;border-radius:8px;background:#1f5eff;color:#fff;cursor:pointer}' +
    '.nxlf button[disabled]{opacity:.6;cursor:wait}.nxlf .nxlf-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}' +
    '.nxlf .nxlf-msg{margin-top:12px;font-size:14px}.nxlf .nxlf-ok{color:#0a7a3b}.nxlf .nxlf-err{color:#b3261e}';

  function field(form, label, name, type, opts) {
    var l = el('label', null, label);
    var i = el(type === 'textarea' ? 'textarea' : 'input', { name: name });
    if (type !== 'textarea') i.setAttribute('type', type);
    if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) i.setAttribute(k, opts[k]);
    l.appendChild(i); form.appendChild(l);
    return i;
  }

  function render() {
    var host = document.getElementById('nexus-lead-form');
    if (!host) { host = el('div', { id: 'nexus-lead-form' }); script.parentNode.insertBefore(host, script.nextSibling); }
    if (!document.getElementById('nxlf-style')) { var st = el('style', { id: 'nxlf-style' }, css); document.head.appendChild(st); }

    var form = el('form', { 'class': 'nxlf', novalidate: '' });
    var name = field(form, 'Name', 'name', 'text', { autocomplete: 'name', required: '', maxlength: '120' });
    var phone = field(form, 'Phone', 'phone', 'tel', { autocomplete: 'tel', inputmode: 'tel', maxlength: '40', placeholder: '05X XXX XXXX' });
    var email = field(form, 'Email', 'email', 'email', { autocomplete: 'email', maxlength: '160' });
    var car = field(form, "Car you're interested in", 'vehicle_interest', 'text', { maxlength: '200' });
    var msg = field(form, 'Message', 'message', 'textarea', { maxlength: '2000' });
    var hpWrap = el('div', { 'class': 'nxlf-hp', 'aria-hidden': 'true' });
    var hp = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
    hpWrap.appendChild(hp); form.appendChild(hpWrap);
    var btn = el('button', { type: 'submit' }, 'Send enquiry');
    form.appendChild(btn);
    var out = el('div', { 'class': 'nxlf-msg', role: 'status', 'aria-live': 'polite' });
    form.appendChild(out);
    host.appendChild(form);

    var submissionId = uuid();
    function say(text, ok) { out.textContent = text; out.className = 'nxlf-msg ' + (ok ? 'nxlf-ok' : 'nxlf-err'); }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (btn.disabled) return;
      var v = function (i) { return (i.value || '').trim(); };
      if (!v(name)) return say('Please enter your name.', false);
      if (!v(phone) && !v(email)) return say('Please enter a phone number or email so we can reach you.', false);
      if (!submissionId) return say('Your browser cannot send this form. Please call or WhatsApp us instead.', false);

      btn.disabled = true; btn.textContent = 'Sending…'; out.textContent = '';
      var body = JSON.stringify({
        name: v(name), phone: v(phone), email: v(email), vehicle_interest: v(car), message: v(msg),
        website: hp.value, submission_id: submissionId, page_url: String(location.href).slice(0, 500)
      });
      fetch(ENDPOINT + '?k=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, mode: 'cors', credentials: 'omit'
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j || {} }; });
      }).then(function (res) {
        if (res.status === 200 && res.j.ok) {
          say('Thank you — we have your enquiry and will be in touch shortly.', true);
          form.reset(); submissionId = uuid();
          btn.textContent = 'Sent'; return;
        }
        var e = res.j.error;
        var m = e === 'contact_required' ? 'Please enter a valid phone number (e.g. 05X XXX XXXX or +971…) or email.'
          : e === 'name_required' ? 'Please enter your name.'
          : e === 'rate_limited' ? 'We are receiving a lot of enquiries right now. Please try again in a minute.'
          : res.status >= 500 ? 'Something went wrong on our side. Please try again.'
          : 'Sorry, this form could not be sent. Please call or WhatsApp us instead.';
        say(m, false); btn.disabled = false; btn.textContent = 'Send enquiry';
      }, function () {
        say('Network problem. Please check your connection and try again.', false);
        btn.disabled = false; btn.textContent = 'Send enquiry';
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
