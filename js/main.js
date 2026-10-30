/* ===========================
   Muniyasamy Laundry — Main JS
   No dependencies.
   =========================== */

(function () {
  'use strict';

  document.querySelectorAll('img[data-image-fallback]').forEach(function (image) {
    image.addEventListener('error', function () {
      image.src = image.dataset.imageFallback;
      image.alt = 'Laundry equipment in a clean interior';
      image.removeAttribute('data-image-fallback');
    }, { once: true });
  });

  // --- Mobile Navigation Toggle ---
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('nav-menu');

  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!expanded));
      menu.classList.toggle('nav__menu--open');
    });

    // Close menu when a link is clicked
    menu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        toggle.setAttribute('aria-expanded', 'false');
        menu.classList.remove('nav__menu--open');
      });
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('nav__menu--open')) {
        toggle.setAttribute('aria-expanded', 'false');
        menu.classList.remove('nav__menu--open');
        toggle.focus();
      }
    });

    // Close on click outside
    document.addEventListener('click', function (e) {
      if (menu.classList.contains('nav__menu--open') &&
          !menu.contains(e.target) &&
          !toggle.contains(e.target)) {
        toggle.setAttribute('aria-expanded', 'false');
        menu.classList.remove('nav__menu--open');
      }
    });
  }

  // --- Sticky Header Shadow ---
  const header = document.querySelector('.site-header');

  if (header) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 10) {
        header.classList.add('nav--scrolled');
      } else {
        header.classList.remove('nav--scrolled');
      }
    }, { passive: true });
  }

  // --- Contact Form AJAX Submission ---
  var contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();

      var submitBtn = document.getElementById('contact-submit');
      var successMsg = document.getElementById('contact-success');
      var errorMsg = document.getElementById('contact-error');

      // Reset status messages
      successMsg.classList.remove('is-active');
      errorMsg.classList.remove('is-active');

      // Loading state
      var originalText = submitBtn.textContent;
      submitBtn.textContent = 'Sending...';
      submitBtn.disabled = true;

      var formData = new FormData(contactForm);

      var messagePayload = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone') || '',
        location: formData.get('location') || '',
        message: formData.get('message')
      };

      fetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify(messagePayload),
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
      })
      .then(function (response) {
        if (response.ok) {
          successMsg.classList.add('is-active');
          contactForm.reset();
        } else {
          errorMsg.classList.add('is-active');
        }
      })
      .catch(function () {
        errorMsg.classList.add('is-active');
      })
      .finally(function () {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      });
    });
  }

  // The public catalogue reads the same configured services as the booking portal.
  var serviceList = document.getElementById('public-services');
  if (serviceList) {
    fetch('/api/services', { headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Unable to load services');
        return response.json();
      })
      .then(function (data) {
        serviceList.replaceChildren();
        var services = Array.isArray(data.services) ? data.services : [];
        if (!services.length) {
          var empty = document.createElement('p');
          empty.className = 'catalog-message';
          empty.textContent = 'No services are currently listed. Please call 9843911292 for details.';
          serviceList.appendChild(empty);
          return;
        }
        // Use one purpose-matched local photo per configured service. Avoid broad
        // keyword matching, which made every ironing service share the same image.
        var servicePhotos = {
          'dry-clean': { src: 'assets/images/service-dry-cleaning.jpg', alt: 'Fresh garments arranged on a clothing rack' },
          'express': { src: 'assets/images/service-express-care.jpg', alt: 'Laundry care professional folding a freshly cleaned garment' },
          'regular-ironing': { src: 'assets/images/service-regular-ironing.jpg', alt: 'A garment being pressed with a regular clothes iron' },
          'steam-ironing': { src: 'assets/images/service-steam-ironing.jpg', alt: 'A handheld steamer smoothing a hanging shirt' },
          'wash-fold': { src: 'assets/images/service-wash-fold.jpg', alt: 'Fresh folded towels arranged in a basket' },
          'wash-iron': { src: 'assets/images/service-wash-iron.jpg', alt: 'Clothes being washed in a commercial laundry machine' }
        };
        services.forEach(function (service) {
          var card = document.createElement('article');
          card.className = 'public-service';
          var serviceLabel = [service.name, service.description].filter(Boolean).join(' ').toLowerCase();
          var iconKind = /express|priority/.test(serviceLabel) ? 'clock'
            : /iron|press/.test(serviceLabel) ? 'iron'
              : /dry clean|delicate|garment/.test(serviceLabel) ? 'hanger' : 'laundry';
          var iconShapes = {
            clock: ['M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Z', 'M12 7v5l3 2'],
            iron: ['M4 19h16l-2-7a3 3 0 0 0-3-2H8l-4 9Z', 'M8 10V7a2 2 0 0 1 2-2h2'],
            hanger: ['M12 4a2 2 0 0 0-2 2c0 .8.5 1.5 1.2 1.8', 'M12 8l8.7 7.2a1.5 1.5 0 0 1-1 2.7H4.3a1.5 1.5 0 0 1-1-2.7L11 9'],
            laundry: ['M16 4l4 2 3 4-4 2v8H5v-8l-4-2 3-4 4-1 4 3 4-3Z', 'M9 13h6']
          };
          var visual = document.createElement('div');
          visual.className = 'public-service__visual';
          var photo = document.createElement('img');
          photo.className = 'public-service__photo';
          photo.loading = 'lazy';
          photo.decoding = 'async';
          photo.referrerPolicy = 'no-referrer';
          var servicePhoto = servicePhotos[String(service.slug || '').toLowerCase()];
          photo.src = servicePhoto ? servicePhoto.src : 'assets/images/hero_interior.jpeg';
          photo.alt = servicePhoto ? servicePhoto.alt : 'Laundry equipment in a clean interior';
          photo.addEventListener('error', function () {
            photo.onerror = null;
            photo.src = 'assets/images/hero_interior.jpeg';
            photo.alt = 'Laundry equipment in a clean interior';
          }, { once: true });
          var badge = document.createElement('span');
          badge.className = 'public-service__icon';
          badge.setAttribute('aria-hidden', 'true');
          var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke', 'currentColor');
          svg.setAttribute('stroke-width', '1.7');
          svg.setAttribute('stroke-linecap', 'round');
          svg.setAttribute('stroke-linejoin', 'round');
          iconShapes[iconKind].forEach(function (shape) {
            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', shape);
            svg.appendChild(path);
          });
          badge.appendChild(svg);
          visual.append(photo, badge);

          var title = document.createElement('h3');
          title.textContent = service.name;
          var description = document.createElement('p');
          description.textContent = service.description || 'Laundry service';
          var price = document.createElement('strong');
          var hasPrice = service.price !== null && service.price !== undefined && String(service.price).trim() !== '';
          var parsedPrice = Number(service.price);
          var unitLabel = service.unit === 'piece' ? 'piece' : service.unit === 'kg' ? 'kg' : '';
          price.textContent = hasPrice && Number.isFinite(parsedPrice) && parsedPrice >= 0
            ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(parsedPrice) + (unitLabel ? ' / ' + unitLabel : '')
            : 'Contact for current pricing';
          var action = document.createElement('a');
          action.className = 'public-service__action';
          action.href = '/portal/';
          action.textContent = 'Book this service';
          card.append(visual, title, description, price);
          var minimumQuantity = Number(service.minimumQuantity);
          if (Number.isFinite(minimumQuantity) && minimumQuantity > 0 && unitLabel) {
            var minimum = document.createElement('small');
            minimum.textContent = 'Minimum quantity: ' + minimumQuantity + ' ' + (unitLabel === 'piece' ? 'piece(s)' : 'kg');
            card.appendChild(minimum);
          }
          card.appendChild(action);
          serviceList.appendChild(card);
        });
      })
      .catch(function () {
        serviceList.replaceChildren();
        var unavailable = document.createElement('p');
        unavailable.className = 'catalog-message';
        unavailable.textContent = 'Current pricing is temporarily unavailable. Please call 9843911292 or sign in to view booking options.';
        serviceList.appendChild(unavailable);
      })
      .finally(function () { serviceList.setAttribute('aria-busy', 'false'); });
  }

  // --- Scroll-triggered Animations ---
  var animatedElements = document.querySelectorAll('.animate-on-scroll');

  if (animatedElements.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px'
    });

    animatedElements.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    // Fallback: show everything immediately
    animatedElements.forEach(function (el) {
      el.classList.add('is-visible');
    });
  }
})();
