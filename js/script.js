document.addEventListener('DOMContentLoaded', () => {
    loadFragments().then(() => {
        initNavbar();
        initEnquiryModal();
    });

    initRevealOnScroll();
    initFaqAccordion();
    initTestimonialCarousel();
    initVrParallax();
    initServicesIndex();
    initCtaForm();
});

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

    const current = document.body.getAttribute('data-page');
    if (current) {
        navbar.querySelectorAll('.navbar__link').forEach(link => {
            if (link.getAttribute('data-page') === current) link.classList.add('is-active');
        });
    }
}

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

function initServicesIndex() {
    const items = document.querySelectorAll('.services-index__item');
    const stageImgs = document.querySelectorAll('.services-index__stage-img');
    const label = document.getElementById('servicesStageLabel');
    if (!items.length || !stageImgs.length) return;

    items.forEach(item => {
        const activate = () => {
            items.forEach(i => i.classList.remove('is-active'));
            item.classList.add('is-active');
            const target = item.dataset.image;
            stageImgs.forEach(img => img.classList.toggle('is-active', img.dataset.image === target));
            if (label) label.textContent = item.dataset.label;
        };
        item.addEventListener('mouseenter', activate);
        item.addEventListener('focus', activate);
    });
}

function initCtaForm() {
    const form = document.getElementById('ctaForm');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        btn.textContent = 'Sending…';
        btn.disabled = true;

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

function initEnquiryModal() {
    const modal = document.getElementById('enquiryModal');
    if (!modal) return;

    const backdrop = document.getElementById('enquiryModalBackdrop');
    const closeBtn = document.getElementById('enquiryModalClose');
    const form = document.getElementById('enquiryForm');

    const open = () => {
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        const firstInput = modal.querySelector('input');
        if (firstInput) setTimeout(() => firstInput.focus(), 150);
    };

    const close = () => {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
    };

    // Open triggers: #enquireBtn in navbar, plus any [data-enquire] element anywhere on the page
    document.querySelectorAll('#enquireBtn, [data-enquire]').forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            open();
        });
    });

    closeBtn?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
    });

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        btn.textContent = 'Sending…';
        btn.disabled = true;

        // TODO: replace with your real submission endpoint
        // const formData = new FormData(form);

        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
            modal.classList.add('is-success');

            setTimeout(() => {
                close();
                modal.classList.remove('is-success');
                form.reset();
            }, 2200);
        }, 700);
    });
}