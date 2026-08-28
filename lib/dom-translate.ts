import { DICT } from "./dictionary";

/*
  Whole-page translation engine. Instead of wrapping every string with t(),
  this walks the live DOM and swaps any text node whose (trimmed) English text
  matches a dictionary key. A MutationObserver keeps translating content React
  renders later, so the entire site — every page, every component — switches to
  Chinese from one dictionary. Only exact English dictionary keys are touched,
  so numbers, addresses, symbols and already-translated text are left alone
  (idempotent + safe).
*/
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "CODE", "PRE", "SVG"]);

const orig = new WeakMap<Text, string>();
let translated = new Set<Text>();
let observer: MutationObserver | null = null;

function skip(el: Element | null): boolean {
  let node: Element | null = el;
  while (node) {
    if (SKIP_TAGS.has(node.tagName)) return true;
    if (node.hasAttribute?.("data-no-translate")) return true;
    node = node.parentElement;
  }
  return false;
}

function translateNode(node: Text) {
  const raw = orig.get(node) ?? node.nodeValue ?? "";
  const trimmed = raw.trim();
  if (!trimmed) return;
  const zh = DICT[trimmed];
  if (!zh) return;
  const target = raw.replace(trimmed, zh);
  if (node.nodeValue === target) return; // already translated — avoid loops
  if (skip(node.parentElement)) return;
  if (!orig.has(node)) orig.set(node, raw);
  node.nodeValue = target;
  translated.add(node);
}

function walk(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n.nodeValue ?? "").trim() && !skip((n as Text).parentElement)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  const nodes: Text[] = [];
  let cur: Node | null;
  while ((cur = walker.nextNode())) nodes.push(cur as Text);
  nodes.forEach(translateNode);
}

export function applyTranslation() {
  if (typeof document === "undefined") return;
  walk(document.body);
  if (!observer) {
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData" && m.target.nodeType === Node.TEXT_NODE) {
          translateNode(m.target as Text);
        }
        m.addedNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) translateNode(n as Text);
          else if (n.nodeType === Node.ELEMENT_NODE) walk(n);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
}

export function revertTranslation() {
  observer?.disconnect();
  observer = null;
  translated.forEach((node) => {
    const o = orig.get(node);
    if (o != null) node.nodeValue = o;
  });
  translated = new Set();
}
