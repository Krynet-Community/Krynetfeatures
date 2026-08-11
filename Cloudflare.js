// Cloudflare.js
// hCaptcha action protection + client throttling + dynamic DOM support.
//
// IMPORTANT:
// This is only the browser-side layer.
// Your backend MUST verify the hCaptcha token with hCaptcha
// and enforce authentication/rate limits server-side.

(() => {
  "use strict";

  const CONFIG = Object.freeze({
    siteKey: "YOUR_HCAPTCHA_SITE_KEY",
    verifyEndpoint: "/verify-hcaptcha",
    maxRequests: 10,
    windowMs: 10_000,
    verificationTimeoutMs: 15_000,
    selector: "[data-hcaptcha]",
    hcaptchaUrl: "https://hcaptcha.com/1/api.js?render=explicit"
  });

  const requestTimes = [];
  const verificationCache = new Map();
  let hcaptchaLoadPromise = null;
  let observerStarted = false;

  // ------------------------------------------------------------
  // Client-side throttle
  // ------------------------------------------------------------

  function canRequest() {
    const now = Date.now();
    const threshold = now - CONFIG.windowMs;

    // Remove expired timestamps efficiently
    let removeCount = 0;
    for (let i = 0; i < requestTimes.length; i++) {
      if (requestTimes[i] < threshold) {
        removeCount++;
      } else {
        break;
      }
    }

    if (removeCount > 0) {
      requestTimes.splice(0, removeCount);
    }

    if (requestTimes.length >= CONFIG.maxRequests) {
      return false;
    }

    requestTimes.push(now);
    return true;
  }

  // ------------------------------------------------------------
  // Load hCaptcha once
  // ------------------------------------------------------------

  function loadHCaptcha() {
    if (window.hcaptcha) {
      return Promise.resolve(window.hcaptcha);
    }

    if (hcaptchaLoadPromise) {
      return hcaptchaLoadPromise;
    }

    hcaptchaLoadPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(
        `script[src="${CONFIG.hcaptchaUrl}"]`
      );

      if (existingScript) {
        const onLoad = () => resolve(window.hcaptcha);
        const onError = () => reject(new Error("Failed to load hCaptcha"));

        existingScript.addEventListener("load", onLoad, { once: true });
        existingScript.addEventListener("error", onError, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = CONFIG.hcaptchaUrl;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        if (!window.hcaptcha) {
          reject(new Error("hCaptcha loaded without exposing its API"));
          return;
        }
        resolve(window.hcaptcha);
      };

      script.onerror = () => reject(new Error("Failed to load hCaptcha"));

      document.head.appendChild(script);
    });

    return hcaptchaLoadPromise;
  }

  // ------------------------------------------------------------
  // Create invisible hCaptcha
  // ------------------------------------------------------------

  async function createWidget() {
    const hcaptcha = await loadHCaptcha();

    const container = document.createElement("div");
    container.style.cssText =
      "position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none";

    document.body.appendChild(container);

    try {
      const widgetId = hcaptcha.render(container, {
        sitekey: CONFIG.siteKey,
        size: "invisible"
      });

      return { hcaptcha, container, widgetId };
    } catch (error) {
      container.remove();
      throw error;
    }
  }

  // ------------------------------------------------------------
  // Execute verification
  // ------------------------------------------------------------

  async function verifyAction(action = "default") {
    if (!canRequest()) {
      throw new Error("Too many verification attempts. Try again shortly.");
    }

    if (verificationCache.has(action)) {
      return verificationCache.get(action);
    }

    const verificationPromise = performVerification(action);
    verificationCache.set(action, verificationPromise);

    try {
      return await verificationPromise;
    } finally {
      verificationCache.delete(action);
    }
  }

  async function performVerification(action) {
    const { hcaptcha, container, widgetId } = await createWidget();

    try {
      const token = await executeWithTimeout(
        hcaptcha,
        widgetId,
        CONFIG.verificationTimeoutMs
      );

      const response = await fetch(CONFIG.verifyEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({ token, action })
      });

      if (!response.ok) {
        throw new Error(`Verification server returned HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data || data.success !== true) {
        throw new Error(data?.error || "hCaptcha verification failed");
      }

      return true;
    } finally {
      try {
        hcaptcha.reset(widgetId);
      } catch {}
      container.remove();
    }
  }

  function executeWithTimeout(hcaptcha, widgetId, timeoutMs) {
    return new Promise((resolve, reject) => {
      let finished = false;

      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        try { hcaptcha.reset(widgetId); } catch {}
        reject(new Error("hCaptcha verification timed out"));
      }, timeoutMs);

      const finish = (callback) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        callback();
      };

      try {
        hcaptcha.execute(widgetId, { async: true }).then(
          token => finish(() => resolve(token)),
          error => finish(() => reject(error instanceof Error ? error : new Error("hCaptcha execution failed")))
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }

  // ------------------------------------------------------------
  // Protected form handling
  // ------------------------------------------------------------

  async function handleFormSubmit(event) {
    const form = event.currentTarget;

    if (form.dataset.hcaptchaVerified === "true" ||
        form.dataset.hcaptchaBusy === "true") {
      return;
    }

    event.preventDefault();
    form.dataset.hcaptchaBusy = "true";

    const submitButtons = form.querySelectorAll(
      'button[type="submit"], input[type="submit"]'
    );

    submitButtons.forEach(button => { button.disabled = true; });

    try {
      const action = form.dataset.hcaptchaAction || form.action || "form-submit";
      await verifyAction(action);

      form.dataset.hcaptchaVerified = "true";

      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.submit();
      }
    } catch (error) {
      console.warn("hCaptcha blocked form submission:", error.message);
      showVerificationError(form, error.message);
    } finally {
      delete form.dataset.hcaptchaBusy;
      submitButtons.forEach(button => { button.disabled = false; });
    }
  }

  // ------------------------------------------------------------
  // Protected button handling
  // ------------------------------------------------------------

  async function handleButtonClick(event) {
    const button = event.currentTarget;

    if (button.dataset.hcaptchaVerified === "true") {
      return;
    }

    const form = button.form;
    if (form?.matches(CONFIG.selector)) {
      return;
    }

    event.preventDefault();

    if (button.dataset.hcaptchaBusy === "true") {
      return;
    }

    button.dataset.hcaptchaBusy = "true";
    button.disabled = true;

    try {
      const action =
        button.dataset.hcaptchaAction ||
        button.dataset.action ||
        button.textContent.trim() ||
        "button-click";

      await verifyAction(action);
      button.dataset.hcaptchaVerified = "true";
      button.click();
    } catch (error) {
      console.warn("hCaptcha blocked button action:", error.message);
      showVerificationError(button, error.message);
    } finally {
      delete button.dataset.hcaptchaBusy;
      if (button.isConnected) {
        button.disabled = false;
      }
    }
  }

  // ------------------------------------------------------------
  // Optional UI error
  // ------------------------------------------------------------

  function showVerificationError(element, message) {
    const form = element.closest("form");
    if (!form) return;

    let errorElement = form.querySelector("[data-hcaptcha-error]");

    if (!errorElement) {
      errorElement = document.createElement("div");
      errorElement.dataset.hcaptchaError = "true";
      errorElement.setAttribute("role", "alert");
      form.prepend(errorElement);
    }

    errorElement.textContent = message || "Verification failed. Please try again.";
  }

  // ------------------------------------------------------------
  // Wrap an individual element
  // ------------------------------------------------------------

  function wrapElement(element) {
    if (element.dataset.hcaptchaWrapped === "true") return;

    element.dataset.hcaptchaWrapped = "true";

    if (element.tagName === "FORM") {
      element.addEventListener("submit", handleFormSubmit);
      return;
    }

    if (element.matches("button, input[type='submit']")) {
      element.addEventListener("click", handleButtonClick);
    }
  }

  // ------------------------------------------------------------
  // Find protected elements
  // ------------------------------------------------------------

  function wrapElements(root = document) {
    if (root.matches?.(CONFIG.selector)) {
      wrapElement(root);
    }
    root.querySelectorAll?.(CONFIG.selector).forEach(wrapElement);
  }

  // ------------------------------------------------------------
  // Observe dynamically-created elements
  // ------------------------------------------------------------

  function startObserver() {
    if (observerStarted) return;

    observerStarted = true;

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          wrapElements(node);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // ------------------------------------------------------------
  // Initialize
  // ------------------------------------------------------------

  function initialize() {
    if (!CONFIG.siteKey || CONFIG.siteKey === "YOUR_HCAPTCHA_SITE_KEY") {
      console.warn("Cloudflare.js: configure HCAPTCHA site key first.");
      return;
    }

    wrapElements();
    startObserver();
    console.log("Cloudflare.js loaded: hCaptcha protection active.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
