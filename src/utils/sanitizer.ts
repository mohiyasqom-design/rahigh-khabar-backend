import sanitizeHtml, { type Attributes } from "sanitize-html"

const allowedTags = [
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "img",
  "iframe",
  "a",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  // Group 1: Tiptap's TextStyle mark (font family / font size) renders as a
  // <span style="...">. Only the two style properties below survive.
  "span",
]

const allowedAttributes: Record<string, string[]> = {
  img: ["src", "alt"],
  a: ["href", "title", "rel", "target"],
  span: ["style"],
  iframe: ["src", "width", "height", "frameborder", "allow", "allowfullscreen"],
}

/**
 * Group 1 — the ONLY inline styles an article body may carry.
 *
 * ALLOW-LIST, NOT BLOCK-LIST: sanitize-html parses the style attribute and
 * keeps a declaration only when its property is listed here AND its value
 * matches one of the anchored patterns. Everything else (url(), expression(),
 * position, background, @import, arbitrary colours...) is dropped, so the
 * attribute cannot be used for CSS injection or overlay/clickjacking tricks.
 *
 * VALUES MIRROR THE EDITOR TOOLBAR exactly (components/admin/editor-fonts.ts in
 * the frontend): three font tokens and seven pixel sizes. The font value is a
 * CSS custom property rather than a family name because the site's webfonts
 * are self-hosted under generated names; the variable is defined once in
 * globals.css and resolves to the right face on every page.
 */
export const EDITOR_FONT_FAMILY_VALUES = ["var(--font-vazirmatn)", "var(--font-shabnam)", "var(--font-peyda)"] as const
export const EDITOR_FONT_SIZE_VALUES = [14, 16, 18, 20, 24, 28, 32] as const

const allowedStyles = {
  span: {
    "font-family": [/^var\(--font-(?:vazirmatn|shabnam|peyda)\)$/],
    "font-size": [new RegExp(`^(?:${EDITOR_FONT_SIZE_VALUES.join("|")})px$`)],
  },
}

// Links may point to http(s) pages or open a mail client. Nothing else:
// javascript:, data:, vbscript:, file:, relative and protocol-relative URLs
// are all rejected (the <a> is unwrapped to plain text).
const allowedLinkProtocols = new Set(["http:", "https:", "mailto:"])

export function isAllowedLinkHref(href: string): boolean {
  const value = href.trim()
  // Absolute URLs only: this also rules out "//evil.example" and "/path".
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  try {
    return allowedLinkProtocols.has(new URL(value).protocol)
  } catch {
    return false
  }
}

const allowedEmbedHosts = [
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "aparat.com",
]

// Anchored comparison. `hostname.includes("youtube.com")` would also accept
// `youtube.com.evil.example`, which is a full embed-injection bypass.
function isAllowedHost(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase()
  const base = domain.toLowerCase()
  return host === base || host.endsWith(`.${base}`)
}

export function isAllowedEmbed(src: string): boolean {
  try {
    const url = new URL(src)
    if (url.protocol !== "https:") return false
    return allowedEmbedHosts.some((domain) => isAllowedHost(url.hostname, domain))
  } catch {
    return false
  }
}

// `startsWith("http")` also matched the literal string "httpfoo" and allowed
// plain http:, which breaks the page over HTTPS. Parse and require https.
export function isAllowedImage(src: string): boolean {
  try {
    return new URL(src).protocol === "https:"
  } catch {
    return false
  }
}

export function sanitizeNewsBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes,
    // javascript:, data: and vbscript: URLs can never survive this list.
    allowedSchemes: ["https", "mailto"],
    // Group 1: links (and only links) may also use plain http.
    allowedSchemesByTag: { a: ["http", "https", "mailto"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    allowedStyles,
    disallowedTagsMode: "discard",
    transformTags: {
      img: (tagName: string, attribs: Attributes) => {
        const src = attribs.src ?? ""
        if (!isAllowedImage(src)) return { tagName: "", attribs: {} }
        return {
          tagName,
          attribs: { src, alt: attribs.alt ?? "" },
        }
      },
      iframe: (tagName: string, attribs: Attributes) => {
        const src = attribs.src ?? ""
        if (!isAllowedEmbed(src)) return { tagName: "", attribs: {} }
        return {
          tagName,
          attribs: {
            src,
            width: "100%",
            height: "400",
            frameborder: "0",
            allow:
              "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
            allowfullscreen: "true",
          },
        }
      },
      a: (tagName: string, attribs: Attributes) => {
        const href = (attribs.href ?? "").trim()
        if (!href || !isAllowedLinkHref(href)) return { tagName: "span", attribs: {} }
        return {
          tagName,
          attribs: {
            href,
            ...(attribs.title === undefined ? {} : { title: attribs.title }),
            // Reverse tabnabbing + SEO hygiene for editor-supplied links.
            rel: "noopener noreferrer nofollow",
            target: "_blank",
          },
        }
      },
    },
  })
}

const basicEntities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
}

// Comments are stored and rendered as plain text. sanitize-html escapes the
// leftovers, so we decode them back once; otherwise a comment reading
// "5 < 6 & 7 > 6" would be persisted as "5 &lt; 6 &amp; 7 &gt; 6".
export function decodeBasicEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|#x27);/gi, (match) => basicEntities[match.toLowerCase()] ?? match)
}

export function sanitizeCommentContent(value: string): string {
  const stripped = sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  })
  return decodeBasicEntities(stripped)
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
