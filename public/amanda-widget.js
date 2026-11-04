/**
 * Ask Amanda — the site widget for the static pages.
 *
 * The desk is a React app with its own panel; this file gives the plain HTML pages (the hackathon
 * page, the demo page) the same assistant without dragging the bundle in. It posts to the same
 * endpoint, keeps the last eight turns, and says plainly when the desk cannot be reached.
 *
 * Text, voice, a photograph or a video: a judge on a phone can speak a question, photograph a
 * carton or a document, or send a short clip — which is read as a single frame and the reply says
 * so, because claiming to have watched a film would be a lie the desk has to undo later.
 *
 * Loaded with:  <script src="/amanda-widget.js" defer></script>
 */
(function () {
  if (window.__amandaWidget) return;
  window.__amandaWidget = true;

  var NAVY = "#0a1f3c", GOLD = "#c9a227", GOLD_LIGHT = "#f5e7bd";
  var history = [];
  var busy = false;
  var open = false;

  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) Object.keys(style).forEach(function (k) { n.style[k] = style[k]; });
    if (text != null) n.textContent = text;
    return n;
  }

  var launcher = el("button", {
    position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483000,
    display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px",
    minHeight: "48px", borderRadius: "999px", border: "2px solid " + GOLD,
    background: NAVY, color: "#fff", cursor: "pointer",
    boxShadow: "0 6px 24px rgba(10,31,60,.28)", font: "600 14px system-ui, sans-serif"
  });
  launcher.setAttribute("aria-label", "Ask Amanda");
  launcher.appendChild(el("span", { fontWeight: "700" }, "Ask Amanda"));
  launcher.appendChild(el("span", {
    fontSize: "11px", color: GOLD_LIGHT, borderLeft: "1px solid " + GOLD, paddingLeft: "10px"
  }, "Powered by Meta"));

  var panel = el("section", {
    position: "fixed", right: "12px", bottom: "12px", zIndex: 2147483000,
    width: "min(400px, calc(100vw - 24px))", maxHeight: "min(620px, calc(100vh - 24px))",
    display: "none", flexDirection: "column", background: "#fff", borderRadius: "14px",
    border: "2px solid " + GOLD, boxShadow: "0 18px 48px rgba(10,31,60,.34)", overflow: "hidden",
    font: "14px system-ui, sans-serif"
  });
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Ask Amanda");

  var head = el("header", {
    background: NAVY, color: "#fff", padding: "12px 14px", display: "flex",
    alignItems: "center", justifyContent: "space-between", gap: "8px"
  });
  var titles = el("div");
  titles.appendChild(el("div", { fontWeight: "700" }, "Ask Amanda"));
  titles.appendChild(el("div", { fontSize: "11px", color: GOLD_LIGHT }, "Powered by Meta · Altovex Global Logistics"));
  var closeBtn = el("button", {
    background: "transparent", color: "#fff", border: "1px solid " + GOLD,
    borderRadius: "8px", minWidth: "36px", minHeight: "36px", cursor: "pointer"
  }, "✕");
  closeBtn.setAttribute("aria-label", "Close Ask Amanda");
  head.appendChild(titles);
  head.appendChild(closeBtn);

  var body = el("div", { padding: "12px", overflowY: "auto", flex: "1", background: "#f7f9fc", minHeight: "180px" });
  var intro = el("p", { fontSize: "13px", color: "#33465e", margin: "0 0 8px" },
    "Sourcing, ocean freight, clearing, warehousing and last mile — DDP. Ask about a lane, a price, a document or a load. You can also speak, or send a photo of the cargo.");
  body.appendChild(intro);

  var noteBar = el("div", {
    display: "none", fontSize: "12px", color: "#7a5a00", background: GOLD_LIGHT,
    borderRadius: "8px", padding: "6px 8px", marginTop: "6px"
  });

  var tools = el("div", { display: "flex", gap: "6px", padding: "8px 10px 0" });
  var mic = el("button", {
    fontSize: "12px", padding: "7px 10px", borderRadius: "8px", border: "1px solid #c3cfdd",
    background: "#eef3f9", color: NAVY, cursor: "pointer", minHeight: "34px"
  }, "🎤 Voice");
  mic.setAttribute("type", "button");
  mic.setAttribute("aria-label", "Speak to Amanda");
  var photoBtn = el("button", {
    fontSize: "12px", padding: "7px 10px", borderRadius: "8px", border: "1px solid #c3cfdd",
    background: "#eef3f9", color: NAVY, cursor: "pointer", minHeight: "34px"
  }, "📷 Photo");
  photoBtn.setAttribute("type", "button");
  photoBtn.setAttribute("aria-label", "Send a photograph");
  var videoBtn = el("button", {
    fontSize: "12px", padding: "7px 10px", borderRadius: "8px", border: "1px solid #c3cfdd",
    background: "#eef3f9", color: NAVY, cursor: "pointer", minHeight: "34px"
  }, "🎥 Video — by appointment");
  videoBtn.setAttribute("type", "button");
  videoBtn.setAttribute("aria-label", "Video call with the desk");

  var photoInput = el("input", { display: "none" });
  photoInput.type = "file";
  photoInput.accept = "image/*";
  var videoInput = el("input", { display: "none" });
  videoInput.type = "file";
  videoInput.accept = "video/*";

  tools.appendChild(mic);
  tools.appendChild(photoBtn);
  tools.appendChild(videoBtn);
  tools.appendChild(photoInput);
  tools.appendChild(videoInput);

  var form = el("form", { display: "flex", gap: "8px", padding: "10px", borderTop: "1px solid #dbe4ef" });
  var input = el("input", {
    flex: "1", minWidth: "0", padding: "10px 12px", borderRadius: "8px",
    border: "1px solid #c3cfdd", fontSize: "14px"
  });
  input.setAttribute("aria-label", "Your question for Amanda");
  input.placeholder = "Ask about a shipment, a price, a document…";
  var send = el("button", {
    padding: "10px 16px", minHeight: "44px", borderRadius: "8px", border: "none",
    background: GOLD, color: NAVY, fontWeight: "700", cursor: "pointer"
  }, "Send");
  send.setAttribute("type", "submit");
  form.appendChild(input);
  form.appendChild(send);

  var foot = el("div", { fontSize: "10.5px", color: "#6b7c91", padding: "0 12px 10px" },
    "Indicative answers. Prices and bookings are confirmed by the desk in writing. A video is read as a single frame.");

  panel.appendChild(head);
  panel.appendChild(body);
  panel.appendChild(tools);
  panel.appendChild(form);
  panel.appendChild(foot);
  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  body.appendChild(noteBar);

  function note(text) {
    noteBar.textContent = text || "";
    noteBar.style.display = text ? "block" : "none";
  }

  function bubble(role, text) {
    var row = el("div", { display: "flex", justifyContent: role === "user" ? "flex-end" : "flex-start", margin: "8px 0" });
    var b = el("div", {
      maxWidth: "86%", padding: "9px 11px", borderRadius: "10px", fontSize: "13.5px",
      lineHeight: "1.45", whiteSpace: "pre-wrap",
      background: role === "user" ? NAVY : "#fff", color: role === "user" ? "#fff" : NAVY,
      border: role === "user" ? "none" : "1px solid #dbe4ef"
    }, text);
    row.appendChild(b);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
    return b;
  }

  /* ---------------------------------------------------------------- media helpers */

  function toWav16k(blob) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    return blob.arrayBuffer().then(function (buf) {
      return new Ctx().decodeAudioData(buf);
    }).then(function (decoded) {
      var rate = 16000;
      var frames = Math.max(1, Math.ceil(decoded.duration * rate));
      var off = new OfflineAudioContext(1, frames, rate);
      var src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      return off.startRendering();
    }).then(function (rendered) {
      var pcm = rendered.getChannelData(0);
      var view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
      function put(at, str) { for (var i = 0; i < str.length; i += 1) view.setUint8(at + i, str.charCodeAt(i)); }
      put(0, "RIFF");
      view.setUint32(4, 36 + pcm.length * 2, true);
      put(8, "WAVEfmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      put(36, "data");
      view.setUint32(40, pcm.length * 2, true);
      var at = 44;
      for (var i = 0; i < pcm.length; i += 1, at += 2) {
        var v = Math.max(-1, Math.min(1, pcm[i]));
        view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      }
      return new Blob([view.buffer], { type: "audio/wav" });
    });
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function shrink(file, max) {
    max = max || 1024;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function firstFrame(file) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      var url = URL.createObjectURL(file);
      v.onloadeddata = function () { v.currentTime = Math.min(0.6, (v.duration || 1) / 2); };
      v.onseeked = function () {
        var c = document.createElement("canvas");
        var scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      v.onerror = reject;
      v.src = url;
    });
  }

  function post(payload) {
    return fetch("/api/amanda/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
  }

  /* ---------------------------------------------------------------- one turn */

  function ask(question, media) {
    if (busy) return;
    if (!question && !(media && (media.audio || media.image))) return;
    busy = true;
    send.disabled = true;
    send.textContent = "…";
    note("");
    bubble("user", question || (media && media.audio ? "Voice note" : "Photograph"));
    var thinking = el("div", { fontSize: "12.5px", color: "#5a6b80", padding: "4px 2px" },
      media && media.audio ? "Listening…" : media && media.image ? "Looking at it…" : "Amanda is checking the desk…");
    body.appendChild(thinking);
    body.scrollTop = body.scrollHeight;

    var turns = history.slice(-8).concat([{ role: "user", content: question || "Voice note" }]);
    post({
      messages: turns,
      audio: media && media.audio ? media.audio : undefined,
      image: media && media.image ? media.image : undefined,
      context: { page: location.pathname }
    })
      .then(function (out) {
        thinking.remove();
        if (!out.ok) {
          bubble("assistant", (out.d && out.d.error) || "The desk could not answer just now.");
          return;
        }
        if (out.d.transcript) {
          history.push({ role: "user", content: out.d.transcript });
          bubble("user", "“" + out.d.transcript + "”");
        } else {
          history.push({ role: "user", content: question });
        }
        history.push({ role: "assistant", content: out.d.reply });
        bubble("assistant", out.d.reply);
        if (out.d.degraded) note("Computed figures only — the model is briefly offline.");
      })
      .catch(function () {
        thinking.remove();
        bubble("assistant", "I could not reach the desk just now. The desk is on +254 718 554 383 and altovexgl@gmail.com.");
      })
      .then(function () {
        busy = false;
        send.disabled = false;
        send.textContent = "Send";
      });
  }

  launcher.addEventListener("click", function () {
    open = true;
    launcher.style.display = "none";
    panel.style.display = "flex";
    input.focus();
  });
  closeBtn.addEventListener("click", function () {
    open = false;
    panel.style.display = "none";
    launcher.style.display = "flex";
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    input.value = "";
    ask(q);
  });

  /* ---------------------------------------------------------------- voice */

  var recorder = null;
  var chunks = [];

  mic.addEventListener("click", function () {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      note("This browser will not let the page use the microphone. Type instead, or call the desk.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        mic.textContent = "🎤 Voice";
        note("Listening…");
        toWav16k(new Blob(chunks, { type: (chunks[0] && chunks[0].type) || "audio/webm" }))
          .then(toBase64)
          .then(function (dataUrl) { note(""); ask("", { audio: dataUrl }); })
          .catch(function () { note("That recording could not be used."); });
      };
      recorder.start();
      mic.textContent = "◼ Stop";
      note("Recording — press Stop when you have finished.");
    }).catch(function () {
      note("The microphone is not available on this device.");
    });
  });

  /* ---------------------------------------------------------------- photo and video */

  photoBtn.addEventListener("click", function () { photoInput.click(); });
  videoBtn.addEventListener("click", function () {
    note("Live video is by authentication — the CTO joins by appointment. Call the desk on +254 718 554 383 to book it.");
  });

  photoInput.addEventListener("change", function () {
    var file = photoInput.files && photoInput.files[0];
    photoInput.value = "";
    if (!file) return;
    shrink(file).then(function (image) {
      ask("Photograph" + (file.name ? ": " + file.name : ""), { image: image });
    }).catch(function () { note("That picture could not be read."); });
  });

  videoInput.addEventListener("change", function () {
    var file = videoInput.files && videoInput.files[0];
    videoInput.value = "";
    if (!file) return;
    firstFrame(file).then(function (image) {
      ask("A frame from " + (file.name || "a video"), { image: image });
    }).catch(function () { note("That video could not be read."); });
  });

  window.amandaAsk = ask;
})();
