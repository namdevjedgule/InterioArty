/* =========================================================
   InterioArty — script.js
   Fragment loading + all site interactions.
   NOTE: This file must be served over http(s) (e.g. `npx serve`,
   VS Code "Live Server", or python -m http.server) for the
   fetch() fragment includes below to work — opening index.html
   directly as a file:// URL will block them (CORS).
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
    loadFragments().then(() => {
        initNavbar();
        initChatWidget();
    });

    initRevealOnScroll();
    initFaqAccordion();
    initTestimonialCarousel();
    initVrParallax();
    initCtaForm();
});

/* ---------------------------------------------------------
   Fragment loading (navbar / footer / chat widget)
   --------------------------------------------------------- */
function loadFragments() {
    const slots = document.querySelectorAll('[data-include]');
    const jobs = Array.from(slots).map(slot => {
        const url = slot.getAttribute('data-include');
        return fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load ${url}`);
                return res.text();
            })
            .then(html => { slot.outerHTML = html; })
            .catch(err => console.error(err));
    });
    return Promise.all(jobs);
}

/* ---------------------------------------------------------
   Navbar: scroll state, active link, mobile toggle
   --------------------------------------------------------- */
function initNavbar() {
    const navbar = document.getElementById('navbar');
    const toggle = document.getElementById('navToggle');
    const nav = document.getElementById('navbarNav');
    if (!navbar) return;

    const onScroll = () => {
        navbar.classList.toggle('is-scrolled', window.scrollY > 40);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    if (toggle && nav) {
        toggle.addEventListener('click', () => {
            const isOpen = nav.classList.toggle('is-open');
            toggle.classList.toggle('is-open', isOpen);
            toggle.setAttribute('aria-expanded', isOpen);
        });
        nav.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                nav.classList.remove('is-open');
                toggle.classList.remove('is-open');
                toggle.setAttribute('aria-expanded', false);
            });
        });
    }

    // Mark active page link
    const current = document.body.getAttribute('data-page');
    if (current) {
        navbar.querySelectorAll('.navbar__link').forEach(link => {
            if (link.getAttribute('data-page') === current) link.classList.add('is-active');
        });
    }
}

/* ---------------------------------------------------------
   Scroll reveal (IntersectionObserver)
   --------------------------------------------------------- */
function initRevealOnScroll() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15 });

    items.forEach(item => observer.observe(item));
}

/* ---------------------------------------------------------
   FAQ accordion
   --------------------------------------------------------- */
function initFaqAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');
    if (!faqItems.length) return;

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-item__q');
        const answer = item.querySelector('.faq-item__a');

        question.addEventListener('click', () => {
            const isOpen = item.classList.contains('is-open');

            faqItems.forEach(other => {
                other.classList.remove('is-open');
                other.querySelector('.faq-item__a').style.maxHeight = null;
                other.querySelector('.faq-item__q').setAttribute('aria-expanded', 'false');
            });

            if (!isOpen) {
                item.classList.add('is-open');
                answer.style.maxHeight = answer.scrollHeight + 'px';
                question.setAttribute('aria-expanded', 'true');
            }
        });
    });
}

/* ---------------------------------------------------------
   Testimonial carousel
   --------------------------------------------------------- */
function initTestimonialCarousel() {
    const root = document.querySelector('.carousel');
    if (!root) return;

    const slides = Array.from(root.querySelectorAll('.carousel__slide'));
    const dotsWrap = root.querySelector('.carousel__dots');
    const prevBtn = root.querySelector('.carousel__arrow--prev');
    const nextBtn = root.querySelector('.carousel__arrow--next');
    let index = 0;
    let timer;

    slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'carousel__dot';
        dot.setAttribute('aria-label', `Go to testimonial ${i + 1}`);
        dot.addEventListener('click', () => goTo(i));
        dotsWrap.appendChild(dot);
    });
    const dots = Array.from(dotsWrap.children);

    function goTo(i) {
        slides[index].classList.remove('is-active');
        dots[index].classList.remove('is-active');
        index = (i + slides.length) % slides.length;
        slides[index].classList.add('is-active');
        dots[index].classList.add('is-active');
        resetTimer();
    }

    function resetTimer() {
        clearInterval(timer);
        timer = setInterval(() => goTo(index + 1), 6000);
    }

    prevBtn?.addEventListener('click', () => goTo(index - 1));
    nextBtn?.addEventListener('click', () => goTo(index + 1));

    goTo(0);
    resetTimer();
}

/* ---------------------------------------------------------
   VR "move to look around" parallax
   --------------------------------------------------------- */
function initVrParallax() {
    const stage = document.querySelector('.vr__stage');
    if (!stage) return;
    const img = stage.querySelector('img');

    stage.addEventListener('mousemove', (e) => {
        const rect = stage.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        img.style.transform = `translate(${-x * 18}px, ${-y * 14}px) scale(1.02)`;
    });
    stage.addEventListener('mouseleave', () => {
        img.style.transform = 'translate(0,0) scale(1)';
    });
}

/* ---------------------------------------------------------
   CTA / contact form (frontend-only placeholder)
   --------------------------------------------------------- */
function initCtaForm() {
    const form = document.getElementById('ctaForm');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        btn.textContent = 'Sending…';
        btn.disabled = true;

        // TODO: replace with a real POST to /api/leads once the
        // Spring Boot backend is live.
        setTimeout(() => {
            btn.textContent = 'Request sent ✓';
            form.reset();
            setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2200);
        }, 900);
    });

    const newsletter = document.getElementById('newsletterForm');
    newsletter?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = newsletter.querySelector('input');
        input.value = '';
        input.placeholder = 'Subscribed ✓';
        setTimeout(() => { input.placeholder = 'Your email'; }, 2500);
    });
}

function initChatWidget() {

    const widget = document.getElementById('chatWidget');
    const toggleBtn = document.getElementById('chatToggle');

    // The chat fragment must at least contain these two
    // elements for the open/close button to work.
    if (!widget || !toggleBtn) {
        console.warn('Chat widget: widget or toggle button not found.');
        return;
    }

    const minimizeBtn = document.getElementById('chatMinimize');
    const body = document.getElementById('chatBody');
    const form = document.getElementById('chatForm');
    const input = document.getElementById('chatInput');
    const quickReplies = document.getElementById('chatQuickReplies');

    const open = () => {
        widget.classList.add('is-open');
        toggleBtn.setAttribute('aria-expanded', 'true');

        // Focus only if input exists
        if (input) {
            input.focus({ preventScroll: true });
        }
    };

    const close = () => {
        widget.classList.remove('is-open');
        toggleBtn.setAttribute('aria-expanded', 'false');
    };

    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (widget.classList.contains('is-open')) {
            close();
        } else {
            open();
        }
    });

    minimizeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        close();
    });

    quickReplies?.addEventListener('click', (e) => {
        const chip = e.target.closest('.chat-chip');
        if (!chip) return;
        sendMessage(chip.dataset.msg);
    });

    if (form && input && body) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            sendMessage(text);
            input.value = '';
        });
    }

    function sendMessage(text) {
        if (!body) return;
        appendMessage(text, 'user');
        quickReplies?.remove();
        showTyping();
        const delay = 700 + Math.random() * 500;
        setTimeout(() => {
            hideTyping();
            appendMessage(
                getPlaceholderReply(text),
                'bot'
            );
        }, delay);
    }

    function appendMessage(text, sender) {
        if (!body) return;
        const el = document.createElement('div');
        el.className = `chat-msg chat-msg--${sender}`;
        el.innerHTML = `<p>${escapeHtml(text)}</p>`;
        body.appendChild(el);
        body.scrollTop = body.scrollHeight;
    }

    function showTyping() {
        if (!body) return;
        const el = document.createElement('div');
        el.className =
            'chat-msg chat-msg--bot chat-msg--typing';
        el.id = 'chatTyping';
        el.innerHTML =
            '<span></span><span></span><span></span>';
        body.appendChild(el);
        body.scrollTop = body.scrollHeight;
    }

    function hideTyping() {
        document
            .getElementById('chatTyping')
            ?.remove();
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getPlaceholderReply(text) {
        const t = text.toLowerCase();
        if (
            t.includes('price') ||
            t.includes('cost') ||
            t.includes('2bhk') ||
            t.includes('budget')
        ) {
            return "Pricing depends on home size, materials and scope — most 2BHK full-interior projects in Pune start upwards of ₹10L. Share your carpet area and I can point you to the right package, or I can have our team call you with a firm quote.";
        }
        if (
            t.includes('vr') ||
            t.includes('walkthrough')
        ) {
            return "Once your layout is finalised, our design team builds a full VR walkthrough of your home — you can walk through it, tweak colours and materials, and approve everything before a single wall moves. It's included free for 2BHK and 3BHK projects.";
        }
        if (
            t.includes('consult') ||
            t.includes('book') ||
            t.includes('call')
        ) {
            return "I'd love to set that up. Could you share your name and phone number here, or use the 'Enquire' button above — our design team typically calls back within a few hours.";
        }
        return "Thanks for reaching out! I'm a preview version of Arty right now — once our Spring Boot backend is connected, I'll be able to answer this from InterioArty's real services, pricing and project data. For now, tap 'Enquire' and our team will get right back to you.";
    }
}