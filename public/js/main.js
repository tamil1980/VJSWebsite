/* ==========================================================================
   VJS Soft Solutions - Frontend scripts
   ========================================================================== */
(function () {
  "use strict";

  var NAV_BREAKPOINT = 768;

  /* ---------- Sticky header (shadow + hide on scroll down) ---------- */
  var header = document.getElementById("siteHeader");
  var lastScrollY = window.scrollY;

  function onScrollHeader() {
    if (!header) return;
    var y = window.scrollY;
    header.classList.toggle("scrolled", y > 10);
    if (y > lastScrollY && y > 160) {
      header.classList.add("hidden");
    } else {
      header.classList.remove("hidden");
    }
    lastScrollY = y;
  }
  window.addEventListener("scroll", onScrollHeader, { passive: true });
  onScrollHeader();

  /* ---------- Mobile navigation toggle ---------- */
  var navToggle = document.getElementById("navToggle");
  var mainNav = document.getElementById("mainNav");

  function closeNav() {
    if (!mainNav || !navToggle) return;
    mainNav.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Toggle navigation menu");
  }

  if (navToggle && mainNav) {
    navToggle.addEventListener("click", function () {
      var open = mainNav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      navToggle.setAttribute("aria-label", open ? "Close navigation menu" : "Toggle navigation menu");
    });

    // Close when a link inside the mobile menu is clicked
    mainNav.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeNav();
    });

    // Close on Escape
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
  }

  /* ---------- Active navigation link highlighting ---------- */
  var navLinks = document.querySelectorAll(".main-nav .nav-link");
  var sections = navLinks
    .map(function (l) {
      var id = l.getAttribute("href");
      if (!id || id.charAt(0) !== "#") return null;
      return document.querySelector(id);
    })
    .filter(Boolean);

  function setActiveLink() {
    var pos = window.scrollY + 110;
    var current = null;

    sections.forEach(function (sec) {
      if (sec.offsetTop <= pos) current = sec.getAttribute("id");
    });

    navLinks.forEach(function (link) {
      var active = link.getAttribute("href") === "#" + current;
      link.classList.toggle("active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  window.addEventListener("scroll", setActiveLink, { passive: true });
  setActiveLink();

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll(".section, .hero");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal", "visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Enquiry form ---------- */
  var form = document.getElementById("enquiryForm");
  if (form) {
    var submitBtn = document.getElementById("submitBtn");
    var statusEl = document.getElementById("formStatus");

    var FIELD_LABELS = {
      name: "Name",
      email: "Email",
      mobile: "Mobile Number",
      service: "Course / Service",
      message: "Message"
    };

    function setStatus(type, text) {
      statusEl.className = "form-status show " + type;
      statusEl.textContent = text;
    }

    function clearStatus() {
      statusEl.className = "form-status";
      statusEl.textContent = "";
    }

    function setInvalid(input, errorEl, valid) {
      input.classList.toggle("invalid", !valid);
      if (errorEl) {
        errorEl.textContent = valid ? "" : errorEl.getAttribute("data-msg") || "";
      }
    }

    function validate() {
      var ok = true;
      var firstInvalid = null;

      ["name", "email", "mobile", "service", "message"].forEach(function (field) {
        var input = document.getElementById(field);
        var errorEl = form.querySelector('[data-error-for="' + field + '"]');
        var valid = true;
        var value = (input.value || "").trim();

        if (field === "name") {
          valid = value.length >= 2;
          if (!valid) errorEl.setAttribute("data-msg", FIELD_LABELS[field] + " is required (min 2 characters).");
        } else if (field === "email") {
          valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
          if (!valid) errorEl.setAttribute("data-msg", "Please enter a valid email address.");
        } else if (field === "mobile") {
          var digits = value.replace(/[^0-9]/g, "");
          valid = /^[0-9+\-\s]{10,15}$/.test(value) && digits.length >= 10;
          if (!valid) errorEl.setAttribute("data-msg", "Enter a valid 10-digit mobile number.");
        } else if (field === "service") {
          valid = value !== "";
          if (!valid) errorEl.setAttribute("data-msg", "Please select a course / service.");
        } else if (field === "message") {
          valid = value.length >= 10;
          if (!valid) errorEl.setAttribute("data-msg", FIELD_LABELS[field] + " is required (min 10 characters).");
        }

        setInvalid(input, errorEl, valid);
        if (!valid) {
          ok = false;
          if (!firstInvalid) firstInvalid = input;
        }
      });

      if (firstInvalid) firstInvalid.focus();
      return ok;
    }

    function clearInlineErrors() {
      ["name", "email", "mobile", "service", "message"].forEach(function (field) {
        var input = document.getElementById(field);
        var errorEl = form.querySelector('[data-error-for="' + field + '"]');
        setInvalid(input, errorEl, true);
      });
    }

    /* ---------- Status popup (modal) ---------- */
    var modal = document.getElementById("statusModal");
    var modalIcon = document.getElementById("modalIcon");
    var modalTitle = document.getElementById("modalTitle");
    var modalMessage = document.getElementById("modalMessage");
    var modalSummary = document.getElementById("modalSummary");
    var modalClose = document.getElementById("modalClose");
    var lastFocused = null;

    function escHTML(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function buildSummary(payload) {
      return [
        ["Name", payload.name],
        ["Email", payload.email],
        ["Mobile Number", payload.mobile],
        ["Company / Organization", payload.organization || "-"],
        ["Course / Service", payload.service]
      ]
        .map(function (row) {
          return (
            '<div class="sum-row"><span class="sum-label">' +
            escHTML(row[0]) +
            '</span><span class="sum-value">' +
            escHTML(row[1]) +
            "</span></div>"
          );
        })
        .join("");
    }

    function showModal(type, title, message, summary) {
      modal.classList.remove("success", "error");
      modal.classList.add(type, "show");
      modal.setAttribute("aria-hidden", "false");
      modalIcon.textContent = type === "success" ? "\u2713" : "\u2715";
      modalTitle.textContent = title;
      modalMessage.textContent = message;
      modalSummary.innerHTML = summary || "";
      lastFocused = document.activeElement;
      modalClose.focus();
      document.body.style.overflow = "hidden";
    }

    function hideModal() {
      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    modal.querySelectorAll("[data-modal-close]").forEach(function (el) {
      el.addEventListener("click", hideModal);
    });
    if (modalClose) modalClose.addEventListener("click", hideModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("show")) hideModal();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearStatus();

      if (!validate()) {
        setStatus("error", "Please correct the highlighted fields and try again.");
        return;
      }

      var payload = {
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim(),
        mobile: document.getElementById("mobile").value.trim(),
        organization: (document.getElementById("organization").value || "").trim(),
        service: document.getElementById("service").value,
        message: document.getElementById("message").value.trim()
      };

      submitBtn.classList.add("loading");
      submitBtn.textContent = "Sending...";

      fetch("/api/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok) {
            showModal(
              "success",
              "Enquiry Sent Successfully!",
              "Thank you, " + payload.name.split(" ")[0] + "! Your enquiry has been received. We will contact you soon.",
              buildSummary(payload)
            );
            setStatus("success", "Thank you! Your enquiry has been sent. We will contact you soon.");
            form.reset();
            clearInlineErrors();
          } else {
            showModal(
              "error",
              "Submission Failed",
              result.data.message || "Something went wrong. Please try again or email us directly at vjssoftsystems@gmail.com."
            );
          }
        })
        .catch(function () {
          showModal(
            "error",
            "Submission Failed",
            "A network error occurred. Please try again or email us directly at vjssoftsystems@gmail.com."
          );
          setStatus("error", "Network error. Please try again or email us directly at vjssoftsystems@gmail.com.");
        })
        .finally(function () {
          submitBtn.classList.remove("loading");
          submitBtn.textContent = "Send Enquiry";
        });
    });
  }
})();