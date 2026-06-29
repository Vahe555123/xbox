/**
 * Extracts the human-readable description from a Digiseller product `data` XML
 * response (used by the Ubisoft+ and Game Pass pages).
 *
 * Digiseller packs the description into:
 *   <info>      — delivery terms + warnings (nested <delivery>/<attention> tags)
 *   <add_info>  — the main body (e.g. the list of games included)
 *   <preview_imgs><preview_img><img_real> — product images
 *
 * We strip the inner markup down to clean text paragraphs so the frontend can
 * render the full product information.
 */

function decodeEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Inner of the FIRST <tag>…</tag> as clean text paragraphs (block tags and <br>
// become paragraph breaks; everything else is stripped).
function tagToParagraphs(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = String(xml || '').match(re);
  if (!m) return [];
  let text = m[1];
  // Unwrap any CDATA sections (Digiseller wraps the HTML body in CDATA).
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  text = text.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  text = text.replace(/<\/(?:p|div|delivery|attention|li|h[1-6]|tr)\s*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);
  return text
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

function extractImages(xml) {
  const urls = [];
  const re = /<img_real[^>]*>([\s\S]*?)<\/img_real>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const url = decodeEntities(m[1].trim());
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function extractDescription(xml) {
  return {
    info: tagToParagraphs(xml, 'info'),
    addInfo: tagToParagraphs(xml, 'add_info'),
    images: extractImages(xml),
  };
}

module.exports = { extractDescription };
