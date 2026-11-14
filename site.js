'use strict';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
for (const details of document.querySelectorAll('.faq-item')) {
  const summary = details.querySelector('summary');
  const body = details.querySelector('.faq-body');
  if (!summary || !body) continue;
  let expanded = details.open, animation, contentAnimation;
  summary.setAttribute('aria-expanded', String(expanded));
  summary.addEventListener('click', event => {
    event.preventDefault();
    const start = details.getBoundingClientRect().height;
    expanded = !expanded;
    animation?.cancel(); contentAnimation?.cancel();
    summary.setAttribute('aria-expanded', String(expanded));
    if (reduceMotion.matches || !details.animate) {
      details.open = expanded; details.style.height = ''; return;
    }
    details.style.height = `${start}px`;
    if (expanded) details.open = true;
    const style = getComputedStyle(details);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const end = summary.getBoundingClientRect().height + (expanded ? body.getBoundingClientRect().height : 0) + border;
    animation = details.animate({height:[`${start}px`,`${end}px`]}, {duration:280,easing:'cubic-bezier(.2,.75,.2,1)'});
    contentAnimation = body.animate({opacity:expanded?[0,1]:[1,0]}, {duration:220,easing:'ease-out'});
    animation.onfinish = () => {details.open=expanded;details.style.height='';animation=null;};
  });
}

const tabs = [...document.querySelectorAll('.playbook-tab')];
function activate(tab) {
  for (const button of tabs) {
    const active = button === tab;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
    button.tabIndex = active?0:-1;
  }
  for (const panel of document.querySelectorAll('.playbook-panel')) panel.classList.toggle('active',panel.id === tab.dataset.tab);
}
for (const tab of tabs) {
  tab.id ||= `control-${tab.dataset.tab}`;
  tab.setAttribute('aria-controls',tab.dataset.tab);
  tab.tabIndex = tab.classList.contains('active')?0:-1;
  document.getElementById(tab.dataset.tab)?.setAttribute('aria-labelledby',tab.id);
  tab.addEventListener('click',()=>activate(tab));
  tab.addEventListener('keydown',event=>{
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(tab);
    const next = event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    activate(tabs[next]); tabs[next].focus();
  });
}

async function copyText(button,target) {
  const label = button.querySelector('span');
  const original = label?.textContent || button.textContent;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(target.textContent.trim());
    button.classList.add('copied');
    if (label) label.textContent = 'Copied!'; else button.textContent = 'Copied!';
  } catch {
    const range=document.createRange(); range.selectNodeContents(target);
    getSelection()?.removeAllRanges();getSelection()?.addRange(range);
    if (label) label.textContent='Text selected — copy it'; else button.textContent='Text selected — copy it';
  }
  clearTimeout(button.copyTimer);
  button.copyTimer=setTimeout(()=>{button.classList.remove('copied');if(label)label.textContent=original;else button.textContent=original;},2500);
}
for (const button of document.querySelectorAll('[data-copy-prompt]')) button.addEventListener('click',()=>copyText(button,button.closest('.playbook-panel').querySelector('.prompt-text')));
for (const button of document.querySelectorAll('[data-copy]')) button.addEventListener('click',()=>copyText(button,document.getElementById(button.dataset.copy)));

// Keep document navigation aligned with the section below the sticky header.
const contentsLinks = [...document.querySelectorAll('.doc-toc a[href^="#"]')];
const contentsSections = contentsLinks.map(link => document.getElementById(link.hash.slice(1)));
if (contentsLinks.length) {
  let scrollQueued = false;
  function updateContents() {
    const offset = (document.querySelector('.topbar')?.getBoundingClientRect().height || 0) + 48;
    let active = 0;
    contentsSections.forEach((section, index) => {
      if (section && section.getBoundingClientRect().top <= offset) active = index;
    });
    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) active = contentsLinks.length - 1;
    contentsLinks.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    scrollQueued = false;
  }
  function queueContents() {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updateContents); }
  }
  addEventListener('scroll', queueContents, {passive:true});
  addEventListener('resize', queueContents);
  addEventListener('load', queueContents);
  updateContents();
}

// The phone menu is an in-flow disclosure; desktop navigation stays visible.
document.documentElement.classList.add('js');
const menuButton = document.querySelector('.menu-toggle');
const siteHeader = document.querySelector('.topbar');
const phoneLayout = matchMedia('(max-width: 768px)');
function closeMenu() {
  siteHeader?.classList.remove('menu-open');
  menuButton?.setAttribute('aria-expanded', 'false');
  const label = menuButton?.querySelector('.menu-toggle-label');
  if (label) label.textContent = 'Menu';
}
menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  siteHeader.classList.toggle('menu-open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.querySelector('.menu-toggle-label').textContent = open ? 'Close' : 'Menu';
});
document.querySelectorAll('.links a').forEach(link => link.addEventListener('click', closeMenu));
addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    closeMenu(); menuButton.focus();
  }
});
addEventListener('click', event => { if (!siteHeader?.contains(event.target)) closeMenu(); });
const documentContents = document.querySelector('.doc-contents');
const contentsSummary = documentContents?.querySelector('summary');
contentsSummary?.addEventListener('click', event => { if (!phoneLayout.matches) event.preventDefault(); });
function adaptNavigation() {
  closeMenu();
  if (documentContents) documentContents.open = !phoneLayout.matches;
  if (contentsSummary) contentsSummary.tabIndex = phoneLayout.matches ? 0 : -1;
}
phoneLayout.addEventListener('change', adaptNavigation);
adaptNavigation();
