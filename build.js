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

const articles = files.map((filename) => {
  const raw = fs.readFileSync(path.join(CONTENT_DIR, filename), "utf8");
  const { data, content } = matter(raw);

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
    ogImage: data.ogImage || "",
    html: marked.parse(content),
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

function cardHtml(a) {
  return `<a class="article-card" href="${BASE}/articles/${a.slug}/">
      <div class="eyebrow"><span class="tag">${a.category}</span><span>No.${a.logNumber}</span></div>
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
    SITE_NAME: site.siteName,
    SITE_NAME_HTML: site.siteNameHtml || site.siteName,
    TAGLINE: site.tagline,
    OG_IMAGE_TAG: ogImageTag(a),
    RSS_URL: `${SITE_ROOT}/rss.xml`,
    ASSET_PATH: `${BASE}/assets/`,
    HOME_PATH: `${BASE}/`,
    NAV_LINKS: navLinks,
    CATEGORY: a.category,
    LOG_NUMBER: a.logNumber,
    DATE_PUBLISHED: a.date,
    DATE_MODIFIED: a.updated,
    AUTHOR: a.author,
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
function writeListPage({ outPath, canonical, title, description, h1, intro, items }) {
  const html = fill(listTpl, {
    TITLE: title,
    DESCRIPTION: description,
    CANONICAL: canonical,
    GSC_TAG: gscTag,
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
