#!/usr/bin/env node
/**
 * build.js
 * content/articles/*.md を読み込み、docs/ 以下に静的HTMLを生成する。
 *
 * 使い方:
 *   npm run build
 *
 * 記事の追加方法は README.md を参照。
 */
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { marked } = require("marked");

const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, "content", "articles");
const TEMPLATE_DIR = path.join(ROOT, "templates");
const ASSETS_DIR = path.join(ROOT, "assets");
const OUT_DIR = path.join(ROOT, "docs");

marked.setOptions({ gfm: true, breaks: false });

// ---------- ユーティリティ ----------
function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
}
function fill(tpl, map) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : ""
  );
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function fmtDate(d) {
  const dt = typeof d === "string" ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function escapeXml(s) {
  return String(s || "").replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  }[c]));
}
function escapeHtmlAttr(s) {
  return String(s || "").replace(/"/g, "&quot;");
}

// ---------- 1. サイト設定・記事読み込み ----------
const site = readJSON(path.join(ROOT, "content", "site.json"));
const catByName = new Map(site.categories.map((c) => [c.name, c.slug]));

// BASE: リポジトリ配下(例 /review-site)で公開する場合のプレフィックス。独自ドメインのルートで公開するなら "" のまま。
const BASE = (site.basePath || "").replace(/\/$/, "");
// SITE_ROOT: sitemap/canonical/OGPに使う完全なURLの土台 (baseUrl + BASE、末尾スラッシュなし)
const SITE_ROOT = site.baseUrl.replace(/\/$/, "") + BASE;

if (!fs.existsSync(CONTENT_DIR)) {
  console.error(`content/articles ディレクトリが見つかりません: ${CONTENT_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
if (files.length === 0) {
  console.warn("記事(.md)が1つも見つかりません。content/articles/ に追加してください。");
}

// h3見出しのテキストが products[].name と完全一致したら、直後に購入ボタンを挿入する
// h3見出しのテキストが products[].name と完全一致したら、直後に「写真+購入ボタン」カードを挿入する
function injectProductCards(html, products) {
  if (!Array.isArray(products) || products.length === 0) return html;
  let out = html;
  for (const p of products) {
    if (!p.name || !p.url) continue;
    const heading = `<h3>${p.name}</h3>`;
    if (!out.includes(heading)) {
      console.warn(`  ⚠ 見出し "${p.name}" が本文に見つからず、購入カードを挿入できませんでした（本文の### 見出しと1文字違わず一致させてください）`);
      continue;
    }
    const photo = p.image
      ? `<a class="buy-photo" href="${escapeHtmlAttr(p.url)}" target="_blank" rel="nofollow sponsored noopener"><img src="${escapeHtmlAttr(p.image)}" alt="${escapeHtmlAttr(p.name)}" loading="lazy" width="96" height="96"></a>`
      : "";
    const card = `<div class="buy-card">${photo}<a class="buy-btn" href="${escapeHtmlAttr(p.url)}" target="_blank" rel="nofollow sponsored noopener">楽天市場で見る</a></div>`;
    out = out.replace(heading, heading + card);
  }
  return out;
}

// 本文・比較表のどこにでも書ける短縮リンク記法: {{buy:商品名}} → 小さな「見る→」リンクに変換
// (products の name と一致するものを探す。表のセル内でも使えるよう、Markdown解析前の生テキストに対して行う)
function resolveInlineShortcodes(content, products) {
  const byName = new Map((products || []).filter((p) => p.name && p.url).map((p) => [p.name, p]));
  return content.replace(/\{\{buy:([^}]+)\}\}/g, (match, rawName) => {
    const name = rawName.trim();
    const p = byName.get(name);
    if (!p) {
      console.warn(`  ⚠ {{buy:${name}}} に対応する products が見つかりません（products の name と1文字違わず一致させてください）`);
      return "";
    }
    const thumb = p.image
      ? `<img class="buy-inline__thumb" src="${escapeHtmlAttr(p.image)}" alt="" loading="lazy">`
      : "";
    return `<a class="buy-inline" href="${escapeHtmlAttr(p.url)}" target="_blank" rel="nofollow sponsored noopener">${thumb}見る→</a>`;
  });
}

