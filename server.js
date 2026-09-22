/* ==========================================================================
   VJS Soft Solutions - Web server
   Serves the static site and securely processes the enquiry form.
   SMTP credentials are read from environment variables (.env) only and are
   NEVER exposed to the frontend.
   ========================================================================== */

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

const CONTACT_EMAIL = (process.env.CONTACT_EMAIL || "vjssoftsystems@gmail.com").trim();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/* ---------- Config ---------- */
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "50kb" }));

/* ---------- Security headers ---------- */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
  );
  next();
});

/* ---------- Static files ---------- */
const publicDir = path.join(__dirname, "public");
app.use(
  express.static(publicDir, {
    index: "index.html",
    setHeaders(res, filePath) {
      if (filePath.endsWith(".svg")) {
        res.setHeader("Cache-Control", "public, max-age=600");
      }
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

const isSameOrigin = (req) => {
  if (ALLOWED_ORIGINS.includes("*")) return true;
  const origin = req.headers.origin;
  if (!origin || origin === "null") return false;
  return ALLOWED_ORIGINS.some(
    (allowed) =>
      origin === allowed ||
      (allowed !== "*" && origin.startsWith(allowed.replace(/\/$/, "")))
  );
};

/* ---------- Rate limiting (anti-spam / abuse protection) ---------- */
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "Too many enquiries. Please try again later." },
});

/* ---------- Validation helpers ---------- */
const cleanText = (value, max) =>
  String(value || "")
    .trim()
    .replace(/\r?\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, max);

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v || "");
const isValidMobile = (v) => {
  const digits = String(v || "").replace(/[^0-9]/g, "");
  return /^[0-9+\-\s]{10,15}$/.test(String(v || "").trim()) && digits.length >= 10;
};

// A simple honeypot: any enquiry claiming to already "own" the mailbox is blocked.
const SPAM_MARKERS = [
  /vjssoftsystems@gmail\.com/i, // never allow the mailbox itself as sender
  /^(http|www\.)/i,
  /buy now|earn money|bitcoin|casino|viagra|make money|free gift/i,
];

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const smtpConfigured = () =>
  !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

/* ---------- Local enquiry record (safety net) ----------
   Every enquiry is appended to data/enquiries.jsonl regardless of email
   delivery, so no enquiry is ever lost. Emails are sent via SMTP when
   credentials are configured in .env */
const DATA_DIR = path.join(__dirname, "data");
const ENQUIRIES_FILE = path.join(DATA_DIR, "enquiries.jsonl");

function recordEnquiry(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const entry = JSON.stringify({ submittedAt: new Date().toISOString(), ...data }) + "\n";
    fs.appendFileSync(ENQUIRIES_FILE, entry, "utf8");
  } catch (err) {
    console.error("[enquiry-record-failed]", err.message);
  }
}

const REQUIRED = ["name", "email", "mobile", "service", "message"];

function validatePayload(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Invalid request." };
  }
  const data = {
    name: cleanText(body.name, 100),
    email: cleanText(body.email, 150),
    mobile: cleanText(body.mobile, 15),
    organization: cleanText(body.organization, 150),
    service: cleanText(body.service, 120),
    message: cleanText(body.message, 2000),
  };

  if (!REQUIRED.every((k) => k in body)) {
    return { error: "Missing required fields." };
  }
  if (data.name.length < 2) return { error: "Please provide your full name." };
  if (!isValidEmail(data.email)) return { error: "Please provide a valid email address." };
  if (!isValidMobile(data.mobile)) return { error: "Please provide a valid 10-digit mobile number." };
  if (!data.service) return { error: "Please select a course / service." };
  if (data.message.length < 10) return { error: "Please include a message (min 10 characters)." };

  const combined = (data.name + " " + data.email + " " + data.organization + " " + data.message).toLowerCase();
  if (SPAM_MARKERS.some((re) => re.test(combined))) {
    return { spam: true };
  }
  return { data };
}

/* ---------- Enquiry endpoint ---------- */
app.post("/api/enquiry", apiLimiter, async (req, res) => {
  try {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ ok: false, message: "Request blocked." });
    }

    const result = validatePayload(req.body);
    if (result.error) {
      return res.status(400).json({ ok: false, message: result.error });
    }
    // Silently accept spam submissions so spammers can't probe the form.
    if (result.spam) {
      return res.status(200).json({ ok: true });
    }

    const data = result.data;

    // Always record the enquiry locally first.
    recordEnquiry(data);

    // Send email if SMTP credentials are configured.
    if (smtpConfigured()) {
      let transporter;
      try {
        const subject = `New Enquiry - ${data.service} - ${data.name}`.slice(0, 120);
        const html = buildEmailHTML(data);

        transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 465),
          secure: String(process.env.SMTP_SECURE) !== "false",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
          newline: false, // hardens against header injection
          connectionTimeout: 15000,
          socketTimeout: 20000,
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: CONTACT_EMAIL,
          replyTo: data.email,
          subject,
          text: [
            "New Website Enquiry",
            "-------------------",
            `Name: ${data.name}`,
            `Email: ${data.email}`,
            `Mobile: ${data.mobile}`,
            `Company / Organization: ${data.organization || "-"}`,
            `Course / Service: ${data.service}`,
            `Message: ${data.message}`,
            "-------------------",
            "Sent from the enquiry form at vjssoftsolutions.com",
          ].join("\n"),
          html,
        });

        console.log(`[enquiry] ${data.name} <${data.email}> - ${data.service} (email sent)`);
      } catch (err) {
        // Enquiry is already recorded locally, so still confirm delivery to the user.
        console.error(`[enquiry-email-failed] ${data.email} - ${err.message}`);
      }
    } else {
      console.warn(
        "[enquiry] SMTP not configured - enquiry recorded in data/enquiries.jsonl. " +
          "Set SMTP_* variables in .env to also deliver by email."
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[enquiry-error]", err.message);
    return res.status(500).json({
      ok: false,
      message: "Could not submit your enquiry right now. Please email us directly at " + CONTACT_EMAIL + ".",
    });
  }
});

function buildEmailHTML(data) {
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#16233c;max-width:640px">',
    '<h2 style="color:#0d2a5e">New Website Enquiry</h2>',
    '<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%" role="presentation">',
    rowHTML("Name", data.name),
    rowHTML("Email", data.email),
    rowHTML("Mobile", data.mobile),
    rowHTML("Company / Organization", data.organization || "-"),
    rowHTML("Course / Service", data.service),
    rowHTML("Message", data.message),
    "</table>",
    '<p style="color:#64748b;font-size:12px;border-top:1px solid #eee;padding-top:10px">',
    "Sent from the enquiry form at vjssoftsolutions.com",
    "</p></div>",
  ].join("");
}

function rowHTML(label, value) {
  return (
    '<tr><td style="font-weight:700;background:#f6f9fd;color:#0d2a5e;border:1px solid #e5ecf5;vertical-align:top;width:180px">' +
    escapeHtml(label) +
    '</td><td style="border:1px solid #e5ecf5;vertical-align:top;white-space:pre-wrap;word-break:break-word">' +
    escapeHtml(value) +
    "</td></tr>"
  );
}

/* ---------- SPA fallback ---------- */
app.use((req, res) => {
  if (req.method === "GET") {
    res.sendFile(path.join(publicDir, "index.html"));
  } else {
    res.status(405).json({ ok: false, message: "Method not allowed." });
  }
});

/* ---------- Error handler ---------- */
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      ok: false,
      message: "Invalid request."
    });
  }

  console.error("[server-error]", err.message);

  res.status(500).json({
    ok: false,
    message: "Internal server error."
  });
});



