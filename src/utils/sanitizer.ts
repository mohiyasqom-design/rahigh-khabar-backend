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
]

const allowedAttributes: Record<string, string[]> = {
  img: ["src", "alt"],
  a: ["href", "title", "rel", "target"],
  iframe: ["src", "width", "height", "frameborder", "allow", "allowfullscreen"],
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
    allowedSchemesAppliedToAttributes: ["href", "src"],
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
        const href = attribs.href ?? ""
        if (!href) return { tagName: "span", attribs: {} }
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