// 楽天のリンク作成画面で「画像とテキスト」等をコピーした生コードから、
// 商品URL・画像URLを自動で抜き出す（productsに raw: を書いた場合のみ使う）
function normalizeProducts(products, filename) {
  if (!Array.isArray(products)) return products;
  return products.map((p, i) => {
    if (!p.raw) return p;
    const hrefMatch = p.raw.match(/<a\s+href="([^"]+)"/);
    const imgMatch = p.raw.match(/<img\s+src="([^"]+)"/);
    if (!p.url && !hrefMatch) {
      throw new Error(`[${filename}] products[${i}] "${p.name || "(名前なし)"}" の raw からURLを見つけられませんでした。url を直接指定してください。`);
    }
    return {
      name: p.name,
      url: p.url || hrefMatch[1],
      image: p.image || (imgMatch ? imgMatch[1] : ""),
    };
  });
}

// 「良い点：〜 気になる点：〜 向いている人：〜」の1段落を、色分けされた3枚のカードに変換する
function styleReviewPoints(html) {
  return html.replace(
    /<p>良い点[:：]([\s\S]*?)\n気になる点[:：]([\s\S]*?)\n向いている人[:：]([\s\S]*?)<\/p>/g,
    (m, good, bad, fit) => `<div class="review-points">
<div class="review-point review-point--good"><span class="review-point__label">良い点</span><p>${good.trim()}</p></div>
<div class="review-point review-point--bad"><span class="review-point__label">気になる点</span><p>${bad.trim()}</p></div>
<div class="review-point review-point--fit"><span class="review-point__label">向いている人</span><p>${fit.trim()}</p></div>
</div>`
  );
}

// 「**1. タイトル** 本文」の段落を、番号つきの目立つカードに変換する
function styleCriteriaCards(html) {
  return html.replace(
    /<p><strong>(\d+)\.\s*([^<]+)<\/strong>\n([\s\S]*?)<\/p>/g,
    (m, num, title, body) => `<div class="criteria-card">
<span class="criteria-card__num">${num}</span>
<div><span class="criteria-card__title">${title.trim()}</span><p>${body.trim()}</p></div>
</div>`
  );
}

// カテゴリーごとのオリジナルアイコン(著作権フリー、自作SVG)
const CATEGORY_ICONS = {
  "baby-care": '<rect x="9" y="8" width="6" height="13" rx="2"/><rect x="10" y="4" width="4" height="4" rx="1"/><rect x="10.5" y="2" width="3" height="2.5" rx="0.5"/>',
  "kitchen-food": '<path d="M6 4h12l-1.5 14a2 2 0 0 1-2 1.8h-5a2 2 0 0 1-2-1.8L6 4z"/>',
  "cleaning": '<path d="M12 2s7 8 7 12.5a7 7 0 1 1-14 0C5 10 12 2 12 2z"/>',
  "haircare-skincare": '<path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z"/>',
  "pet": '<circle cx="12" cy="16" r="4"/><circle cx="5.5" cy="9" r="2"/><circle cx="9.5" cy="4.5" r="2"/><circle cx="14.5" cy="4.5" r="2"/><circle cx="18.5" cy="9" r="2"/>',
  "health": '<path d="M11 4h2v6h6v2h-6v6h-2v-6H5v-2h6V4z"/>',
};
function categoryIcon(slug) {
  const inner = CATEGORY_ICONS[slug];
  return inner ? `<svg class="tag-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>` : "";
}

// カテゴリーの差し色をそのページのCSS変数として注入するstyle属性を作る
function bodyStyleFor(categorySlug) {
  const cat = site.categories.find((c) => c.slug === categorySlug);
  if (!cat || !cat.color) return "";
  const { accent, accentDeep, accentSoft } = cat.color;
  return ` style="--accent:${accent};--accent-deep:${accentDeep};--accent-soft:${accentSoft};"`;
}

const articles = files.map((filename) => {
  const raw = fs.readFileSync(path.join(CONTENT_DIR, filename), "utf8");
  const { data, content } = matter(raw);
  const products = normalizeProducts(data.products, filename);

  const required = ["title", "description", "category", "date"];
  for (const key of required) {
    if (!data[key]) {
      throw new Error(`[${filename}] frontmatterに "${key}" がありません。`);
    }
  }
  if (!catByName.has(data.category)) {
    throw new Error(
      `[${filename}] category "${data.category}" は content/site.json の categories に未登録です。先にsite.jsonへ追加してください。`
    );
  }

  const slug = (data.slug || filename.replace(/\.md$/, ""))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return {
    filename,
    slug,
    title: data.title,
    description: data.description,
    keywords: Array.isArray(data.keywords) ? data.keywords.join(", ") : (data.keywords || ""),
    category: data.category,
    categorySlug: catByName.get(data.category),
    date: fmtDate(data.date),
    updated: fmtDate(data.updated || data.date),
    author: data.author || site.author,
    ogImage: data.ogImage || data.heroImage || "",
    heroImage: data.heroImage || "",
    heroImageAlt: data.heroImageAlt || data.title,
    html: styleCriteriaCards(styleReviewPoints(injectProductCards(marked.parse(resolveInlineShortcodes(content, products)), products))),
  };
});

