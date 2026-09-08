// Runs inside each billboard page.
//
// Once the viewer clicks into the iframe, keyboard focus lives in this
// document and the parent window stops receiving key events — so Escape
// has to be relayed back out by hand. These pages are same-origin, so the
// message can be addressed to our own origin rather than "*".
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  window.parent.postMessage(
    { type: "billboard:exit" },
    window.location.origin
  );
});
