/* Interio Arty chatbot widget.
   Embeddable on any site via one script tag (see README). Renders inside a
   shadow root so host page CSS can never break it and it can never break the
   host page. Streams replies from /api/chat, remembers the conversation
   across page loads, qualifies leads and pushes them into the shared inbox. */
(function () {
  'use strict';

  var CHANNEL_NAME = 'interioarty-leads';
  var LEAD_STORE = 'interioarty_leads';
  var CHAT_STORE = 'interioarty_chat';
  var KNOWN_STORE = 'interioarty_known';
  var SUMMARY_STORE = 'interioarty_summary';
  var LOG_STORE = 'interioarty_log';
  // The visible/model history is capped at MAX_HISTORY, but the studio gets the
  // whole conversation, so a separate full log is kept for the lead record.
  var MAX_LOG = 300;
  var WHATSAPP_NUMBER = '917838653501';
  var PHONE_DISPLAY = '+91 78386 53501';
  var MAX_HISTORY = 30;
  var MAX_SUMMARIZE_FLIGHTS = 3;
  // How often (in visitor messages) the rolling conversation summary gets
  // refreshed. Keeps preferences/objections/constraints from earlier in a
  // long chat alive in the model's context without re-sending (or paying
  // for) the full transcript on every single turn.
  var SUMMARY_INTERVAL = 8;

  var WIDGET_CSS = [
    ':host { all: initial; position: fixed; bottom: 0; right: 0; z-index: 2147483000; font-family: "Montserrat", "Helvetica Neue", Arial, sans-serif; pointer-events: none; }',
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    '.iw-launcher { pointer-events: auto; position: fixed; bottom: 20px; right: 20px; display: flex; align-items: center; gap: 10px; background: #DBB56A; color: #14231C; border: none; padding: 14px 20px; cursor: pointer; font: 700 0.85rem/1 "Montserrat", Arial, sans-serif; letter-spacing: 0.01em; box-shadow: 0 10px 30px rgba(0,0,0,0.25); transition: background 0.3s; }',
    '.iw-launcher:hover { background: #F0D9A3; }',
    '.iw-launcher svg { width: 16px; height: 16px; flex-shrink: 0; }',
    '.iw-panel { pointer-events: auto; position: fixed; bottom: 84px; right: 20px; width: 380px; max-width: calc(100vw - 32px); height: 560px; max-height: calc(100vh - 130px); background: #fff; color: #14231C; display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(20,35,28,0.14); box-shadow: 0 24px 60px rgba(0,0,0,0.18); opacity: 0; transform: translateY(16px); pointer-events: none; transition: opacity 0.4s, transform 0.4s; }',
    '.iw-panel.open { opacity: 1; transform: translateY(0); pointer-events: auto; }',
    '.iw-head { background: #0F3D33; color: #fff; padding: 16px 18px; display: flex; align-items: center; gap: 12px; }',
    '.iw-avatar { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font: 700 0.9rem/1 "Montserrat", Arial, sans-serif; color: #DBB56A; border: 1px solid #DBB56A; flex-shrink: 0; }',
    '.iw-head-info { flex: 1; min-width: 0; }',
    '.iw-head-info b { display: block; font: 700 0.95rem/1.3 "Montserrat", Arial, sans-serif; }',
    '.iw-head-info span { display: flex; align-items: center; gap: 6px; font: 400 0.65rem/1.3 "Montserrat", Arial, sans-serif; color: rgba(255,255,255,0.6); margin-top: 3px; }',
    '.iw-head-info span::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }',
    '.iw-reset { pointer-events: auto; background: none; border: 1px solid rgba(255,255,255,0.35); color: #fff; font: 400 0.65rem/1 "Montserrat", Arial, sans-serif; padding: 6px 8px; cursor: pointer; flex-shrink: 0; }',
    '.iw-reset:hover { background: rgba(255,255,255,0.15); }',
    '.iw-messages { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; }',
    '.iw-msg { max-width: 84%; padding: 10px 14px; font-size: 0.86rem; font-weight: 400; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }',
    '.iw-msg.bot { align-self: flex-start; background: rgba(15,61,51,0.07); }',
    '.iw-msg.user { align-self: flex-end; background: #14231C; color: #fff; }',
    '.iw-typing { display: flex; gap: 4px; align-items: center; padding: 12px 14px; }',
    '.iw-typing span { width: 5px; height: 5px; border-radius: 50%; background: rgba(20,35,28,0.4); animation: iwdot 1.2s infinite ease-in-out; }',
    '.iw-typing span:nth-child(2) { animation-delay: 0.15s; }',
    '.iw-typing span:nth-child(3) { animation-delay: 0.3s; }',
    '@keyframes iwdot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-3px); opacity: 1; } }',
    '.iw-suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 10px; }',
    '.iw-chip { font: 400 0.72rem/1 "Montserrat", Arial, sans-serif; letter-spacing: 0.01em; border: 1px solid rgba(20,35,28,0.14); padding: 7px 12px; cursor: pointer; background: transparent; color: #14231C; transition: all 0.25s; }',
    '.iw-chip:hover { background: #14231C; color: #fff; border-color: #14231C; }',
    '.iw-input-row { display: flex; align-items: center; gap: 8px; padding: 12px; border-top: 1px solid rgba(20,35,28,0.14); background: #fff; }',
    '.iw-input-row input { flex: 1; min-width: 0; border: 1px solid rgba(20,35,28,0.14); background: #fff; padding: 10px 13px; font-size: 0.86rem; font-weight: 400; font-family: "Montserrat", Arial, sans-serif; color: #14231C; }',
    '.iw-input-row input:focus { outline: none; border-color: #14231C; }',
    '.iw-send { width: 38px; height: 38px; background: #14231C; color: #fff; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }',
    '.iw-send svg { width: 16px; height: 16px; }',
    '.iw-send:disabled { background: #9c9488; cursor: default; }',
    '.iw-handoff { display: flex; gap: 8px; padding: 0 16px 10px; flex-wrap: wrap; }',
    '.iw-handoff a { font: 700 0.74rem/1 "Montserrat", Arial, sans-serif; color: #14231C; border-bottom: 1px solid #14231C; text-decoration: none; padding-bottom: 2px; }',
    '@media (max-width: 480px) { .iw-panel { right: 12px; bottom: 78px; width: calc(100vw - 24px); } .iw-launcher { right: 16px; } }',
  ].join('\n');

  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var ICON_SEND =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';

  var FALLBACK_META = {
    persona: 'studio',
    assistantName: 'Arty',
    assistantTitle: 'Interio Arty design assistant',
    greeting:
      "Hi, I'm Arty! I help bring Interio Arty's homes, offices and commercial spaces to life, from the first idea all the way to move-in day. Tell me a little about your space, I'd love to help.",
    suggestions: [
      { label: 'Services', text: 'What services does Interio Arty offer?' },
      { label: 'Pricing', text: 'How much does interior design cost?' },
      { label: 'Timeline', text: 'How long does a full home project take?' },
    ],
  };

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.innerText = String(str);
    return d.innerHTML;
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function getLeads() {
    try {
      return JSON.parse(localStorage.getItem(LEAD_STORE) || '[]');
    } catch {
      return [];
    }
  }

  function saveLeads(list) {
    localStorage.setItem(LEAD_STORE, JSON.stringify(list));
  }

  function InterioArtyWidget(options) {
    this.apiBase = options.apiBase || '';
    this.persona = options.persona || null;
    this.meta = null;
    this.messages = [];
    this.log = [];
    this.leadId = null;
    this.syncChain = Promise.resolve();
    // Sticky visitor facts (name/phone/email/hints), carried across the
    // whole session independently of the message-history caps, so a fact
    // captured early in a long conversation is never lost once its turn
    // scrolls out of history. Sent on every /api/chat call, merged
    // server-side with whatever the current transcript shows.
    this.knownLead = {};
    // Rolling narrative summary of preferences/objections/constraints not
    // captured as a structured field. Refreshed every SUMMARY_INTERVAL
    // messages (see maybeUpdateSummary), sent alongside knownLead so a long
    // chat stays coherent without keeping the full transcript.
    this.conversationSummary = '';
    this.turnsSinceSummary = 0;
    this.summarizingProgress = false;
    this.sending = false;
    this.summarizeFlights = 0;
    this.handoffShown = false;
    this.bc = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

    this.host = document.createElement('interioarty-chat');
    this.host.style.display = 'none';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = '<style>' + WIDGET_CSS + '</style>';
    document.body.appendChild(this.host);
    this.buildDom();
    this.restore();
    this.fetchMeta();
  }

  InterioArtyWidget.prototype.buildDom = function () {
    var self = this;

    this.launcher = el('button', 'iw-launcher', ICON_CHAT + '<span class="iw-label">Ask Arty</span>');
    this.launcher.setAttribute('aria-label', 'Open chat');
    this.launcher.addEventListener('click', function () {
      self.toggle();
    });

    this.panel = el('div', 'iw-panel');
    this.panel.innerHTML = [
      '<div class="iw-head">',
      '  <div class="iw-avatar">A</div>',
      '  <div class="iw-head-info"><b>Arty · Interio Arty</b><span>Usually replies instantly</span></div>',
      '  <button class="iw-reset" type="button" aria-label="Start a new conversation">New chat</button>',
      '</div>',
      '<div class="iw-messages" role="log" aria-live="polite"></div>',
      '<div class="iw-suggestions"></div>',
      '<div class="iw-handoff"></div>',
      '<div class="iw-input-row">',
      '  <input type="text" placeholder="Type your message..." autocomplete="off" aria-label="Your message" />',
      '  <button class="iw-send" type="button" aria-label="Send">' + ICON_SEND + '</button>',
      '</div>',
    ].join('');

    this.messagesEl = this.panel.querySelector('.iw-messages');
    this.suggestionsEl = this.panel.querySelector('.iw-suggestions');
    this.handoffEl = this.panel.querySelector('.iw-handoff');
    this.inputEl = this.panel.querySelector('input');
    this.sendBtn = this.panel.querySelector('.iw-send');
    this.labelEl = this.launcher.querySelector('.iw-label');
    this.headName = this.panel.querySelector('.iw-head-info b');
    this.avatarEl = this.panel.querySelector('.iw-avatar');

    this.panel.querySelector('.iw-reset').addEventListener('click', function () {
      self.reset();
    });
    this.sendBtn.addEventListener('click', function () {
      self.send(self.inputEl.value);
    });
    this.inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') self.send(self.inputEl.value);
    });

    this.root.appendChild(this.launcher);
    this.root.appendChild(this.panel);
    this.host.style.display = 'block';
  };

  InterioArtyWidget.prototype.pushMsg = function (msg) {
    this.messages.push(msg);
    this.log.push(msg);
    if (this.log.length > MAX_LOG) this.log = this.log.slice(-MAX_LOG);
    try {
      localStorage.setItem(LOG_STORE, JSON.stringify(this.log));
    } catch {
      // private mode or quota; the lead still syncs from memory
    }
  };

  InterioArtyWidget.prototype.restore = function () {
    try {
      var savedLog = JSON.parse(localStorage.getItem(LOG_STORE) || '[]');
      if (Array.isArray(savedLog)) this.log = savedLog.slice(-MAX_LOG);
    } catch {
      this.log = [];
    }
    try {
      var saved = JSON.parse(localStorage.getItem(CHAT_STORE) || '[]');
      if (Array.isArray(saved) && saved.length) {
        this.messages = saved.slice(-MAX_HISTORY);
        if (!this.log.length) this.log = saved.slice(-MAX_LOG);
      }
    } catch {
      this.messages = [];
    }
    try {
      var known = JSON.parse(localStorage.getItem(KNOWN_STORE) || '{}');
      if (known && typeof known === 'object') this.knownLead = known;
    } catch {
      this.knownLead = {};
    }
    try {
      var summary = localStorage.getItem(SUMMARY_STORE) || '';
      this.conversationSummary = summary;
    } catch {
      this.conversationSummary = '';
    }
  };

  InterioArtyWidget.prototype.persist = function () {
    try {
      localStorage.setItem(CHAT_STORE, JSON.stringify(this.messages.slice(-MAX_HISTORY)));
    } catch {
      // private mode or quota; memory-only session is fine
    }
  };

  InterioArtyWidget.prototype.persistKnownLead = function () {
    try {
      localStorage.setItem(KNOWN_STORE, JSON.stringify(this.knownLead));
    } catch {
      // private mode or quota; memory-only session is fine
    }
  };

  InterioArtyWidget.prototype.persistSummary = function () {
    try {
      localStorage.setItem(SUMMARY_STORE, this.conversationSummary || '');
    } catch {
      // private mode or quota; memory-only session is fine
    }
  };

  // Refreshes the rolling summary every SUMMARY_INTERVAL visitor messages.
  // Fire-and-forget: this is a background quality improvement, never on the
  // critical path of showing the current reply, and a failure here just
  // means the summary stays as it was.
  InterioArtyWidget.prototype.maybeUpdateSummary = function () {
    var self = this;
    this.turnsSinceSummary += 1;
    if (this.turnsSinceSummary < SUMMARY_INTERVAL || this.summarizingProgress) return;
    this.turnsSinceSummary = 0;
    this.summarizingProgress = true;

    fetch(this.apiBase + '/api/summarize-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priorSummary: this.conversationSummary,
        messages: this.messages.slice(-(SUMMARY_INTERVAL * 2)),
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && typeof data.summary === 'string') {
          self.conversationSummary = data.summary;
          self.persistSummary();
        }
      })
      .catch(function () {
        // keep the existing summary on failure
      })
      .finally(function () {
        self.summarizingProgress = false;
      });
  };

  // Merges every non-null field the server reports back into the sticky
  // memory. Called on every 'lead' event, qualified or not, so partial
  // info (e.g. just a phone number, no name yet) still accumulates.
  InterioArtyWidget.prototype.mergeKnownLead = function (lead) {
    if (!lead) return;
    var fields = ['name', 'phone', 'email', 'bhkHint', 'budgetHint', 'projectTypeHint', 'cityHint'];
    var changed = false;
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (lead[f] && !this.knownLead[f]) {
        this.knownLead[f] = lead[f];
        changed = true;
      }
    }
    if (changed) this.persistKnownLead();
  };

  InterioArtyWidget.prototype.reset = function () {
    this.messages = [];
    this.log = [];
    this.leadId = null;
    this.knownLead = {};
    this.conversationSummary = '';
    this.turnsSinceSummary = 0;
    this.handoffShown = false;
    try {
      localStorage.removeItem(CHAT_STORE);
      localStorage.removeItem(KNOWN_STORE);
      localStorage.removeItem(SUMMARY_STORE);
      localStorage.removeItem(LOG_STORE);
    } catch {
      // ignore
    }
    if (this.meta) {
      this.pushMsg({ role: 'assistant', content: this.meta.greeting });
    }
    this.render();
    this.renderSuggestions();
  };

  InterioArtyWidget.prototype.fetchMeta = function () {
    var self = this;
    var url = this.apiBase + '/api/meta';
    if (this.persona) url += '?persona=' + encodeURIComponent(this.persona);
    fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (meta) {
        if (!meta) meta = FALLBACK_META;
        self.meta = meta;
        self.persona = meta.persona;
        self.labelEl.textContent = 'Ask ' + meta.assistantName;
        self.headName.textContent = meta.assistantName + ' · Interio Arty';
        self.avatarEl.textContent = meta.assistantName.charAt(0);
        self.suggestionsEl.innerHTML = '';
        (meta.suggestions || []).forEach(function (s) {
          var chip = el('button', 'iw-chip', escapeHtml(s.label));
          chip.addEventListener('click', function () {
            self.send(s.text);
          });
          self.suggestionsEl.appendChild(chip);
        });
        if (!self.messages.length) {
          self.pushMsg({ role: 'assistant', content: meta.greeting });
          self.persist();
          self.render();
        }
      })
      .catch(function () {
        self.meta = FALLBACK_META;
        if (!self.messages.length) {
          self.pushMsg({ role: 'assistant', content: FALLBACK_META.greeting });
          self.persist();
          self.render();
        }
      });
  };

  InterioArtyWidget.prototype.render = function () {
    var self = this;
    this.messagesEl.innerHTML = '';
    this.messages.forEach(function (m) {
      self.messagesEl.appendChild(el('div', 'iw-msg ' + (m.role === 'user' ? 'user' : 'bot'), escapeHtml(m.content)));
    });
    this.scrollBottom();
  };

  InterioArtyWidget.prototype.scrollBottom = function () {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  };

  InterioArtyWidget.prototype.showTyping = function () {
    var t = el('div', 'iw-msg bot iw-typing', '<span></span><span></span><span></span>');
    t.id = 'iwTyping';
    this.messagesEl.appendChild(t);
    this.scrollBottom();
    return t;
  };

  InterioArtyWidget.prototype.renderSuggestions = function () {
    if (!this.meta) return;
    this.suggestionsEl.style.display = this.messages.length > 1 ? 'none' : 'flex';
  };

  InterioArtyWidget.prototype.openPanel = function () {
    var self = this;
    this.panel.classList.add('open');
    if (!this.messagesEl.children.length) this.render();
    this.renderSuggestions();
    setTimeout(function () {
      self.inputEl.focus();
    }, 350);
  };

  InterioArtyWidget.prototype.toggle = function () {
    if (this.panel.classList.contains('open')) {
      this.panel.classList.remove('open');
    } else {
      this.openPanel();
    }
  };

  InterioArtyWidget.prototype.open = function (prefill) {
    this.openPanel();
    if (prefill) {
      this.inputEl.value = prefill;
      this.inputEl.focus();
    }
  };

  InterioArtyWidget.prototype.showHandoff = function () {
    if (this.handoffShown) return;
    this.handoffShown = true;
    var lastUser = '';
    for (var i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        lastUser = this.messages[i].content.slice(0, 120);
        break;
      }
    }
    var text = encodeURIComponent(
      'Hi Interio Arty! I was just chatting with ' + (this.meta ? this.meta.assistantName : 'your assistant') +
        ' on your website' + (lastUser ? ' about: ' + lastUser : '') + '. Please get back to me.'
    );
    this.handoffEl.innerHTML =
      '<a href="https://wa.me/' + WHATSAPP_NUMBER + '?text=' + text + '" target="_blank" rel="noopener">WhatsApp us</a>' +
      '<a href="tel:+91' + WHATSAPP_NUMBER + '">Call ' + PHONE_DISPLAY + '</a>';
  };

  InterioArtyWidget.prototype.send = async function (text) {
    if (this.sending) return;
    text = String(text || '').trim();
    if (!text) return;
    this.sending = true;
    this.sendBtn.disabled = true;
    this.inputEl.value = '';
    this.suggestionsEl.style.display = 'none';
    this.handoffEl.innerHTML = '';

    this.pushMsg({ role: 'user', content: text.slice(0, 500) });
    // Trim the in-memory array itself, not just what gets persisted:
    // api/lib/leads.js rejects any /api/chat call carrying more than 30
    // messages outright (400), and without this the array grows unbounded
    // for the life of the page. Past 30 total messages in one session
    // (about 15 exchanges), every subsequent send would fail with a 400 and
    // the widget would show the generic "having trouble connecting"
    // fallback forever, never recovering until the page reloads.
    if (this.messages.length > MAX_HISTORY) this.messages = this.messages.slice(-MAX_HISTORY);
    this.persist();
    this.render();
    var typing = this.showTyping();

    var wantsHuman = /\b(talk to a (human|real person|person)|real agent|human agent|customer support|call me|whatsapp|whats app)\b/i.test(text);

    try {
      var res = await fetch(this.apiBase + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.messages,
          persona: this.persona || undefined,
          knownLead: this.knownLead,
          conversationSummary: this.conversationSummary,
        }),
      });

      if (!res.ok) {
        var errBody = null;
        try {
          errBody = await res.json();
        } catch {
          // ignore
        }
        throw new Error((errBody && errBody.error) || 'request failed');
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var reply = '';
      var streamingBubble = null;
      var meta = null;

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        var idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          var raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!raw.startsWith('data:')) continue;
          var data;
          try {
            data = JSON.parse(raw.slice(5).trim());
          } catch {
            continue;
          }
          if (data.type === 'meta') {
            meta = data;
            if (data.assistantName) {
              this.headName.textContent = data.assistantName + ' · Interio Arty';
              this.avatarEl.textContent = data.assistantName.charAt(0);
              this.labelEl.textContent = 'Ask ' + data.assistantName;
            }
          } else if (data.type === 'delta') {
            reply += data.text;
            if (!streamingBubble) {
              typing.remove();
              streamingBubble = el('div', 'iw-msg bot', '');
              this.messagesEl.appendChild(streamingBubble);
            }
            streamingBubble.textContent = reply;
            this.scrollBottom();
          } else if (data.type === 'lead') {
            this.mergeKnownLead(data.lead);
            this.handleLead(data.lead, data.qualified);
          }
        }
      }

      typing.remove();
      this.sending = false;
      this.sendBtn.disabled = false;

      if (!reply) {
        throw new Error('empty reply');
      }

      this.pushMsg({ role: 'assistant', content: reply });
      this.refreshLeadTranscript();
      if (this.messages.length > MAX_HISTORY) this.messages = this.messages.slice(-MAX_HISTORY);
      this.persist();
      this.render();
      this.maybeUpdateSummary();

      // Deterministic safety net for long conversations: once the server
      // signals the model's context window has cycled through many turns,
      // surface the human-handoff CTA regardless of what the model itself
      // said, rather than relying on it to remember to suggest one.
      if (meta && meta.longConversation) this.showHandoff();

      if (wantsHuman) this.showHandoff();
    } catch (err) {
      typing.remove();
      this.sending = false;
      this.sendBtn.disabled = false;
      this.pushMsg({
        role: 'assistant',
        content: "I'm sorry, I'm having trouble connecting right now. Our team can help immediately:",
      });
      if (this.messages.length > MAX_HISTORY) this.messages = this.messages.slice(-MAX_HISTORY);
      this.persist();
      this.render();
      this.showHandoff();
    }
  };

  InterioArtyWidget.prototype.handleLead = function (lead, qualified) {
    if (!lead || !qualified) return;
    var existing = getLeads();
    var dup =
      existing.find(function (l) {
        return (lead.phone && l.phone === lead.phone) || (lead.email && l.email === lead.email);
      }) || null;

    var now = new Date().toISOString();
    var record;
    if (dup) {
      record = Object.assign({}, dup, {
        name: dup.name || lead.name || '',
        phone: dup.phone || lead.phone || '',
        email: dup.email || lead.email || '',
        location: dup.location || lead.cityHint || '',
        bhk: dup.bhk || lead.bhkHint || '',
        budget: dup.budget || lead.budgetHint || '',
        time: now,
        transcript: this.log.slice(),
        summarizing: true,
      });
      this.leadId = dup.id;
    } else {
      record = {
        id: Date.now(),
        name: lead.name || '',
        phone: lead.phone || '',
        email: lead.email || '',
        location: lead.cityHint || '',
        bhk: lead.bhkHint || '',
        budget: lead.budgetHint || '',
        source: 'Website Chatbot',
        status: 'new',
        time: now,
        transcript: this.log.slice(),
        summarizing: true,
      };
      this.leadId = record.id;
    }

    var idx = existing.findIndex(function (l) {
      return l.id === record.id;
    });
    if (idx >= 0) existing[idx] = record;
    else existing.unshift(record);
    saveLeads(existing);

    if (!record.cid) {
      record.cid = newCid();
      existing[idx >= 0 ? idx : 0] = record;
      saveLeads(existing);
    }

    if (this.bc) this.bc.postMessage(record);
    this.syncLead(record.id);
    this.summarize(record.id);
  };

  function newCid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var out = '';
    for (var i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  // Sends the lead to the studio's backend so it shows in the admin panel on
  // any device. Syncs are chained so they land in order (a late "summarizing"
  // snapshot can never overwrite the finished summary), always send the
  // latest local record, and retry a couple of times if the network blips.
  // A failed sync never affects the chat: the lead is still kept locally.
  InterioArtyWidget.prototype.syncLead = function (id) {
    var self = this;
    this.syncChain = this.syncChain.then(function () {
      var rec = getLeads().find(function (l) {
        return l.id === id;
      });
      if (!rec || !rec.cid) return null;
      var body = JSON.stringify({
        cid: rec.cid,
        name: rec.name,
        phone: rec.phone,
        email: rec.email,
        projectType: rec.projectType,
        bhk: rec.bhk,
        location: rec.location,
        budget: rec.budget,
        timeline: rec.timeline,
        summary: rec.summary,
        summarizing: rec.summarizing === true,
        transcript: rec.transcript,
      });
      var attempt = function (n) {
        return fetch(self.apiBase + '/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        })
          .then(function (r) {
            if (!r.ok && r.status >= 500 && n < 3) throw new Error('retry');
          })
          .catch(function () {
            if (n >= 3) return null;
            return new Promise(function (resolve) {
              setTimeout(resolve, n * 4000);
            }).then(function () {
              return attempt(n + 1);
            });
          });
      };
      return attempt(1);
    });
  };

  // The lead event arrives before the assistant's reply is added to the log, so
  // once the reply lands the stored lead gets the up-to-date transcript.
  InterioArtyWidget.prototype.refreshLeadTranscript = function () {
    if (!this.leadId) return;
    var id = this.leadId;
    var list = getLeads();
    var rec = list.find(function (l) {
      return l.id === id;
    });
    if (!rec) return;
    rec.transcript = this.log.slice();
    saveLeads(list);
    this.syncLead(id);
  };

  InterioArtyWidget.prototype.summarize = function (id) {
    var self = this;
    if (this.summarizeFlights >= MAX_SUMMARIZE_FLIGHTS) return;
    this.summarizeFlights += 1;

    fetch(this.apiBase + '/api/summarize-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: this.messages,
        persona: this.persona || undefined,
        // Backfills any structured field (budget/BHK/project type/contact)
        // that was stated early in a long chat and has since scrolled out
        // of the last-30-message window sent above, so the CRM record
        // never silently drops something the chat itself never lost.
        knownLead: this.knownLead,
        conversationSummary: this.conversationSummary,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (ai) {
        var list = getLeads();
        var rec = list.find(function (l) {
          return l.id === id;
        });
        if (!rec) return;
        rec.name = rec.name || ai.name || '';
        rec.phone = rec.phone || ai.phone || '';
        rec.email = rec.email || ai.email || '';
        if (ai.projectType) rec.projectType = ai.projectType;
        if (ai.bhk) rec.bhk = ai.bhk;
        if (ai.budget) rec.budget = ai.budget;
        if (ai.location) rec.location = ai.location;
        if (ai.timeline) rec.timeline = ai.timeline;
        rec.summary = ai.summary || rec.summary || null;
        rec.summarizing = false;
        saveLeads(list);
        if (self.bc) self.bc.postMessage(rec);
        self.syncLead(id);
      })
      .catch(function () {
        var list = getLeads();
        var rec = list.find(function (l) {
          return l.id === id;
        });
        if (rec) {
          rec.summarizing = false;
          rec.summary = rec.summary || 'AI summary failed. See transcript.';
          saveLeads(list);
          if (self.bc) self.bc.postMessage(rec);
          self.syncLead(id);
        }
      })
      .finally(function () {
        self.summarizeFlights -= 1;
      });
  };

  // ---- Boot: read the script tag, build the widget, expose the API ----
  function initFromScript() {
    var current = document.currentScript;
    var cfg = { apiBase: '', persona: null };
    if (current && current.getAttribute) {
      var base = current.getAttribute('data-api-base');
      if (base) cfg.apiBase = base.replace(/\/+$/, '');
      var persona = current.getAttribute('data-persona');
      if (persona) cfg.persona = persona;
    }
    if (!cfg.apiBase && current && current.src) {
      try {
        cfg.apiBase = new URL(current.src).origin;
      } catch {
        cfg.apiBase = '';
      }
    }

    var widget = new InterioArtyWidget(cfg);

    window.ArtyChat = {
      open: function (prefill) {
        widget.open(prefill);
      },
    };
    window.InterioArtyChat = {
      init: function (options) {
        return window.InterioArtyChat;
      },
      open: function (prefill) {
        widget.open(prefill);
      },
      persona: function () {
        return widget.persona;
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFromScript);
  } else {
    initFromScript();
  }
})();