// 公開順(古い→新しい)で検証ノート番号を採番
const byDateAsc = [...articles].sort((a, b) => (a.date < b.date ? -1 : 1));
byDateAsc.forEach((a, i) => { a.logNumber = String(i + 1).padStart(3, "0"); });

// 表示は新しい順
const byDateDesc = [...articles].sort((a, b) => (a.date > b.date ? -1 : 1));

// ---------- 2. 共通パーツ ----------
const activeCategories = site.categories.filter((c) =>
  articles.some((a) => a.categorySlug === c.slug)
);
const navLinks = activeCategories
  .map((c) => `<a href="${BASE}/category/${c.slug}/">${c.name}</a>`)
  .join("\n    ");

function ogImageTag(a) {
  return a.ogImage ? `<meta property="og:image" content="${escapeHtmlAttr(a.ogImage)}">` : "";
}

const gscTag = site.googleSiteVerification
  ? `<meta name="google-site-verification" content="${escapeHtmlAttr(site.googleSiteVerification)}">`
  : "";

function jsonLdForArticle(a) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    datePublished: a.date,
    dateModified: a.updated,
    author: { "@type": "Organization", name: a.author },
    publisher: { "@type": "Organization", name: site.siteName },
    mainEntityOfPage: `${SITE_ROOT}/articles/${a.slug}/`,
  });
}

function categoryColorFor(slug) {
  const cat = site.categories.find((c) => c.slug === slug);
  return (cat && cat.color) || { accent: "#0F6B5C", accentDeep: "#0B4E43", accentSoft: "#DCEAE6" };
}

function cardHtml(a) {
  const thumb = a.heroImage
    ? `<div class="article-card__thumb"><img src="${escapeHtmlAttr(a.heroImage)}" alt="${escapeHtmlAttr(a.heroImageAlt)}" loading="lazy"></div>`
    : "";
  const c = categoryColorFor(a.categorySlug);
  const tagStyle = `background:${c.accentSoft};color:${c.accentDeep};`;
  return `<a class="article-card" href="${BASE}/articles/${a.slug}/">
      ${thumb}
      <div class="eyebrow"><span class="tag" style="${tagStyle}">${categoryIcon(a.categorySlug)}${a.category}</span><span>No.${a.logNumber}</span></div>
      <h2 class="article-card__title">${a.title}</h2>
      <p class="article-card__desc">${a.description}</p>
      <p class="article-card__meta">更新: ${a.updated}</p>

    </a>`;
}

function relatedSection(current) {
  let pool = articles.filter((a) => a.slug !== current.slug && a.categorySlug === current.categorySlug);
  if (pool.length === 0) pool = articles.filter((a) => a.slug !== current.slug);
  const picks = pool.sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, 3);
  if (picks.length === 0) return "";
  return `<div class="wrap related">
  <h2>あわせて読みたい比較記事</h2>
  <div class="article-grid">
    ${picks.map(cardHtml).join("\n    ")}
  </div>
</div>`;
}

// ---------- 3. 記事ページ生成 ----------
const articleTpl = readTemplate("article.html");
for (const a of articles) {
  const html = fill(articleTpl, {
    TITLE: a.title,
    DESCRIPTION: a.description,
    KEYWORDS: a.keywords,
    CANONICAL: `${SITE_ROOT}/articles/${a.slug}/`,
    GSC_TAG: gscTag,
    BODY_STYLE: bodyStyleFor(a.categorySlug),
    SITE_NAME: site.siteName,
    SITE_NAME_HTML: site.siteNameHtml || site.siteName,
    TAGLINE: site.tagline,
    OG_IMAGE_TAG: ogImageTag(a),
    RSS_URL: `${SITE_ROOT}/rss.xml`,
    ASSET_PATH: `${BASE}/assets/`,
    HOME_PATH: `${BASE}/`,
    NAV_LINKS: navLinks,
    CATEGORY: `${categoryIcon(a.categorySlug)}${a.category}`,
    LOG_NUMBER: a.logNumber,
    DATE_PUBLISHED: a.date,
    DATE_MODIFIED: a.updated,
    AUTHOR: a.author,
    HERO_IMAGE: a.heroImage
      ? `<div class="article-hero__image"><img src="${escapeHtmlAttr(a.heroImage)}" alt="${escapeHtmlAttr(a.heroImageAlt)}" loading="lazy"></div>`
      : "",
    CONTENT: a.html,
    JSON_LD: jsonLdForArticle(a),
    RELATED_SECTION: relatedSection(a),
  });
  const outDir = path.join(OUT_DIR, "articles", a.slug);
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, "index.html"), html);
}

