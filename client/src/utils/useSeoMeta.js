import { useEffect } from 'react';

function setMetaByName(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

function setMetaByProperty(property, content) {
  let el = document.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.content = content;
}

export function useSeoMeta({ title, description, image } = {}) {
  useEffect(() => {
    if (title) {
      document.title = title;
      setMetaByProperty('og:title', title);
    }
    if (description) {
      setMetaByName('description', description);
      setMetaByProperty('og:description', description);
    }
    if (image) {
      setMetaByProperty('og:image', image);
    }
    setMetaByProperty('og:url', window.location.href);
    setMetaByProperty('og:type', 'website');
  }, [title, description, image]);
}