// ---------- 4. 一覧ページ生成(共通関数) ----------
const listTpl = readTemplate("list.html");
function writeListPage({ outPath, canonical, title, description, h1, intro, items, categorySlug }) {
  const html = fill(listTpl, {
    TITLE: title,
    DESCRIPTION: description,
    CANONICAL: canonical,
    GSC_TAG: gscTag,
    BODY_STYLE: categorySlug ? bodyStyleFor(categorySlug) : "",
    SITE_NAME: site.siteName,
    SITE_NAME_HTML: site.siteNameHtml || site.siteName,
    TAGLINE: site.tagline,
    RSS_URL: `${SITE_ROOT}/rss.xml`,
    ASSET_PATH: `${BASE}/assets/`,
    HOME_PATH: `${BASE}/`,
    NAV_LINKS: navLinks,
    H1: h1,
    INTRO: intro,
    CARDS: items.map(cardHtml).join("\n    "),
    JSON_LD_BLOCK: "",
  });
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, html);
}

// トップページ
writeListPage({
  outPath: path.join(OUT_DIR, "index.html"),
  canonical: `${SITE_ROOT}/`,
  title: `${site.siteName}｜${site.tagline}`,
  description: site.description,
  h1: site.tagline,
  intro: site.description,
  items: byDateDesc,
});

// カテゴリページ
for (const c of activeCategories) {
  const items = byDateDesc.filter((a) => a.categorySlug === c.slug);
  writeListPage({
    outPath: path.join(OUT_DIR, "category", c.slug, "index.html"),
    canonical: `${SITE_ROOT}/category/${c.slug}/`,
    title: `${c.name}の比較レビュー一覧 | ${site.siteName}`,
    description: `${c.name}に関する比較レビュー記事の一覧です。`,
    h1: c.name,
    intro: `${c.name}のジャンルで、実際に使って比較した記事の一覧です。`,
    items,
    categorySlug: c.slug,
  });
}

// ---------- 5. sitemap.xml / robots.txt / rss.xml ----------
const urls = [
  { loc: `${SITE_ROOT}/`, lastmod: byDateDesc[0]?.updated || fmtDate(new Date()) },
  ...activeCategories.map((c) => ({
    loc: `${SITE_ROOT}/category/${c.slug}/`,
    lastmod: byDateDesc.find((a) => a.categorySlug === c.slug)?.updated || fmtDate(new Date()),
  })),
  ...articles.map((a) => ({ loc: `${SITE_ROOT}/articles/${a.slug}/`, lastmod: a.updated })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeXml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(OUT_DIR, "sitemap.xml"), sitemap);

fs.writeFileSync(
  path.join(OUT_DIR, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${SITE_ROOT}/sitemap.xml\n`
);

const rssItems = byDateDesc.slice(0, 20).map((a) => `  <item>
    <title>${escapeXml(a.title)}</title>
    <link>${SITE_ROOT}/articles/${a.slug}/</link>
    <guid>${SITE_ROOT}/articles/${a.slug}/</guid>
    <description>${escapeXml(a.description)}</description>
    <pubDate>${new Date(a.date).toUTCString()}</pubDate>
  </item>`).join("\n");
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escapeXml(site.siteName)}</title>
  <link>${SITE_ROOT}/</link>
  <description>${escapeXml(site.description)}</description>
  <language>ja</language>
${rssItems}
</channel></rss>
`;
fs.writeFileSync(path.join(OUT_DIR, "rss.xml"), rss);

// ---------- 6. assets コピー ----------
copyDir(ASSETS_DIR, path.join(OUT_DIR, "assets"));

// カスタムドメイン用CNAME(必要な場合のみ有効化。README参照)
// fs.writeFileSync(path.join(OUT_DIR, "CNAME"), "yourdomain.com\n");

console.log(`ビルド完了: 記事 ${articles.length}件 / カテゴリ ${activeCategories.length}件 → docs/`);
